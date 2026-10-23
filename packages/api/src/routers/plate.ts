import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { foodLog, profile } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";
import type { Database } from "@joyorogo/db";
import type { DayZone } from "@joyorogo/i18n";

import { protectedProcedure } from "../index";
import { readChunked } from "../lib/d1";
import { assertEatenAt, eatenAtSchema } from "../lib/eaten-at";
import { jakartaToday, shiftDate } from "../lib/engine";
import { userZone } from "../lib/user-zone";
import { normalizePlaceKey, toStoredCoords } from "../lib/places";
import {
  aggregateNutrients,
  budgetRemaining,
  ideaValueMap,
  matchLastPrice,
  monthStart,
  rankBestValue,
  spendingSummary,
} from "../lib/plates";
import type { PlateNutrients } from "../lib/plates";
import { dateSchema, mealSchema, pastDateSchema } from "../lib/schemas";

const plateFields = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  place: z.string().trim().min(1).max(200).optional(),
  priceIdr: z.number().int().min(0).max(100_000_000).optional(),
});

// How far back value rankings look: enough history to be useful, cheap to scan.
const VALUE_WINDOW_DAYS = 90;

/** Nutrients per plate id, summed over the plate's food_log components. */
async function nutrientsByPlateId(
  db: Database,
  userId: string,
  ids: string[],
): Promise<Record<string, PlateNutrients>> {
  const totals: Record<string, PlateNutrients> = {};
  if (ids.length === 0) return totals;
  const components = await readChunked(
    ids,
    (slice) =>
      db
        .select({
          plateId: foodLog.plateId,
          kcal: sql<number>`sum(${foodLog.kcal})`,
          protein: sql<number | null>`sum(${foodLog.protein})`,
          carbs: sql<number | null>`sum(${foodLog.carbs})`,
          fat: sql<number | null>`sum(${foodLog.fat})`,
          fiber: sql<number | null>`sum(${foodLog.fiber})`,
        })
        .from(foodLog)
        .where(and(eq(foodLog.userId, userId), inArray(foodLog.plateId, slice)))
        .groupBy(foodLog.plateId),
    { reserved: 1 },
  );
  for (const row of components) {
    if (!row.plateId) continue;
    totals[row.plateId] = aggregateNutrients([
      { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat, fiber: row.fiber },
    ]);
  }
  return totals;
}

/** Plate ids of the user's priced plates in the value window. */
async function pricedPlateRows(db: Database, userId: string, zone: DayZone) {
  const since = shiftDate(jakartaToday(undefined, zone), -VALUE_WINDOW_DAYS);
  return db
    .select({
      id: plate.id,
      date: plate.date,
      meal: plate.meal,
      name: plate.name,
      place: plate.place,
      priceIdr: plate.priceIdr,
      createdAt: plate.createdAt,
    })
    .from(plate)
    .where(and(eq(plate.userId, userId), gte(plate.date, since), gt(plate.priceIdr, 0)))
    .orderBy(desc(plate.createdAt))
    .limit(500);
}

/**
 * plateKey(plate name) → protein per Rp1.000 for the user's priced plates, or
 * null when nothing is priced. Shared with day.summary so its "masih muat di
 * sisa kalori" ideas can be sorted best value first.
 */
export async function loadIdeaValues(
  db: Database,
  userId: string,
  zone: DayZone,
): Promise<Map<string, number> | null> {
  const plateRows = await pricedPlateRows(db, userId, zone);
  if (plateRows.length === 0) return null;
  const totals = await nutrientsByPlateId(
    db,
    userId,
    plateRows.map((row) => row.id),
  );
  return ideaValueMap(plateRows, totals);
}

export const plateRouter = {
  // Renames a plate or corrects its price/place; components follow via plate_id.
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(200).optional(),
        place: z.string().trim().max(200).nullable().optional(),
        priceIdr: z.number().int().min(0).max(100_000_000).nullable().optional(),
        // Moving the plate moves every component row with it, so the diary
        // grouping stays intact and stickers/photos stay attached.
        date: pastDateSchema.optional(),
        // Moves the plate and every component row to another meal slot.
        meal: mealSchema.optional(),
        // "Jam makan" of every component row; null clears it. Must fit the plate's (new) day.
        eatenAt: eatenAtSchema.nullable().optional(),
        // Opt-in location of the place; null clears it. Rounded to ~100 m on write.
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const { id, lat, lng, eatenAt, ...fields } = input;
      const userId = context.session.user.id;
      if (typeof eatenAt === "number") {
        const zone = await userZone(context);
        const [first] = await context.db
          .select({ date: foodLog.date })
          .from(foodLog)
          .where(and(eq(foodLog.plateId, id), eq(foodLog.userId, userId)))
          .limit(1);
        const day = fields.date ?? first?.date;
        if (day) assertEatenAt(eatenAt, day, zone);
      }
      const moveRows = {
        // A "jam makan" belongs to the day it was set on: rows that change day lose it, rows already on that day keep it.
        ...(fields.date
          ? { date: fields.date, eatenAt: sql`case when ${foodLog.date} = ${fields.date} then ${foodLog.eatenAt} else null end` }
          : {}),
        ...(eatenAt !== undefined ? { eatenAt } : {}),
        ...(fields.meal ? { meal: fields.meal } : {}),
      };
      if (Object.keys(moveRows).length > 0) {
        await context.db
          .update(foodLog)
          .set(moveRows)
          .where(and(eq(foodLog.plateId, id), eq(foodLog.userId, context.session.user.id)));
      }
      // Coordinates belong to the place they were saved for: a different
      // (or removed) place must not keep them.
      let moved = false;
      if (fields.place !== undefined) {
        const [current] = await context.db
          .select({ place: plate.place })
          .from(plate)
          .where(and(eq(plate.id, id), eq(plate.userId, context.session.user.id)))
          .limit(1);
        moved =
          normalizePlaceKey(current?.place ?? "") !== normalizePlaceKey(fields.place ?? "");
      }
      const coords = lat === undefined && lng === undefined ? undefined : toStoredCoords(lat, lng);
      const patch = moved ? { ...fields, lat: null, lng: null } : fields;
      const values =
        coords === undefined
          ? patch
          : {
              ...patch,
              lat: fields.place === null ? null : (coords?.lat ?? null),
              lng: fields.place === null ? null : (coords?.lng ?? null),
            };
      const owned = and(eq(plate.id, id), eq(plate.userId, userId));
      // Only the rows' time (or slot) changed: nothing to write on the plate itself.
      const [row] =
        Object.keys(values).length === 0
          ? await context.db.select().from(plate).where(owned).limit(1)
          : await context.db.update(plate).set(values).where(owned).returning();
      return row ?? null;
    }),

  // Autofill for scan confirm / manual add: the last price paid for the same
  // plate name (+place when given, falling back to name only).
  lastPrice: protectedProcedure
    .input(plateFields.extend({ place: z.string().trim().max(200).nullish() }))
    .handler(async ({ context, input }) => {
      if (!input.name) return null;
      const rows = await context.db
        .select({
          date: plate.date,
          meal: plate.meal,
          name: plate.name,
          place: plate.place,
          priceIdr: plate.priceIdr,
          createdAt: plate.createdAt,
        })
        .from(plate)
        .where(and(eq(plate.userId, context.session.user.id), gt(plate.priceIdr, 0)))
        .orderBy(desc(plate.createdAt))
        .limit(200);
      return matchLastPrice(input.name, input.place ?? null, rows);
    }),

  // Plates logged on one day, for the diary's plate grouping and price edit.
  byDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      return context.db
        .select({
          id: plate.id,
          date: plate.date,
          meal: plate.meal,
          name: plate.name,
          place: plate.place,
          priceIdr: plate.priceIdr,
          lat: plate.lat,
          lng: plate.lng,
        })
        .from(plate)
        .where(
          and(
            eq(plate.userId, context.session.user.id),
            eq(plate.date, input.date ?? jakartaToday(undefined, zone)),
          ),
        )
        .orderBy(desc(plate.createdAt));
    }),

  // "Belanja makan": totals for the current day/week/month, average paid
  // per meal slot over the last 30 days, and the budget that is left.
  spending: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const zone = await userZone(context);
    const today = jakartaToday(undefined, zone);
    // Monthly totals need the 1st; the 30-day slot averages reach further back.
    const since = [monthStart(today), shiftDate(today, -29)].toSorted()[0]!;
    const [rows, prof] = await Promise.all([
      context.db
        .select({
          date: plate.date,
          meal: plate.meal,
          name: plate.name,
          place: plate.place,
          priceIdr: plate.priceIdr,
          createdAt: plate.createdAt,
        })
        .from(plate)
        .where(and(eq(plate.userId, userId), gte(plate.date, since))),
      context.db
        .select({
          foodBudgetIdr: profile.foodBudgetIdr,
          foodBudgetPeriod: profile.foodBudgetPeriod,
        })
        .from(profile)
        .where(eq(profile.userId, userId))
        .limit(1),
    ]);
    const summary = spendingSummary(rows, today);
    const budgetIdr = prof[0]?.foodBudgetIdr ?? null;
    const period = prof[0]?.foodBudgetPeriod ?? "month";
    const spent = period === "day" ? summary.today : summary.month;
    return {
      ...summary,
      budget:
        budgetIdr != null && budgetIdr > 0
          ? {
              idr: budgetIdr,
              period,
              remaining: budgetRemaining(spent, budgetIdr),
            }
          : null,
    };
  }),

  setBudget: protectedProcedure
    .input(
      z.object({
        idr: z.number().int().min(0).max(100_000_000).nullable(),
        period: z.enum(["day", "month"]).default("month"),
      }),
    )
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      await context.db
        .insert(profile)
        .values({
          userId: context.session.user.id,
          // required by the schema; updates below overwrite them for real users
          birthYear: 2000,
          gender: "male",
          heightCm: 170,
          startWeightKg: 70,
          targetWeightKg: 65,
          targetDate: jakartaToday(undefined, zone),
          activityLevel: "light",
          foodBudgetIdr: input.idr,
          foodBudgetPeriod: input.period,
        })
        .onConflictDoUpdate({
          target: profile.userId,
          set: { foodBudgetIdr: input.idr, foodBudgetPeriod: input.period },
        });
      return { ok: true };
    }),

  // "Nilai terbaik": the user's priced plates ranked by protein per Rp1.000,
  // nutrients aggregated from each plate's components, deduped by name+place.
  bestValue: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const plateRows = await pricedPlateRows(context.db, userId, await userZone(context));
    if (plateRows.length === 0) return [];
    const totals = await nutrientsByPlateId(
      context.db,
      userId,
      plateRows.map((row) => row.id),
    );
    return rankBestValue(plateRows, totals);
  }),

  // Value scores feeding the "masih muat di sisa kalori" idea ranking.
  ideaValues: protectedProcedure.handler(async ({ context }) => {
    const values = await loadIdeaValues(context.db, context.session.user.id, await userZone(context));
    return values ? [...values.entries()] : null;
  }),
};
