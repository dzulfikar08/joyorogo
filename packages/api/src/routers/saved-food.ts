import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, like, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { foodLog } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";
import { foodQuickMark, savedFood } from "@joyorogo/db/schema/saved-foods";

import { protectedProcedure } from "../index";
import { jakartaToday, shiftDate } from "../lib/engine";
import { userZone } from "../lib/user-zone";
import { serverT } from "../lib/messages";
import { dateSchema, mealSchema } from "../lib/schemas";
import { assertEatenAt, eatenAtSchema } from "../lib/eaten-at";
import { insertFoodRows } from "../lib/food-rows";
import { habitKey, findOffer, OFFER_WINDOW_DAYS } from "../lib/favorite-offer";
import { estimateMacros } from "../lib/macro-estimate";
import { MAX_GRAMS, MAX_KCAL, macrosForTypedKcal } from "../lib/portion";
import { carriesMoreNutrition, foodSavedKey, parseSavedItems, plateSavedKey } from "../lib/saved-foods";
import type { SavedItem } from "../lib/saved-foods";
import { photoKey, stickerKey } from "../lib/sticker";
import type { StickersBucket } from "../lib/sticker";

type SavedRow = typeof savedFood.$inferSelect;

/** A favorite as clients see it: parsed components, no raw JSON. */
function present(row: SavedRow) {
  const { itemsJson, ...rest } = row;
  return { ...rest, items: parseSavedItems(itemsJson) };
}

/**
 * Whether a sticker / original photo is still used by a diary row or a
 * favorite. Ids are 32 hex chars, so the LIKE patterns carry no wildcards.
 */
async function mediaReferences(
  db: Database,
  userId: string,
  ids: { scanId?: string | null; photoId?: string | null },
): Promise<{ scan: boolean; photo: boolean }> {
  const check = async (column: "scanId" | "photoId", id: string | null | undefined) => {
    if (!id) return false;
    const [inLog] = await db
      .select({ id: foodLog.id })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), eq(foodLog[column], id)))
      .limit(1);
    if (inLog) return true;
    const [inSaved] = await db
      .select({ id: savedFood.id })
      .from(savedFood)
      .where(and(eq(savedFood.userId, userId), like(savedFood.itemsJson, `%"${column}":"${id}"%`)))
      .limit(1);
    return Boolean(inSaved);
  };
  return { scan: await check("scanId", ids.scanId), photo: await check("photoId", ids.photoId) };
}

/**
 * Deletes the R2 sticker/photo of removed rows unless something else (a diary
 * row of another day, a re-logged copy, a favorite) still points at them.
 * Orphaned objects are harmless, so failures never block the caller.
 */
export async function purgeUnreferencedMedia(
  db: Database,
  bucket: StickersBucket | undefined,
  userId: string,
  media: Array<{ scanId?: string | null; plateScanId?: string | null; photoId?: string | null }>,
): Promise<void> {
  if (!bucket) return;
  const seen = new Set<string>();
  for (const { scanId, plateScanId, photoId } of media) {
    try {
      const refs = await mediaReferences(db, userId, { scanId, photoId });
      if (scanId && !refs.scan && !seen.has(`s:${scanId}`)) {
        seen.add(`s:${scanId}`);
        await bucket.delete(stickerKey(scanId));
      }
      if (photoId && !refs.photo && !seen.has(`p:${photoId}`)) {
        seen.add(`p:${photoId}`);
        await bucket.delete(photoKey(userId, photoId));
      }
      // The plate sticker lives on the scan's rows only (favorites do not carry it): it goes with the last of them.
      if (plateScanId && !seen.has(`s:${plateScanId}`)) {
        seen.add(`s:${plateScanId}`);
        const [inLog] = await db
          .select({ id: foodLog.id })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), eq(foodLog.plateScanId, plateScanId)))
          .limit(1);
        if (!inLog) await bucket.delete(stickerKey(plateScanId));
      }
    } catch {
      // orphaned objects are harmless
    }
  }
}

const toItem = (row: typeof foodLog.$inferSelect): SavedItem => ({
  name: row.name,
  grams: row.grams,
  kcal: row.kcal,
  protein: row.protein,
  carbs: row.carbs,
  fat: row.fat,
  fiber: row.fiber,
  scanId: row.scanId,
  photoId: row.photoId,
});

/** Favorites the quick-add list and the manage sheet hold; `list` reads the same number. */
export const MAX_FAVORITES = 100;

const macroField = z.number().min(0).max(500).optional();

export const savedFoodRouter = {
  // The user's own order first (reorder); the rest, and favorites never reordered, newest-used first.
  list: protectedProcedure.handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(savedFood)
      .where(eq(savedFood.userId, context.session.user.id))
      .orderBy(
        asc(sql`${savedFood.sortOrder} is null`),
        asc(savedFood.sortOrder),
        desc(sql`coalesce(${savedFood.lastUsedAt}, ${savedFood.createdAt})`),
      )
      .limit(MAX_FAVORITES);
    return { items: rows.map(present) };
  }),

  // Catat cepat > Atur: the favorites in the order the user arranged them. Ids not theirs are ignored.
  reorder: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(MAX_FAVORITES) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await Promise.all(
        input.ids.map((id, index) =>
          context.db
            .update(savedFood)
            .set({ sortOrder: index })
            .where(and(eq(savedFood.id, id), eq(savedFood.userId, userId))),
        ),
      );
      return { ok: true };
    }),

  // A favorite typed in by hand (Catat cepat > Atur > Tambah): name and kcal, macros when the user knows them,
  // else resolved from the name like any typed log (TKPI row, then the story parse; absent stays unknown).
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        kcal: z.number().min(1).max(MAX_KCAL),
        grams: z.number().min(1).max(MAX_GRAMS).optional(),
        protein: macroField,
        carbs: macroField,
        fat: macroField,
        fiber: macroField,
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const key = foodSavedKey(input.name, input.kcal);
      const [existing] = await context.db
        .select()
        .from(savedFood)
        .where(and(eq(savedFood.userId, userId), eq(savedFood.key, key)))
        .limit(1);
      if (existing) return present(existing);
      const [{ n } = { n: 0 }] = await context.db
        .select({ n: sql<number>`count(*)` })
        .from(savedFood)
        .where(eq(savedFood.userId, userId));
      if (n >= MAX_FAVORITES) {
        throw new ORPCError("UNPROCESSABLE_CONTENT", { message: t("misc.savedFood.full", { count: MAX_FAVORITES }) });
      }
      const typedMacros = input.protein !== undefined || input.carbs !== undefined || input.fat !== undefined;
      const zone = await userZone(context);
      const macros = typedMacros
        ? null
        : await estimateMacros(
            {
              db: context.db,
              ai: context.env.AI,
              model: context.env.AI_VISION_MODEL || undefined,
              userId,
              locale: context.locale,
              region: context.region,
              zone,
            },
            input.name,
            input.kcal,
          );
      const item: SavedItem = {
        name: input.name,
        grams: input.grams ?? null,
        kcal: input.kcal,
        protein: input.protein ?? macros?.protein ?? null,
        carbs: input.carbs ?? macros?.carbs ?? null,
        fat: input.fat ?? macros?.fat ?? null,
        fiber: input.fiber ?? macros?.fiber ?? null,
        scanId: null,
        photoId: null,
      };
      await context.db
        .insert(savedFood)
        .values({
          id: crypto.randomUUID(),
          userId,
          name: input.name,
          place: null,
          priceIdr: null,
          kcal: input.kcal,
          itemsJson: JSON.stringify([item]),
          key,
          // New choices go to the end of the user's own order.
          sortOrder: n,
        })
        .onConflictDoNothing();
      const [saved] = await context.db
        .select()
        .from(savedFood)
        .where(and(eq(savedFood.userId, userId), eq(savedFood.key, key)))
        .limit(1);
      if (!saved) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("misc.savedFood.saveFailed") });
      return present(saved);
    }),

  // Catat cepat > Atur > edit: a new name and/or a new total kcal. A new kcal scales every component and its macros by
  // the same ratio (weights stay), the way a typed kcal does elsewhere (lib/portion macrosForTypedKcal).
  update: protectedProcedure
    .input(
      z
        .object({
          id: z.string(),
          name: z.string().trim().min(1).max(200).optional(),
          kcal: z.number().min(1).max(MAX_KCAL).optional(),
        })
        .refine((v) => v.name !== undefined || v.kcal !== undefined, "Isi nama atau kalori"),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const [row] = await context.db
        .select()
        .from(savedFood)
        .where(and(eq(savedFood.id, input.id), eq(savedFood.userId, userId)))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: t("misc.savedFood.notFound") });
      const items = parseSavedItems(row.itemsJson);
      const total = items.reduce((sum, item) => sum + item.kcal, 0);
      let nextItems = items;
      let nextKcal = row.kcal;
      let key = row.key;
      if (input.kcal !== undefined && total > 0 && Math.round(input.kcal) !== Math.round(total)) {
        const ratio = input.kcal / total;
        nextItems = items.map((item) => {
          const kcal = Math.round(item.kcal * ratio);
          const macros = macrosForTypedKcal(
            {
              kcal: item.kcal,
              protein: item.protein ?? undefined,
              carbs: item.carbs ?? undefined,
              fat: item.fat ?? undefined,
              fiber: item.fiber ?? undefined,
            },
            item.kcal * ratio,
          );
          return {
            ...item,
            kcal,
            protein: macros.protein ?? null,
            carbs: macros.carbs ?? null,
            fat: macros.fat ?? null,
            fiber: macros.fiber ?? null,
          };
        });
        nextKcal = input.kcal;
        key =
          nextItems.length === 1
            ? foodSavedKey(nextItems[0]!.name, nextKcal)
            : plateSavedKey(row.name, row.place, nextItems);
        const [clash] = await context.db
          .select({ id: savedFood.id })
          .from(savedFood)
          .where(and(eq(savedFood.userId, userId), eq(savedFood.key, key), ne(savedFood.id, row.id)))
          .limit(1);
        if (clash) throw new ORPCError("CONFLICT", { message: t("misc.savedFood.duplicate") });
      }
      const [updated] = await context.db
        .update(savedFood)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          itemsJson: JSON.stringify(nextItems),
          kcal: nextKcal,
          key,
        })
        .where(and(eq(savedFood.id, row.id), eq(savedFood.userId, userId)))
        .returning();
      return present(updated ?? row);
    }),

  // The one habit worth saving now: the food or combo logged 3+ times in the last 14 days that is not a favorite and
  // was not offered before. Null = nothing to offer. `save` with `target` stars it; `dismissOffer` is "Nanti".
  offer: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const zone = await userZone(context);
    const since = shiftDate(jakartaToday(undefined, zone), -OFFER_WINDOW_DAYS);
    const [rows, saved, marks] = await Promise.all([
      context.db
        .select({
          id: foodLog.id,
          name: foodLog.name,
          kcal: foodLog.kcal,
          plateId: foodLog.plateId,
          createdAt: foodLog.createdAt,
        })
        .from(foodLog)
        .where(and(eq(foodLog.userId, userId), gte(foodLog.date, since), ne(foodLog.source, "huawei")))
        .limit(600),
      context.db.select({ itemsJson: savedFood.itemsJson }).from(savedFood).where(eq(savedFood.userId, userId)),
      context.db
        .select({ key: foodQuickMark.key })
        .from(foodQuickMark)
        .where(and(eq(foodQuickMark.userId, userId), eq(foodQuickMark.kind, "favorite_offered"))),
    ]);
    const offer = findOffer(
      rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })),
      new Set(saved.map((row) => habitKey(parseSavedItems(row.itemsJson).map((item) => item.name)))),
      new Set(marks.map((mark) => mark.key)),
    );
    if (!offer) return { offer: null };
    if (offer.kind === "plate") {
      const [owner] = await context.db
        .select({ name: plate.name })
        .from(plate)
        .where(and(eq(plate.id, offer.targetId), eq(plate.userId, userId)))
        .limit(1);
      if (owner?.name) return { offer: { ...offer, name: owner.name } };
    }
    return { offer };
  }),

  // "Nanti" on the offer: this habit is not offered again.
  dismissOffer: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(600) }))
    .handler(async ({ context, input }) => {
      await context.db
        .insert(foodQuickMark)
        .values({ userId: context.session.user.id, kind: "favorite_offered", key: input.key })
        .onConflictDoNothing();
      return { ok: true };
    }),

  // Star on a diary row (foodId) or a whole plate (plateId). Idempotent: the
  // same content saved twice returns the existing favorite.
  save: protectedProcedure
    .input(
      z
        .object({ foodId: z.string().optional(), plateId: z.string().optional() })
        .refine((v) => Boolean(v.foodId) !== Boolean(v.plateId), "Pilih satu: foodId atau plateId"),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      let name: string;
      let place: string | null = null;
      let priceIdr: number | null = null;
      let items: SavedItem[];
      let key: string;

      if (input.foodId) {
        const [row] = await context.db
          .select()
          .from(foodLog)
          .where(and(eq(foodLog.id, input.foodId), eq(foodLog.userId, userId)))
          .limit(1);
        if (!row) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "errors")("misc.savedFood.entryNotFound") });
        name = row.name;
        items = [toItem(row)];
        key = foodSavedKey(row.name, row.kcal);
        // Price belongs to the plate: keep it only when this row is the whole plate.
        if (row.plateId) {
          const siblings = await context.db
            .select({ id: foodLog.id })
            .from(foodLog)
            .where(and(eq(foodLog.userId, userId), eq(foodLog.plateId, row.plateId)))
            .limit(2);
          const [owner] = await context.db
            .select({ place: plate.place, priceIdr: plate.priceIdr })
            .from(plate)
            .where(and(eq(plate.id, row.plateId), eq(plate.userId, userId)))
            .limit(1);
          if (owner && siblings.length === 1) {
            place = owner.place;
            priceIdr = owner.priceIdr;
          }
        }
      } else {
        const plateId = input.plateId as string;
        const [owner] = await context.db
          .select()
          .from(plate)
          .where(and(eq(plate.id, plateId), eq(plate.userId, userId)))
          .limit(1);
        if (!owner) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "errors")("misc.savedFood.plateNotFound") });
        const rows = await context.db
          .select()
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), eq(foodLog.plateId, plateId)))
          .orderBy(asc(foodLog.createdAt));
        if (rows.length === 0) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "errors")("misc.savedFood.plateEmpty") });
        name = owner.name;
        place = owner.place;
        priceIdr = owner.priceIdr;
        items = rows.map(toItem);
        key = plateSavedKey(owner.name, owner.place, items);
      }

      await context.db
        .insert(savedFood)
        .values({
          id: crypto.randomUUID(),
          userId,
          name,
          place,
          priceIdr,
          kcal: items.reduce((sum, item) => sum + item.kcal, 0),
          itemsJson: JSON.stringify(items),
          key,
        })
        .onConflictDoNothing();
      const [saved] = await context.db
        .select()
        .from(savedFood)
        .where(and(eq(savedFood.userId, userId), eq(savedFood.key, key)))
        .limit(1);
      if (!saved) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: serverT(context.locale, "errors")("misc.savedFood.saveFailed") });
      // Same dish starred again after its macros were filled in: the favorite takes the richer copy.
      if (carriesMoreNutrition(items, parseSavedItems(saved.itemsJson))) {
        const [refreshed] = await context.db
          .update(savedFood)
          .set({ itemsJson: JSON.stringify(items) })
          .where(eq(savedFood.id, saved.id))
          .returning();
        return present(refreshed ?? saved);
      }
      return present(saved);
    }),

  // One-tap re-log into a day + slot, grams/macros/price/photo reference intact.
  // Several components or a price become a plate so the diary groups them again.
  relog: protectedProcedure
    .input(z.object({ id: z.string(), date: dateSchema.optional(), meal: mealSchema, eatenAt: eatenAtSchema.optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const zone = await userZone(context);
      const [saved] = await context.db
        .select()
        .from(savedFood)
        .where(and(eq(savedFood.id, input.id), eq(savedFood.userId, userId)))
        .limit(1);
      if (!saved) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "errors")("misc.savedFood.notFound") });
      const items = parseSavedItems(saved.itemsJson);
      if (items.length === 0) {
        throw new ORPCError("UNPROCESSABLE_CONTENT", { message: serverT(context.locale, "errors")("misc.savedFood.empty") });
      }
      const date = input.date ?? jakartaToday(undefined, zone);
      assertEatenAt(input.eatenAt, date, zone);
      let plateId: string | null = null;
      if (items.length > 1 || saved.priceIdr != null) {
        plateId = crypto.randomUUID();
        await context.db.insert(plate).values({
          id: plateId,
          userId,
          date,
          meal: input.meal,
          name: saved.name,
          place: saved.place,
          priceIdr: saved.priceIdr,
        });
      }
      const rows = await insertFoodRows(
        context.db,
        items.map((item) => ({
          id: crypto.randomUUID(),
          userId,
          date,
          meal: input.meal,
          name: item.name,
          kcal: item.kcal,
          grams: item.grams,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          source: item.scanId ? "ai" : "manual",
          eatenAt: input.eatenAt,
          scanId: item.scanId,
          photoId: item.photoId,
          plateId,
        })),
      );
      await context.db
        .update(savedFood)
        .set({ useCount: sql`${savedFood.useCount} + 1`, lastUsedAt: new Date() })
        .where(eq(savedFood.id, saved.id));
      return { items: rows, plateId };
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(200) }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .update(savedFood)
        .set({ name: input.name })
        .where(and(eq(savedFood.id, input.id), eq(savedFood.userId, context.session.user.id)))
        .returning();
      return row ? present(row) : null;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [row] = await context.db
        .delete(savedFood)
        .where(and(eq(savedFood.id, input.id), eq(savedFood.userId, userId)))
        .returning();
      if (row) {
        await purgeUnreferencedMedia(
          context.db,
          context.env.STICKERS,
          userId,
          parseSavedItems(row.itemsJson),
        );
      }
      return { ok: true };
    }),
};
