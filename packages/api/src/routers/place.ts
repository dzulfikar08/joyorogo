import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { foodLog } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";

import { protectedProcedure } from "../index";
import { assertEatenAt, eatenAtSchema } from "../lib/eaten-at";
import { jakartaToday, suggestMealNow } from "../lib/engine";
import { serverT } from "../lib/messages";
import { aggregatePlaces, dishesOfPlace, normalizePlaceKey, visitsOfPlace } from "../lib/places";
import type { PlaceVisitRow, PlateNutrition } from "../lib/places";
import type { Context } from "../context";
import { dateSchema, mealSchema } from "../lib/schemas";

// One user's places stay small; the cap keeps the aggregate a single bounded scan.
const MAX_PLATES = 2000;
const MAX_DETAIL_VISITS = 40;

const visitColumns = {
  id: plate.id,
  date: plate.date,
  meal: plate.meal,
  name: plate.name,
  place: plate.place,
  priceIdr: plate.priceIdr,
  lat: plate.lat,
  lng: plate.lng,
  createdAt: plate.createdAt,
};

const withPlace = (userId: string) =>
  and(eq(plate.userId, userId), isNotNull(plate.place), sql`trim(${plate.place}) <> ''`);

/** kcal and protein of every plate that carries a place, summed over its food rows in one grouped scan. */
async function plateNutrition(db: Context["db"], userId: string): Promise<PlateNutrition[]> {
  const rows = await db
    .select({
      plateId: foodLog.plateId,
      kcal: sql<number>`sum(${foodLog.kcal})`,
      protein: sql<number | null>`sum(${foodLog.protein})`,
    })
    .from(foodLog)
    .where(
      and(
        eq(foodLog.userId, userId),
        inArray(foodLog.plateId, db.select({ id: plate.id }).from(plate).where(withPlace(userId))),
      ),
    )
    .groupBy(foodLog.plateId)
    .limit(MAX_PLATES);
  return rows.flatMap((row) =>
    row.plateId
      ? [{ plateId: row.plateId, kcal: Number(row.kcal), proteinG: row.protein === null ? null : Number(row.protein) }]
      : [],
  );
}

export const placeRouter = {
  // "Tempat makan": every place the user logged a plate at with what was eaten
  // there on average, in two bounded queries (plates with a place, plus their
  // summed nutrition via a subquery so no id list is ever bound). Coordinates
  // are the owner's own.
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [rows, nutrition] = await Promise.all([
      context.db
        .select(visitColumns)
        .from(plate)
        .where(withPlace(userId))
        .orderBy(desc(plate.date), desc(plate.createdAt))
        .limit(MAX_PLATES),
      plateNutrition(context.db, userId),
    ]);
    return { today: jakartaToday(), places: aggregatePlaces(rows, nutrition) };
  }),

  // Visit history of one place (newest first) with each plate's components.
  detail: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(300) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const rows: PlaceVisitRow[] = await context.db
        .select(visitColumns)
        .from(plate)
        .where(withPlace(userId))
        .orderBy(desc(plate.date), desc(plate.createdAt))
        .limit(MAX_PLATES);
      const matching = visitsOfPlace(rows, normalizePlaceKey(input.key));
      if (matching.length === 0) return null;
      const shown = matching.slice(0, MAX_DETAIL_VISITS);
      const nutrition = await plateNutrition(context.db, userId);
      const nutritionByPlate = new Map(nutrition.map((entry) => [entry.plateId, entry]));
      const components = await context.db
        .select({
          plateId: foodLog.plateId,
          name: foodLog.name,
        })
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, userId),
            inArray(
              foodLog.plateId,
              shown.map((v) => v.id),
            ),
          ),
        )
        .orderBy(asc(foodLog.createdAt));
      const byPlate = new Map<string, typeof components>();
      for (const item of components) {
        if (!item.plateId) continue;
        const list = byPlate.get(item.plateId);
        if (list) list.push(item);
        else byPlate.set(item.plateId, [item]);
      }
      return {
        total: matching.length,
        // Every visit counts here, not just the newest ones listed below.
        dishes: dishesOfPlace(matching, nutrition),
        visits: shown.map((visit) => {
          const items = byPlate.get(visit.id) ?? [];
          const eaten = nutritionByPlate.get(visit.id);
          return {
            id: visit.id,
            date: visit.date,
            meal: visit.meal,
            name: visit.name,
            priceIdr: visit.priceIdr,
            kcal: Math.round(eaten?.kcal ?? 0),
            proteinG: eaten?.proteinG != null ? Math.round(eaten.proteinG) : null,
            itemNames: items.map((item) => item.name),
            hasLocation: visit.lat != null && visit.lng != null,
          };
        }),
      };
    }),

  // One-tap "makan lagi": clones a past plate (components, grams, macros, price,
  // place and its coordinates) into today (or `date`) under the current meal slot.
  relog: protectedProcedure
    .input(
      z.object({
        plateId: z.string(),
        date: dateSchema.optional(),
        meal: mealSchema.optional(),
        eatenAt: eatenAtSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [source] = await context.db
        .select()
        .from(plate)
        .where(and(eq(plate.id, input.plateId), eq(plate.userId, userId)))
        .limit(1);
      const t = serverT(context.locale, "place");
      if (!source) {
        throw new ORPCError("NOT_FOUND", { message: t("server.error.plateNotFound") });
      }
      const items = await context.db
        .select()
        .from(foodLog)
        .where(and(eq(foodLog.userId, userId), eq(foodLog.plateId, source.id)))
        .orderBy(asc(foodLog.createdAt));
      if (items.length === 0) {
        throw new ORPCError("UNPROCESSABLE_CONTENT", { message: t("server.error.plateEmpty") });
      }
      const date = input.date ?? jakartaToday();
      const meal = input.meal ?? suggestMealNow();
      assertEatenAt(input.eatenAt, date);
      const plateId = crypto.randomUUID();
      await context.db.insert(plate).values({
        id: plateId,
        userId,
        date,
        meal,
        name: source.name,
        place: source.place,
        lat: source.lat,
        lng: source.lng,
        priceIdr: source.priceIdr,
      });
      const rows = await context.db
        .insert(foodLog)
        .values(
          items.map((item) => ({
            id: crypto.randomUUID(),
            userId,
            date,
            meal,
            name: item.name,
            kcal: item.kcal,
            grams: item.grams,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            fiber: item.fiber,
            source: item.source,
            eatenAt: input.eatenAt,
            scanId: item.scanId,
            photoId: item.photoId,
            plateId,
          })),
        )
        .returning();
      return { items: rows, plateId, date, meal };
    }),

  // Deletes stored coordinates: one place (key) or every place (no key). The
  // plates and their diary rows stay; only the location goes.
  clearLocation: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(300).optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const located = await context.db
        .select({ id: plate.id, place: plate.place })
        .from(plate)
        .where(and(eq(plate.userId, userId), isNotNull(plate.lat)));
      const key = input.key ? normalizePlaceKey(input.key) : null;
      const ids = located
        .filter((row) => key === null || (row.place != null && normalizePlaceKey(row.place) === key))
        .map((row) => row.id);
      // D1 caps bound parameters per statement; clear in slices.
      for (let i = 0; i < ids.length; i += 50) {
        await context.db
          .update(plate)
          .set({ lat: null, lng: null })
          .where(and(eq(plate.userId, userId), inArray(plate.id, ids.slice(i, i + 50))));
      }
      return { cleared: ids.length };
    }),
};
