import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { foodLog, profile } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dateSchema, mealSchema } from "../lib/schemas";
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
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(0).max(500).optional(),
  carbs: z.number().min(0).max(500).optional(),
  fat: z.number().min(0).max(500).optional(),
  fiber: z.number().min(0).max(500).optional(),
  // [ymin, xmin, ymax, xmax] on 0-1000, as ai.analyzeFood returned it.
  box: z.array(z.number()).length(4).optional(),
});

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
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            fiber: item.fiber,
            source: "ai",
            itemsJson: input.itemsJson,
            scanId: jobs[index]?.scanId,
            photoId,
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
        kcal: z.number().min(0).max(5000),
        protein: z.number().min(0).max(500).optional(),
        carbs: z.number().min(0).max(500).optional(),
        fat: z.number().min(0).max(500).optional(),
        fiber: z.number().min(0).max(500).optional(),
        source: z.enum(["manual", "ai"]).default("manual"),
        itemsJson: z.string().max(10_000).optional(),
        // capability id of the dish sticker generated at scan time
        scanId: z.string().regex(SCAN_ID_RE).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(foodLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date: input.date ?? jakartaToday(),
          meal: input.meal,
          name: input.name,
          kcal: input.kcal,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          fiber: input.fiber,
          source: input.source,
          itemsJson: input.itemsJson,
          scanId: input.scanId,
        })
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .delete(foodLog)
        .where(and(eq(foodLog.id, input.id), eq(foodLog.userId, context.session.user.id)))
        .returning({ scanId: foodLog.scanId, photoId: foodLog.photoId });
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
