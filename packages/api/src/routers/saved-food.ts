import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { foodLog } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";
import { savedFood } from "@joyorogo/db/schema/saved-foods";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { serverT } from "../lib/messages";
import { dateSchema, mealSchema } from "../lib/schemas";
import { assertEatenAt, eatenAtSchema } from "../lib/eaten-at";
import { foodSavedKey, parseSavedItems, plateSavedKey } from "../lib/saved-foods";
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
  media: Array<{ scanId?: string | null; photoId?: string | null }>,
): Promise<void> {
  if (!bucket) return;
  const seen = new Set<string>();
  for (const { scanId, photoId } of media) {
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

export const savedFoodRouter = {
  // Newest-used first; a never-used favorite sorts by when it was saved.
  list: protectedProcedure.handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(savedFood)
      .where(eq(savedFood.userId, context.session.user.id))
      .orderBy(desc(sql`coalesce(${savedFood.lastUsedAt}, ${savedFood.createdAt})`))
      .limit(100);
    return { items: rows.map(present) };
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
      return present(saved);
    }),

  // One-tap re-log into a day + slot, grams/macros/price/photo reference intact.
  // Several components or a price become a plate so the diary groups them again.
  relog: protectedProcedure
    .input(z.object({ id: z.string(), date: dateSchema.optional(), meal: mealSchema, eatenAt: eatenAtSchema.optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
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
      const date = input.date ?? jakartaToday();
      assertEatenAt(input.eatenAt, date);
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
      const rows = await context.db
        .insert(foodLog)
        .values(
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
        )
        .returning();
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
