import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";
import { aiUsage, scanCorrection } from "@joyorogo/db/schema/fitness";
import { base64ToBytes, makeSticker, newScanId, stickerKey } from "../lib/sticker";
import type { ImagesBinding, StickersBucket } from "../lib/sticker";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dailyScanQuota, effectiveTier, paywallConfig, scansUsedToday } from "../lib/tiers";
import { FRIENDLY_ERROR, analyzeFoodPhoto } from "../lib/vision";

export const aiRouter = {
  analyzeFood: protectedProcedure
    .input(
      z.object({
        // Clients send ≤1024 px JPEGs (~0.2–0.5 MB base64); 8 MB caps abuse.
        imageBase64: z.base64().min(50).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const ai = context.env.AI;
      if (!ai) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: "Layanan AI belum tersedia. Coba lagi nanti.",
        });
      }
      const userId = context.session.user.id;
      const config = paywallConfig(context.env);
      const [[userRow], usedToday] = await Promise.all([
        context.db
          .select({
            tier: user.tier,
            founderUntil: user.founderUntil,
            aiUnlimited: user.aiUnlimited,
          })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1),
        scansUsedToday(context.db, userId, jakartaToday()),
      ]);
      const tier = effectiveTier(userRow);
      // Reject BEFORE inference so a rejected call never costs Neurons.
      const quota = userRow?.aiUnlimited ? null : dailyScanQuota(tier, config);
      if (quota !== null && usedToday >= quota) {
        throw new ORPCError("FORBIDDEN", {
          message:
            tier === "founder"
              ? `Batas pengaman Founder tercapai (${quota} scan/hari). Coba lagi besok ya.`
              : `Kuota scan hari ini habis (${quota}/hari). Founder buka scan tanpa batas.`,
          data: { paywall: true, tier },
        });
      }

      const startedAt = Date.now();
      const stickers = context.env.STICKERS as StickersBucket | undefined;
      // Stiker piring: segmentation runs concurrently with inference so it
      // adds no latency (a failed scan wastes one transform — scans rarely
      // fail since thinking was disabled). No bucket, no cutout.
      const cutout = stickers
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
