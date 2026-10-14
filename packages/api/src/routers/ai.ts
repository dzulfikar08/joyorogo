import { ORPCError } from "@orpc/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { aiUsage, scanCorrection, scanFeedback } from "@joyorogo/db/schema/fitness";
import {
  SCAN_ID_RE,
  base64ToBytes,
  bytesToBase64,
  makeSticker,
  newScanId,
  scanSrcKey,
  stickerKey,
} from "../lib/sticker";
import type { ImagesBinding, StickersBucket } from "../lib/sticker";

import { protectedProcedure } from "../index";
import { MEALS, jakartaToday } from "../lib/engine";
import { dateSchema, mealSchema } from "../lib/schemas";
import { STORY_EMPTY_ERROR, TRANSCRIBE_MODEL, parseFoodStory, transcribeStory } from "../lib/story";
import { MAX_SCAN_RETRIES, requireAiQuota } from "../lib/quota";
import { wibDayBounds } from "../lib/tiers";
import { FRIENDLY_ERROR, analyzeFoodPhoto } from "../lib/vision";

export const aiRouter = {
  analyzeFood: protectedProcedure
    .input(
      z.object({
        // Clients send ≤1024 px JPEGs (~0.2–0.5 MB base64); 8 MB caps abuse.
        imageBase64: z.base64().min(50).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        // Clients that crop per item from the boxes (and save via
        // food.addScan) skip the legacy whole-plate sticker.
        crops: z.boolean().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { ai, quotaReached } = await requireAiQuota(context.db, context.env, userId);

      // "Hasilnya akurat?" cadence: ask after every scan for a brand-new user
      // (first 3 scans ever), otherwise at most once per WIB day. Counted
      // before this scan's ledger row lands; awaited after inference so the
      // roundtrips hide behind the model call. A `dilewati` dismissal counts
      // as asked — closing the card must not re-prompt all day.
      const feedbackGate = Promise.all([
        context.db
          .select({ n: sql<number>`count(*)` })
          .from(aiUsage)
          .where(and(eq(aiUsage.userId, userId), eq(aiUsage.scanType, "user"))),
        context.db
          .select({ n: sql<number>`count(*)` })
          .from(scanFeedback)
          .where(
            and(
              eq(scanFeedback.userId, userId),
              gte(scanFeedback.createdAt, new Date(wibDayBounds(jakartaToday()).startMs)),
            ),
          ),
      ]);

      const startedAt = Date.now();
      const stickers = context.env.STICKERS as StickersBucket | undefined;
      // Legacy stiker piring (older app builds): segmentation runs
      // concurrently with inference so it adds no latency. No bucket, no cutout.
      const cutout =
        stickers && !input.crops
          ? makeSticker(
              context.env.IMAGES as ImagesBinding | undefined,
              base64ToBytes(input.imageBase64),
            )
          : Promise.resolve(null);
      let analysis;
      try {
        analysis = await analyzeFoodPhoto(ai, {
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
          model: context.env.AI_VISION_MODEL || undefined,
        });
      } catch (error) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: error instanceof Error ? error.message : FRIENDLY_ERROR,
        });
      }
      const latencyMs = Date.now() - startedAt;
      const sticker = await cutout;
      const storeSticker = async (): Promise<string | null> => {
        if (!stickers || !sticker) return null;
        const scanId = newScanId();
        try {
          await stickers.put(stickerKey(scanId), sticker, {
            httpMetadata: { contentType: "image/png" },
          });
          return scanId;
        } catch {
          return null;
        }
      };
      // Hitung ulang support: keep the exact photo the model saw so a retry
      // sends only the id — no recapture, no reupload, no second scan of the
      // daily quota. The counter metadata `n` (retries used) is the
      // server-side cap; scan-src/ objects are short-lived via lifecycle.
      const [scanId, photoId] = await Promise.all([
        storeSticker(),
        (async (): Promise<string | null> => {
          if (!stickers) return null;
          const photoId = newScanId();
          try {
            await stickers.put(scanSrcKey(userId, photoId), base64ToBytes(input.imageBase64), {
              httpMetadata: { contentType: input.mimeType },
              customMetadata: { n: "0" },
            });
            return photoId;
          } catch {
            return null;
          }
        })(),
        // Charge only successful analyses — quota counts these ledger rows.
        context.db.insert(aiUsage).values({
          id: crypto.randomUUID(),
          userId,
          model: analysis.model,
          scanType: "user",
          latencyMs,
          usageJson: analysis.usage ? JSON.stringify(analysis.usage) : null,
        }),
      ]);
      const [[scansEverRow], [askedTodayRow]] = await feedbackGate;
      return {
        items: analysis.items,
        scanId,
        photoId,
        retriesLeft: photoId ? MAX_SCAN_RETRIES : 0,
        quotaReached,
        model: analysis.model,
        askFeedback: (scansEverRow?.n ?? 0) < 3 || (askedTodayRow?.n ?? 0) === 0,
      };
    }),
  // "Hitung ulang": re-run the model on the SAME photo after the user judged
  // the answer wrong. Sends only the photo id — the pixels never travel
  // again — and never spends the daily scan quota: the per-photo cap
  // (MAX_SCAN_RETRIES, counted in the object's metadata) is the only limit.
  analyzeFoodRetry: protectedProcedure
    .input(
      z.object({
        photoId: z.string().regex(SCAN_ID_RE),
        hint: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const ai = context.env.AI;
      if (!ai) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: "Layanan AI belum tersedia. Coba lagi nanti.",
        });
      }
      const bucket = context.env.STICKERS;
      if (!bucket) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Penyimpanan foto belum tersedia.",
        });
      }
      // The key embeds the owner: another user's id 404s by construction.
      const key = scanSrcKey(userId, input.photoId);
      const photo = await bucket.get(key).catch(() => null);
      if (!photo) {
        throw new ORPCError("NOT_FOUND", {
          message: "Foto pemindaian tidak ditemukan. Foto ulang dulu ya.",
        });
      }
      const used = Number.parseInt(photo.customMetadata?.n ?? "0", 10) || 0;
      if (used >= MAX_SCAN_RETRIES) {
        throw new ORPCError("FORBIDDEN", {
          message: `Batas hitung ulang foto ini habis (${MAX_SCAN_RETRIES} kali). Foto ulang saja ya.`,
          data: { retriesExhausted: true },
        });
      }
      const bytes = await photo.arrayBuffer();
      const mimeType = photo.httpMetadata?.contentType;
      const startedAt = Date.now();
      let analysis;
      try {
        analysis = await analyzeFoodPhoto(ai, {
          imageBase64: bytesToBase64(bytes),
          mimeType:
            mimeType === "image/png" || mimeType === "image/webp" ? mimeType : "image/jpeg",
          model: context.env.AI_VISION_MODEL || undefined,
          retry: { hint: input.hint },
        });
      } catch (error) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: error instanceof Error ? error.message : FRIENDLY_ERROR,
        });
      }
      // Both writes come after inference: a failed or abandoned attempt
      // never consumes the cap, and ledger rows marked "retry" stay outside
      // the daily quota count (scansUsedToday only counts "user").
      await Promise.all([
        bucket.put(key, bytes, {
          httpMetadata: photo.httpMetadata,
          customMetadata: { n: String(used + 1) },
        }),
        context.db.insert(aiUsage).values({
          id: crypto.randomUUID(),
          userId,
          model: analysis.model,
          scanType: "retry",
          latencyMs: Date.now() - startedAt,
          usageJson: JSON.stringify({
            kind: "retry",
            ...(input.hint ? { hint: input.hint } : {}),
            ...analysis.usage,
          }),
        }),
      ]);
      return { items: analysis.items, retriesLeft: MAX_SCAN_RETRIES - (used + 1), model: analysis.model };
    }),
  // Feedback on a scan result ("Hasilnya akurat?"). Fire-and-forget from the
  // clients — failures here must never block anything. A dismissal is stored
  // as "dilewati" so the once-per-WIB-day cadence holds across devices.
  saveScanFeedback: protectedProcedure
    .input(
      z.object({
        photoId: z.string().regex(SCAN_ID_RE),
        rating: z.enum(["akurat", "kurang_akurat", "salah", "dilewati"]),
        reasons: z
          .array(z.enum(["porsi", "makanan", "kcal_tinggi", "kcal_rendah"]))
          .max(4)
          .optional(),
        note: z.string().trim().min(1).max(300).optional(),
        // True when the rated result came from a "Hitung ulang" pass.
        afterRetry: z.boolean().optional(),
        model: z.string().max(100).optional(),
        source: z.enum(["web", "native"]),
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.insert(scanFeedback).values({
        id: crypto.randomUUID(),
        userId: context.session.user.id,
        photoId: input.photoId,
        rating: input.rating,
        reasonsJson: input.reasons?.length ? JSON.stringify(input.reasons) : null,
        note: input.note,
        afterRetry: input.afterRetry ?? false,
        model: input.model,
        source: input.source,
      });
      return { ok: true };
    }),
  // "Ceritakan": a typed or spoken story of what was eaten → items with meal
  // slot and date, for the client's review screen. Nothing is logged here.
  describeFood: protectedProcedure
    .input(
      z
        .object({
          text: z.string().trim().min(2).max(1000).optional(),
          // ≤60 s voice notes: ~0.5 MB webm/opus, ~1 MB m4a, base64-inflated.
          audioBase64: z.base64().min(100).max(3_000_000).optional(),
          // Meal slot the user opened the sheet from; omitted for the global entry.
          meal: mealSchema.optional(),
          // Day the user is viewing — where a story without day words lands.
          date: dateSchema.optional(),
          // The client's active slots (Ramadan swaps in sahur/berbuka).
          slots: z.array(mealSchema).min(1).max(MEALS.length),
        })
        .refine((v) => (v.text === undefined) !== (v.audioBase64 === undefined), {
          message: "Kirim teks atau rekaman suara.",
        }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { ai, quotaReached } = await requireAiQuota(context.db, context.env, userId);
      const startedAt = Date.now();
      let transcript = input.text ?? "";
      let transcribeUsage: Record<string, unknown> | null = null;
      let analysis;
      try {
        if (input.audioBase64 !== undefined) {
          const heard = await transcribeStory(ai, input.audioBase64);
          transcript = heard.text;
          transcribeUsage = heard.usage;
        }
        analysis = await parseFoodStory(ai, {
          text: transcript,
          slots: [...new Set(input.slots)],
          defaultMeal: input.meal,
          referenceDate: input.date,
          model: context.env.AI_VISION_MODEL || undefined,
        });
      } catch (error) {
        // The transcript still helps the user fix what the AI misheard.
        throw new ORPCError("UNPROCESSABLE_CONTENT", {
          message: error instanceof Error ? error.message : STORY_EMPTY_ERROR,
          data: { transcript: transcript || null },
        });
      }
      // Charge only stories that produced food — quota counts these rows.
      await context.db.insert(aiUsage).values({
        id: crypto.randomUUID(),
        userId,
        model: analysis.model,
        scanType: "user",
        latencyMs: Date.now() - startedAt,
        usageJson: JSON.stringify({
          kind: input.audioBase64 !== undefined ? "voice" : "text",
          parse: analysis.usage,
          ...(input.audioBase64 !== undefined
            ? { transcribe: { model: TRANSCRIBE_MODEL, ...transcribeUsage } }
            : {}),
        }),
      });
      return { transcript, items: analysis.items, quotaReached };
    }),
  // Miss log (JRG-32): the client posts what the AI estimated vs what the user
  // actually kept, per item, at save time. Fire-and-forget from the clients —
  // failures here must never block logging a meal.
  logCorrections: protectedProcedure
    .input(
      z.object({
        source: z.enum(["web", "native"]),
        items: z
          .array(
            z.object({
              meal: z.enum(["sarapan", "makan_siang", "makan_malam", "snack", "sahur", "berbuka"]),
              dishName: z.string().min(1).max(120),
              aiKcal: z.number().min(0).max(20000),
              savedKcal: z.number().min(0).max(20000),
              aiGrams: z.number().min(0).max(5000).nullable().optional(),
              aiConfidence: z.number().min(0).max(1).nullable().optional(),
            }),
          )
          .min(1)
          .max(30),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await context.db.insert(scanCorrection).values(
        input.items.map((item) => ({
          id: crypto.randomUUID(),
          userId,
          source: input.source,
          meal: item.meal,
          dishName: item.dishName,
          aiKcal: item.aiKcal,
          savedKcal: item.savedKcal,
          aiGrams: item.aiGrams ?? null,
          aiConfidence: item.aiConfidence ?? null,
        })),
      );
      return { logged: input.items.length };
    }),
};
