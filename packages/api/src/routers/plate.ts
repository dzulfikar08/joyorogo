import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { foodLog, profile } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";
import type { Database } from "@joyorogo/db";

import { protectedProcedure } from "../index";
import { jakartaToday, shiftDate } from "../lib/engine";
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
import { dateSchema } from "../lib/schemas";

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
  const components = await db
    .select({
      plateId: foodLog.plateId,
      kcal: sql<number>`sum(${foodLog.kcal})`,
      protein: sql<number | null>`sum(${foodLog.protein})`,
      carbs: sql<number | null>`sum(${foodLog.carbs})`,
      fat: sql<number | null>`sum(${foodLog.fat})`,
      fiber: sql<number | null>`sum(${foodLog.fiber})`,
    })
    .from(foodLog)
    .where(and(eq(foodLog.userId, userId), inArray(foodLog.plateId, ids)))
    .groupBy(foodLog.plateId);
  for (const row of components) {
    if (!row.plateId) continue;
    totals[row.plateId] = aggregateNutrients([
      { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat, fiber: row.fiber },
    ]);
  }
  return totals;
}

/** Plate ids of the user's priced plates in the value window. */
async function pricedPlateRows(db: Database, userId: string) {
  const since = shiftDate(jakartaToday(), -VALUE_WINDOW_DAYS);
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
): Promise<Map<string, number> | null> {
  const plateRows = await pricedPlateRows(db, userId);
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
      }),
    )
    .handler(async ({ context, input }) => {
      const { id, ...fields } = input;
      const [row] = await context.db
        .update(plate)
        .set(fields)
        .where(and(eq(plate.id, id), eq(plate.userId, context.session.user.id)))
        .returning();
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

  // Plates logged on one WIB day, for the diary's plate grouping and price edit.
  byDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      return context.db
        .select({
          id: plate.id,
          meal: plate.meal,
          name: plate.name,
          place: plate.place,
          priceIdr: plate.priceIdr,
        })
        .from(plate)
        .where(
          and(
            eq(plate.userId, context.session.user.id),
            eq(plate.date, input.date ?? jakartaToday()),
          ),
        )
        .orderBy(desc(plate.createdAt));
    }),

  // "Belanja makan": totals for the current WIB day/week/month, average paid
  // per meal slot over the last 30 days, and the budget that is left.
  spending: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const today = jakartaToday();
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
          targetDate: jakartaToday(),
          activityLevel: "mid",
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
    const plateRows = await pricedPlateRows(context.db, userId);
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
    const values = await loadIdeaValues(context.db, context.session.user.id);
    return values ? [...values.entries()] : null;
  }),
};
