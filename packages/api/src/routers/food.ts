import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";

import { foodLog, profile } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";

import { protectedProcedure } from "../index";
import { assertEatenAt, eatenAtDay, eatenAtProblem, eatenAtSchema } from "../lib/eaten-at";
import { MEALS, jakartaToday } from "../lib/engine";
import { copyLoggedMeal, recentMealGroups } from "../lib/meal-copy";
import { storyTarget } from "../lib/meal-reference";
import { MAX_GRAMS, MAX_KCAL, resolvePortion } from "../lib/portion";
import { estimateMacros } from "../lib/macro-estimate";
import { recalcRow } from "../lib/plate-recalc";
import type { RecalcValues } from "../lib/plate-recalc";
import { toStoredCoords } from "../lib/places";
import { userZone } from "../lib/user-zone";
import { dateSchema, mealSchema, pastDateSchema } from "../lib/schemas";
import { IMPORT_EARLIEST_DAY, IMPORT_SOURCE } from "../lib/history-import";
import {
  SCAN_ID_RE,
  base64ToBytes,
  newScanId,
  photoKey,
  pendingStickerKey,
  stickerKey,
  storeStickers,
} from "../lib/sticker";
import { purgeUnreferencedMedia } from "./saved-food";
import type { StickerJob } from "../lib/sticker";
import { datasetEnabled, recordFinal } from "../lib/dataset";
import { recordKeptSaved } from "../lib/feedback-keep";
import { compactItems, recordSessionSaved } from "../lib/scan-outcome";
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
  // Cutout id from ai.scanSticker, when the client already has one for this item.
  scanId: z.string().regex(SCAN_ID_RE).optional(),
});

// Price attaches to the plate, never to components: one scan, one Cerita meal,
// or one manual entry is one plate row that its food_log rows point at.
const plateInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  place: z.string().trim().min(1).max(200).optional(),
  priceIdr: z.number().int().min(0).max(100_000_000).optional(),
  // Opt-in location of the place; stored rounded to ~100 m and only with a place.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
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
    plate?: z.infer<typeof plateInput>;
  },
): Promise<string | null> {
  if (!values.plate) return null;
  const coords = toStoredCoords(values.plate.lat, values.plate.lng);
  const [row] = await db
    .insert(plate)
    .values({
      id: crypto.randomUUID(),
      userId,
      date: values.date,
      meal: values.meal,
      name: values.plate.name?.trim() || values.fallbackName,
      place: values.plate.place ?? null,
      ...(values.plate.place ? { lat: coords?.lat ?? null, lng: coords?.lng ?? null } : {}),
      priceIdr: values.plate.priceIdr ?? null,
    })
    .returning({ id: plate.id });
  return row?.id ?? null;
}

/** Most meals one `importHistory` call takes. */
const IMPORT_MAX_MEALS = 100;

export const foodRouter = {
  /**
   * Past meals from another app (JoyoFit's Huawei Health import), as diary rows with `source: "huawei"`. Idempotent: a row's
   * id is built from the user and the import's own `key`, so the same record sent again is a no-op; a meal the person already
   * has on that day and slot with the same kcal (to the kcal) is not added a second time. Only days before today are taken, and the
   * rows are kept out of streaks and challenge days (`source = "huawei"` is filtered there), so a backdated import
   * cannot make or break a streak. `eatenAt` is kept only when it falls on the diary day in the person's zone. Answers
   * how many were added and how many skipped.
   */
  importHistory: protectedProcedure
    .input(
      z.object({
        meals: z
          .array(
            z.object({
              key: z.string().min(1).max(80).regex(/^[A-Za-z0-9:_.-]+$/),
              date: dateSchema,
              meal: mealSchema,
              name: z.string().trim().min(1).max(200),
              kcal: z.number().min(0).max(MAX_KCAL),
              protein: z.number().min(0).max(500).optional(),
              carbs: z.number().min(0).max(500).optional(),
              fat: z.number().min(0).max(500).optional(),
              eatenAt: eatenAtSchema.optional(),
            }),
          )
          .min(1)
          .max(IMPORT_MAX_MEALS),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const zone = await userZone(context);
      const today = jakartaToday(undefined, zone);
      let added = 0;
      for (const m of input.meals) {
        if (m.date >= today || m.date < IMPORT_EARLIEST_DAY) continue;
        const twin = await context.db
          .select({ id: foodLog.id })
          .from(foodLog)
          .where(
            and(
              eq(foodLog.userId, userId),
              eq(foodLog.date, m.date),
              eq(foodLog.meal, m.meal),
              sql`abs(${foodLog.kcal} - ${m.kcal}) < 1`,
              sql`${foodLog.source} != ${IMPORT_SOURCE}`,
            ),
          )
          .limit(1);
        if (twin.length > 0) continue;
        const eatenAt =
          m.eatenAt !== undefined && m.eatenAt <= Date.now() && eatenAtDay(m.eatenAt, zone) === m.date ? m.eatenAt : null;
        const rows = await context.db
          .insert(foodLog)
          .values({
            id: `${IMPORT_SOURCE}:${userId}:${m.key}`,
            userId,
            date: m.date,
            meal: m.meal,
            name: m.name,
            kcal: m.kcal,
            protein: m.protein,
            carbs: m.carbs,
            fat: m.fat,
            source: IMPORT_SOURCE,
            eatenAt,
          })
          .onConflictDoNothing({ target: foodLog.id })
          .returning({ id: foodLog.id });
        added += rows.length;
      }
      return { added, skipped: input.meals.length - added };
    }),

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
        // Scan session id (ai.analyzeFood's photoId): lets the owner's dataset
        // record the final saved items next to the AI answer. Ignored for everyone else.
        scanPhotoId: z.string().regex(SCAN_ID_RE).optional(),
        plate: plateInput.optional(),
        eatenAt: eatenAtSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const zone = await userZone(context);
      assertEatenAt(input.eatenAt, input.date ?? jakartaToday(undefined, zone), zone);
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
      // Stickers ai.scanSticker already cut during review are promoted from
      // the expiring scan-src/ prefix to scans/ instead of cut again. Anything
      // missing (still running, failed, expired, not ours) falls through to
      // the background job below.
      const promoted = await Promise.all(
        input.items.map(async (item): Promise<string | null> => {
          if (!bucket || !item.scanId) return null;
          try {
            const pending = await bucket.get(pendingStickerKey(item.scanId));
            if (!pending || pending.customMetadata?.userId !== userId) return null;
            await bucket.put(stickerKey(item.scanId), await pending.arrayBuffer(), {
              httpMetadata: { contentType: "image/png" },
            });
            return item.scanId;
          } catch {
            return null;
          }
        }),
      );
      const jobs: Array<StickerJob | null> = input.items.map((_, index) => {
        if (!bucket || !images || promoted[index]) return null;
        const box = boxes[index];
        if (box) return { scanId: newScanId(), box };
        return !anyBox && index === 0 ? { scanId: newScanId() } : null;
      });
      const date = input.date ?? jakartaToday(undefined, zone);
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
            eatenAt: input.eatenAt,
            itemsJson: input.itemsJson,
            scanId: promoted[index] ?? jobs[index]?.scanId,
            photoId,
            plateId,
          })),
        )
        .returning();
      const queued = jobs.filter((job): job is StickerJob => job !== null);
      if (bucket && queued.length > 0) {
        context.waitUntil(storeStickers(images, bucket, bytes, queued));
      }
      // Implicit accuracy label of this scan session: saved as the AI answered,
      // or with edits (lib/scan-outcome.ts). A scan the user opted in to keep
      // (feedback consent) gets its saved items added to the kept meta.
      if (input.scanPhotoId) {
        const scanPhotoId = input.scanPhotoId;
        context.waitUntil(
          recordSessionSaved(context.db, userId, scanPhotoId, rows)
            .then(async (session) => {
              if (session?.keep && bucket) {
                await recordKeptSaved(bucket, userId, scanPhotoId, {
                  items: compactItems(rows),
                  at: session.savedAt ?? Date.now(),
                });
              }
            })
            .catch((error: unknown) => console.error("[food] scan outcome failed", error)),
        );
      }
      if (input.scanPhotoId && bucket && datasetEnabled(context.env, userId)) {
        context.waitUntil(
          recordFinal(bucket, userId, input.scanPhotoId, {
            meal: input.meal,
            date,
            items: rows.map((row) => ({
              name: row.name,
              grams: row.grams ?? undefined,
              kcal: row.kcal,
              protein: row.protein ?? undefined,
              carbs: row.carbs ?? undefined,
              fat: row.fat ?? undefined,
              fiber: row.fiber ?? undefined,
            })),
          }),
        );
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
        source: z.enum(["manual", "ai", "barcode", "copy"]).default("manual"),
        itemsJson: z.string().max(10_000).optional(),
        // capability id of the dish sticker generated at scan time
        scanId: z.string().regex(SCAN_ID_RE).optional(),
        plate: plateInput.optional(),
        // attach to a plate created by an earlier item of the same Cerita group
        plateId: z.string().optional(),
        eatenAt: eatenAtSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      assertEatenAt(input.eatenAt, input.date ?? jakartaToday(undefined, zone), zone);
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
      const date = input.date ?? jakartaToday(undefined, zone);
      // A typed name + kcal with no macros at all would count as 0 g in every total: resolve P/K/L from the
      // name (food table, then the story text parse). Photo, barcode and copied rows keep what they carry.
      const macros =
        input.source === "manual" &&
        input.protein === undefined &&
        input.carbs === undefined &&
        input.fat === undefined &&
        input.kcal > 0
          ? await estimateMacros(
              {
                db: context.db,
                ai: context.env.AI,
                model: context.env.AI_VISION_MODEL || undefined,
                userId: context.session.user.id,
                locale: context.locale,
                region: context.region,
                zone,
              },
              input.name,
              input.kcal,
            )
          : null;
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
          protein: macros?.protein ?? input.protein,
          carbs: macros?.carbs ?? input.carbs,
          fat: macros?.fat ?? input.fat,
          fiber: input.fiber,
          source: input.source,
          eatenAt: input.eatenAt,
          itemsJson: input.itemsJson,
          scanId: input.scanId,
          plateId,
        })
        .returning();
      return row;
    }),

  // Edits one logged row: name, portion (weight, kcal, macros; see
  // resolvePortion for how they follow each other) and/or day (day key). Stickers
  // and photos ride along untouched; when the row was the last component of its
  // plate on the old day, the plate moves with it so the grouping never splits.
  // Plate totals are derived from rows, and price stays on the plate, so
  // nothing else needs rewriting.
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        date: pastDateSchema.optional(),
        meal: mealSchema.optional(),
        name: z.string().trim().min(1).max(200).optional(),
        grams: z.number().min(1).max(MAX_GRAMS).optional(),
        kcal: z.number().min(0).max(MAX_KCAL).optional(),
        protein: z.number().min(0).max(500).optional(),
        carbs: z.number().min(0).max(500).optional(),
        fat: z.number().min(0).max(500).optional(),
        fiber: z.number().min(0).max(500).optional(),
        // null clears the time
        eatenAt: eatenAtSchema.nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const zone = await userZone(context);
      const [row] = await context.db
        .select()
        .from(foodLog)
        .where(and(eq(foodLog.id, input.id), eq(foodLog.userId, userId)))
        .limit(1);
      if (!row) return null;
      // Portion fields resolve against the stored row (weight <-> kcal <-> macros).
      const { id: _id, date, meal, name, eatenAt, ...patch } = input;
      // A moved day without a new time drops a stored time that no longer fits it.
      const nextDate = date ?? row.date;
      let nextEatenAt: number | null | undefined;
      if (typeof eatenAt === "number") {
        assertEatenAt(eatenAt, nextDate, zone);
        nextEatenAt = eatenAt;
      } else if (eatenAt === null) {
        nextEatenAt = null;
      } else if (date && row.eatenAt != null && eatenAtProblem(row.eatenAt, nextDate, new Date(row.eatenAt), zone)) {
        nextEatenAt = null;
      }
      const next = resolvePortion(row, patch);
      const [updated] = await context.db
        .update(foodLog)
        .set({
          ...next,
          ...(name ? { name } : {}),
          ...(date ? { date } : {}),
          ...(meal ? { meal } : {}),
          ...(nextEatenAt !== undefined ? { eatenAt: nextEatenAt } : {}),
        })
        .where(and(eq(foodLog.id, input.id), eq(foodLog.userId, userId)))
        .returning();
      // The plate follows its last component to a new day or slot.
      const movedDay = date && row.date !== date;
      const movedMeal = meal && row.meal !== meal;
      if (row.plateId && (movedDay || movedMeal)) {
        const [remaining] = await context.db
          .select({ id: foodLog.id })
          .from(foodLog)
          .where(
            and(
              eq(foodLog.userId, userId),
              eq(foodLog.plateId, row.plateId),
              eq(foodLog.date, row.date),
              eq(foodLog.meal, row.meal),
            ),
          )
          .limit(1);
        if (!remaining) {
          await context.db
            .update(plate)
            .set({ ...(movedDay ? { date } : {}), ...(movedMeal ? { meal } : {}) })
            .where(and(eq(plate.id, row.plateId), eq(plate.userId, userId)));
        }
      }
      return updated ?? null;
    }),

  // "Hitung ulang kalori" on a plate: re-derives each AI row's kcal from its name
  // and weight (lib/plate-recalc.ts). Without `apply` it only previews the
  // before/after of the rows that would change; with it, the same rows are written.
  // Manual, barcode and user-edited rows are never touched.
  recalculatePlate: protectedProcedure
    .input(z.object({ plateId: z.string(), apply: z.boolean().default(false) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [owned] = await context.db
        .select({ id: plate.id })
        .from(plate)
        .where(and(eq(plate.id, input.plateId), eq(plate.userId, userId)))
        .limit(1);
      if (!owned) throw new ORPCError("NOT_FOUND", { message: "Piring tidak ditemukan" });
      const rows = await context.db
        .select()
        .from(foodLog)
        .where(and(eq(foodLog.userId, userId), eq(foodLog.plateId, input.plateId)))
        .orderBy(asc(foodLog.createdAt));
      const items: Array<{
        id: string;
        name: string;
        grams: number | null;
        before: RecalcValues;
        after: RecalcValues;
      }> = [];
      for (const row of rows) {
        const next = recalcRow(row, context.region);
        if (typeof next === "string") continue;
        items.push({
          id: row.id,
          name: row.name,
          grams: row.grams,
          before: {
            kcal: row.kcal,
            protein: row.protein,
            carbs: row.carbs,
            fat: row.fat,
            fiber: row.fiber,
          },
          after: next,
        });
      }
      // Written rows come back whole so the native app can re-mirror them to Health Connect.
      const updated: Array<typeof foodLog.$inferSelect> = [];
      if (input.apply) {
        for (const item of items) {
          const [row] = await context.db
            .update(foodLog)
            .set(item.after)
            .where(and(eq(foodLog.id, item.id), eq(foodLog.userId, userId)))
            .returning();
          if (row) updated.push(row);
        }
      }
      const before = rows.reduce((sum, row) => sum + row.kcal, 0);
      const after = items.reduce((sum, item) => sum + item.after.kcal - item.before.kcal, before);
      return { applied: input.apply, items, updated, totals: { before, after } };
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
      await purgeUnreferencedMedia(context.db, context.env.STICKERS, context.session.user.id, row ? [row] : []);
      return { ok: true };
    }),

  listByDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const items = await context.db
        .select()
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, context.session.user.id),
            eq(foodLog.date, input.date ?? jakartaToday(undefined, zone)),
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
  // the max(date) row, so kcal, grams and the macros are each name's latest
  // values, all from the same row. They ride along so a one-tap chip logs the
  // same P/K/L as the row it repeats instead of a kcal-only entry.
  recent: protectedProcedure.handler(async ({ context }) => {
    const items = await context.db
      .select({
        name: foodLog.name,
        kcal: foodLog.kcal,
        grams: foodLog.grams,
        protein: foodLog.protein,
        carbs: foodLog.carbs,
        fat: foodLog.fat,
        fiber: foodLog.fiber,
        meal: foodLog.meal,
        scanId: foodLog.scanId,
        lastDate: sql<string>`max(${foodLog.date})`,
      })
      .from(foodLog)
      .where(eq(foodLog.userId, context.session.user.id))
      .groupBy(foodLog.name)
      .orderBy(desc(sql`max(${foodLog.date})`))
      .limit(10);
    return { items };
  }),

  // "Ulangi makanan" chips: meals logged in the last week, newest first, minus
  // the slot being added to.
  recentMeals: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        meal: mealSchema.optional(),
        slots: z.array(mealSchema).min(1).max(MEALS.length),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      const zone = await userZone(context);
      const target = storyTarget({ now, zone, date: input.date, meal: input.meal, slots: input.slots });
      const groups = await recentMealGroups(context.db, context.session.user.id, now, target, 4, zone);
      return { groups };
    }),

  // One-tap repeat of a logged meal: its rows as review items for the target
  // slot and day, stored nutrition untouched. Nothing is saved until the client
  // confirms through add, so the copies get their own ids.
  copyMeal: protectedProcedure
    .input(
      z.object({
        from: z.object({ date: dateSchema, meal: mealSchema }),
        date: dateSchema.optional(),
        meal: mealSchema.optional(),
        slots: z.array(mealSchema).min(1).max(MEALS.length),
      }),
    )
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const target = storyTarget({ now: new Date(), zone, date: input.date, meal: input.meal, slots: input.slots });
      const { items, reference } = await copyLoggedMeal(context.db, context.session.user.id, input.from, target);
      return { transcript: "", items, quotaReached: false, reference };
    }),
};
