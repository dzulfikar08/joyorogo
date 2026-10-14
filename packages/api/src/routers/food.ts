import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";

import { foodLog, profile } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { MAX_GRAMS, MAX_KCAL, resolvePortion } from "../lib/portion";
import { dateSchema, mealSchema, pastDateSchema } from "../lib/schemas";
import {
  SCAN_ID_RE,
  base64ToBytes,
  newScanId,
  photoKey,
  stickerKey,
  storeStickers,
} from "../lib/sticker";
import type { StickerJob } from "../lib/sticker";
import { normalizeBox } from "../lib/vision";

const scanItemSchema = z.object({
  name: z.string().min(1).max(200),
  grams: z.number().min(1).max(MAX_GRAMS).optional(),
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(0).max(500).optional(),
  carbs: z.number().min(0).max(500).optional(),
  fat: z.number().min(0).max(500).optional(),
  fiber: z.number().min(0).max(500).optional(),
  // [ymin, xmin, ymax, xmax] on 0-1000, as ai.analyzeFood returned it.
  box: z.array(z.number()).length(4).optional(),
});

// Price attaches to the plate, never to components: one scan, one Cerita meal,
// or one manual entry is one plate row that its food_log rows point at.
const plateInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  place: z.string().trim().min(1).max(200).optional(),
  priceIdr: z.number().int().min(0).max(100_000_000).optional(),
});

/**
 * Creates the plate row a save is anchored to. `name` falls back to the first
 * component's name ("Nasi padang" from the AI's own item list) so a plate
 * always has a label, priced or not.
 */
async function createPlate(
  db: Database,
  userId: string,
  values: {
    date: string;
    meal: string;
    fallbackName: string;
    plate?: { name?: string; place?: string; priceIdr?: number };
  },
): Promise<string | null> {
  if (!values.plate) return null;
  const [row] = await db
    .insert(plate)
    .values({
      id: crypto.randomUUID(),
      userId,
      date: values.date,
      meal: values.meal,
      name: values.plate.name?.trim() || values.fallbackName,
      place: values.plate.place ?? null,
      priceIdr: values.plate.priceIdr ?? null,
    })
    .returning({ id: plate.id });
  return row?.id ?? null;
}

export const foodRouter = {
  // Saves a reviewed photo scan in one call: the original photo is stored
  // privately once, every kept item becomes its own row, and each boxed item
  // gets its own sticker cut out in the background (the response never waits).
  addScan: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        meal: mealSchema,
        imageBase64: z.base64().min(50).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        items: z.array(scanItemSchema).min(1).max(15),
        itemsJson: z.string().max(10_000).optional(),
        plate: plateInput.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const bucket = context.env.STICKERS;
      const images = context.env.IMAGES;
      const bytes = base64ToBytes(input.imageBase64);
      let photoId: string | null = null;
      // Originals are opt-in ("Simpan foto asli" in Profil); stickers are not.
      const [pref] = bucket
        ? await context.db
            .select({ keepPhotos: profile.keepPhotos })
            .from(profile)
            .where(eq(profile.userId, userId))
            .limit(1)
        : [];
      if (bucket && pref?.keepPhotos) {
        const id = newScanId();
        try {
          await bucket.put(photoKey(userId, id), bytes, {
            httpMetadata: { contentType: input.mimeType },
          });
          photoId = id;
        } catch {
          // the meal still saves without its photo
        }
      }
      const boxes = input.items.map((item) => normalizeBox(item.box));
      const anyBox = boxes.some(Boolean);
      // Boxed items get their own cutout; with no boxes at all, the first
      // item keeps the classic whole-plate sticker.
      const jobs: Array<StickerJob | null> = input.items.map((_, index) => {
        if (!bucket || !images) return null;
        const box = boxes[index];
        if (box) return { scanId: newScanId(), box };
        return !anyBox && index === 0 ? { scanId: newScanId() } : null;
      });
      const date = input.date ?? jakartaToday();
      // One scan = one plate; every kept item is a component of it.
      const plateId = await createPlate(context.db, userId, {
        date,
        meal: input.meal,
        fallbackName: input.items[0]?.name ?? "Piring",
        plate: input.plate,
      });
      const rows = await context.db
        .insert(foodLog)
        .values(
          input.items.map((item, index) => ({
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
            source: "ai",
            itemsJson: input.itemsJson,
            scanId: jobs[index]?.scanId,
            photoId,
            plateId,
          })),
        )
        .returning();
      const queued = jobs.filter((job): job is StickerJob => job !== null);
      if (bucket && queued.length > 0) {
        context.waitUntil(storeStickers(images, bucket, bytes, queued));
      }
      return { items: rows, photoId };
    }),

  add: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        meal: mealSchema,
        name: z.string().min(1).max(200),
        grams: z.number().min(1).max(MAX_GRAMS).optional(),
        kcal: z.number().min(0).max(5000),
        protein: z.number().min(0).max(500).optional(),
        carbs: z.number().min(0).max(500).optional(),
        fat: z.number().min(0).max(500).optional(),
        fiber: z.number().min(0).max(500).optional(),
        source: z.enum(["manual", "ai"]).default("manual"),
        itemsJson: z.string().max(10_000).optional(),
        // capability id of the dish sticker generated at scan time
        scanId: z.string().regex(SCAN_ID_RE).optional(),
        plate: plateInput.optional(),
        // attach to a plate created by an earlier item of the same Cerita group
        plateId: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      // An explicit plateId must belong to this user; unknown ids are ignored.
      let attachId = input.plateId ?? null;
      if (attachId) {
        const [owned] = await context.db
          .select({ id: plate.id })
          .from(plate)
          .where(and(eq(plate.id, attachId), eq(plate.userId, context.session.user.id)))
          .limit(1);
        if (!owned) attachId = null;
      }
      const date = input.date ?? jakartaToday();
      const plateId =
        attachId ??
        (await createPlate(context.db, context.session.user.id, {
          date,
          meal: input.meal,
          fallbackName: input.name,
          plate: input.plate,
        }));
      const [row] = await context.db
        .insert(foodLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date,
          meal: input.meal,
          name: input.name,
          kcal: input.kcal,
          grams: input.grams,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          fiber: input.fiber,
          source: input.source,
          itemsJson: input.itemsJson,
          scanId: input.scanId,
          plateId,
        })
        .returning();
      return row;
    }),

  // Edits one logged row: name, portion (weight, kcal, macros; see
  // resolvePortion for how they follow each other) and/or day (WIB key). Stickers
  // and photos ride along untouched; when the row was the last component of its
  // plate on the old day, the plate moves with it so the grouping never splits.
  // Plate totals are derived from rows, and price stays on the plate, so
  // nothing else needs rewriting.
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        date: pastDateSchema.optional(),
        name: z.string().trim().min(1).max(200).optional(),
        grams: z.number().min(1).max(MAX_GRAMS).optional(),
        kcal: z.number().min(0).max(MAX_KCAL).optional(),
        protein: z.number().min(0).max(500).optional(),
        carbs: z.number().min(0).max(500).optional(),
        fat: z.number().min(0).max(500).optional(),
        fiber: z.number().min(0).max(500).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [row] = await context.db
        .select()
        .from(foodLog)
        .where(and(eq(foodLog.id, input.id), eq(foodLog.userId, userId)))
        .limit(1);
      if (!row) return null;
      // Portion fields resolve against the stored row (weight <-> kcal <-> macros).
      const { id: _id, date, name, ...patch } = input;
      const next = resolvePortion(row, patch);
      const [updated] = await context.db
        .update(foodLog)
        .set({ ...next, ...(name ? { name } : {}), ...(date ? { date } : {}) })
        .where(and(eq(foodLog.id, input.id), eq(foodLog.userId, userId)))
        .returning();
      if (date && row.plateId && row.date !== date) {
        const [remaining] = await context.db
          .select({ id: foodLog.id })
          .from(foodLog)
          .where(
            and(
              eq(foodLog.userId, userId),
              eq(foodLog.plateId, row.plateId),
              eq(foodLog.date, row.date),
            ),
          )
          .limit(1);
        if (!remaining) {
          await context.db
            .update(plate)
            .set({ date })
            .where(and(eq(plate.id, row.plateId), eq(plate.userId, userId)));
        }
      }
      return updated ?? null;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .delete(foodLog)
        .where(and(eq(foodLog.id, input.id), eq(foodLog.userId, context.session.user.id)))
        .returning({ scanId: foodLog.scanId, photoId: foodLog.photoId, plateId: foodLog.plateId });
      // A plate with no components left is deleted with its last item.
      if (row?.plateId) {
        const [remaining] = await context.db
          .select({ id: foodLog.id })
          .from(foodLog)
          .where(and(eq(foodLog.userId, context.session.user.id), eq(foodLog.plateId, row.plateId)))
          .limit(1);
        if (!remaining) {
          await context.db.delete(plate).where(eq(plate.id, row.plateId));
        }
      }
      const stickers = context.env.STICKERS;
      if (row && stickers) {
        try {
          if (row.scanId) await stickers.delete(stickerKey(row.scanId));
          if (row.photoId) {
            // The photo is shared by every item of its scan: drop it with the last one.
            const [other] = await context.db
              .select({ id: foodLog.id })
              .from(foodLog)
              .where(
                and(eq(foodLog.userId, context.session.user.id), eq(foodLog.photoId, row.photoId)),
              )
              .limit(1);
            if (!other) await stickers.delete(photoKey(context.session.user.id, row.photoId));
          }
        } catch {
          // orphaned objects are harmless; never block the delete
        }
      }
      return { ok: true };
    }),

  listByDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const items = await context.db
        .select()
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, context.session.user.id),
            eq(foodLog.date, input.date ?? jakartaToday()),
          ),
        )
        .orderBy(asc(foodLog.createdAt));
      const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      for (const item of items) {
        totals.kcal += item.kcal;
        totals.protein += item.protein ?? 0;
        totals.carbs += item.carbs ?? 0;
        totals.fat += item.fat ?? 0;
        totals.fiber += item.fiber ?? 0;
      }
      return { items, totals };
    }),

  // Quick-add source: last 10 distinct names. SQLite serves bare columns from
  // the max(date) row, so kcal/meal are each name's latest values.
  recent: protectedProcedure.handler(async ({ context }) => {
    const items = await context.db
      .select({
        name: foodLog.name,
        kcal: foodLog.kcal,
        meal: foodLog.meal,
        lastDate: sql<string>`max(${foodLog.date})`,
      })
      .from(foodLog)
      .where(eq(foodLog.userId, context.session.user.id))
      .groupBy(foodLog.name)
      .orderBy(desc(sql`max(${foodLog.date})`))
      .limit(10);
    return { items };
  }),
};
