import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";
import { aiUsage, scanCorrection } from "@joyorogo/db/schema/fitness";
import { base64ToBytes, makeSticker, newScanId, stickerKey } from "../lib/sticker";
import type { ImagesBinding, StickersBucket } from "../lib/sticker";

import type { AiBinding, ApiEnv } from "../context";
import { protectedProcedure } from "../index";
import type { Database } from "@joyorogo/db";
import { MEALS, jakartaToday } from "../lib/engine";
import { dateSchema, mealSchema } from "../lib/schemas";
import { STORY_EMPTY_ERROR, TRANSCRIBE_MODEL, parseFoodStory, transcribeStory } from "../lib/story";
import { dailyScanQuota, effectiveTier, paywallConfig, scansUsedToday } from "../lib/tiers";
import { FRIENDLY_ERROR, analyzeFoodPhoto } from "../lib/vision";

/**
 * Every AI food call (photo or story) spends one scan of the daily quota.
 * Runs BEFORE inference so a rejected call never costs Neurons.
 */
async function requireAiQuota(db: Database, env: ApiEnv, userId: string): Promise<AiBinding> {
  const ai = env.AI;
  if (!ai) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Layanan AI belum tersedia. Coba lagi nanti.",
    });
  }
  const config = paywallConfig(env);
  const [[userRow], usedToday] = await Promise.all([
    db
      .select({
        tier: user.tier,
        founderUntil: user.founderUntil,
        aiUnlimited: user.aiUnlimited,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
    scansUsedToday(db, userId, jakartaToday()),
  ]);
  const tier = effectiveTier(userRow);
  const quota = userRow?.aiUnlimited ? null : dailyScanQuota(tier, config);
  if (quota !== null && usedToday >= quota) {
    throw new ORPCError("FORBIDDEN", {
      message:
        tier === "founder"
          ? `Batas pengaman Founder tercapai (${quota} scan/hari). Coba lagi besok ya.`
          : `Kuota AI hari ini habis (${quota}/hari). ${
              config.founderDailyCap === null
                ? "Founder buka AI tanpa batas."
                : `Founder dapat ${config.founderDailyCap}/hari.`
            }`,
      data: { paywall: true, tier },
    });
  }
  return ai;
}

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
      const ai = await requireAiQuota(context.db, context.env, userId);

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
      const [scanId] = await Promise.all([
        storeSticker(),
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
      return { items: analysis.items, scanId };
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
      const ai = await requireAiQuota(context.db, context.env, userId);
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
      return { transcript, items: analysis.items };
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
