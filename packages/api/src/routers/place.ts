import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { foodLog } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";

import { protectedProcedure } from "../index";
import { jakartaToday, suggestMealNow } from "../lib/engine";
import { serverT } from "../lib/messages";
import { aggregatePlaces, normalizePlaceKey, visitsOfPlace } from "../lib/places";
import type { PlaceVisitRow } from "../lib/places";
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

export const placeRouter = {
  // "Tempat makan": every place the user logged a plate at, aggregated in two
  // bounded queries (plates with a place, plus their stickers via a subquery
  // so no id list is ever bound). Coordinates are the owner's own.
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [rows, stickers] = await Promise.all([
      context.db
        .select(visitColumns)
        .from(plate)
        .where(withPlace(userId))
        .orderBy(desc(plate.date), desc(plate.createdAt))
        .limit(MAX_PLATES),
      context.db
        .select({
          plateId: foodLog.plateId,
          scanId: foodLog.scanId,
          name: foodLog.name,
          kcal: foodLog.kcal,
        })
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, userId),
            isNotNull(foodLog.scanId),
            inArray(
              foodLog.plateId,
              context.db.select({ id: plate.id }).from(plate).where(withPlace(userId)),
            ),
          ),
        )
        .limit(MAX_PLATES * 4),
    ]);
    return {
      today: jakartaToday(),
      places: aggregatePlaces(
        rows,
        stickers.flatMap((s) =>
          s.plateId && s.scanId
            ? [{ plateId: s.plateId, scanId: s.scanId, name: s.name, kcal: s.kcal }]
            : [],
        ),
      ),
    };
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
      const components = await context.db
        .select({
          plateId: foodLog.plateId,
          name: foodLog.name,
          kcal: foodLog.kcal,
          scanId: foodLog.scanId,
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
        visits: shown.map((visit) => {
          const items = byPlate.get(visit.id) ?? [];
          return {
            id: visit.id,
            date: visit.date,
            meal: visit.meal,
            name: visit.name,
            priceIdr: visit.priceIdr,
            kcal: Math.round(items.reduce((sum, item) => sum + item.kcal, 0)),
            itemNames: items.map((item) => item.name),
            stickerScanId: items.find((item) => item.scanId)?.scanId ?? null,
            hasLocation: visit.lat != null && visit.lng != null,
          };
        }),
      };
    }),

  // One-tap "makan lagi": clones a past plate (components, grams, macros, price,
  // place and its coordinates) into today (or `date`) under the current meal slot.
  relog: protectedProcedure
    .input(
      z.object({ plateId: z.string(), date: dateSchema.optional(), meal: mealSchema.optional() }),
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
