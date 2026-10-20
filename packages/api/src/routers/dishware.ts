import { ORPCError } from "@orpc/server";
import { and, between, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import { dishware } from "@joyorogo/db/schema/dishware";

import { protectedProcedure } from "../index";
import type { Context } from "../context";
import {
  DISHWARE_ANALYSES_PER_DAY,
  DISHWARE_KINDS,
  MAX_DESCRIPTION,
  MAX_DIAMETER_CM,
  MAX_DISHWARE,
  MAX_NAME,
  MIN_DIAMETER_CM,
  analyzeDishwarePhoto,
  promptText,
} from "../lib/dishware";
import { dishwareEnabled, loadDishware } from "../lib/dishware-store";
import type { DishwareRow } from "../lib/dishware-store";
import { jakartaToday } from "../lib/engine";
import { serverT } from "../lib/messages";
import { base64ToBytes, dishwarePhotoKey } from "../lib/sticker";
import { wibDayBounds } from "../lib/tiers";
import { DEFAULT_VISION_MODEL } from "../lib/vision";

/** A registration photo as the clients send it: resized to <= 1024 px (~0.1-0.4 MB base64). */
const photoInput = {
  imageBase64: z.base64().min(50).max(4_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
};

const nameInput = z
  .string()
  .transform((value) => promptText(value, MAX_NAME))
  .pipe(z.string().min(1));
const kindInput = z.enum(DISHWARE_KINDS);
const diameterInput = z.number().min(MIN_DIAMETER_CM).max(MAX_DIAMETER_CM);
const widthInput = z.number().min(3).max(MAX_DIAMETER_CM);

type AuthedContext = Context & { session: NonNullable<Context["session"]> };

/** Everything below the allowlist is closed to everyone else: the feature does not exist for them. */
function requireEnabled(context: AuthedContext): void {
  if (!dishwareEnabled(context.env, context.session.user.id)) {
    throw new ORPCError("FORBIDDEN", { message: serverT(context.locale, "errors")("dishware.unavailable") });
  }
}

/** Only the owner's rows are ever matched: another user's id is a NOT_FOUND, not a leak. */
function notFound(context: AuthedContext): ORPCError<"NOT_FOUND", undefined> {
  return new ORPCError("NOT_FOUND", { message: serverT(context.locale, "errors")("dishware.notFound") });
}

function view(row: DishwareRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    diameterCm: row.diameterCm,
    widthCm: row.widthCm,
    diameterSource: row.diameterSource,
    description: row.description,
    // Private, session-checked route (apps/server): the key embeds the owner.
    photoUrl: `/dishware-photo/${row.photoId}`,
    createdAt: row.createdAt.getTime(),
  };
}

/** The describe/measure call costs Workers AI neurons but is not a scan: its own small daily budget, from the ledger. */
async function analyzePhoto(context: AuthedContext, input: { imageBase64: string; mimeType: string }) {
  const t = serverT(context.locale, "errors");
  const ai = context.env.AI;
  if (!ai) throw new ORPCError("SERVICE_UNAVAILABLE", { message: t("ai.unavailable") });
  const userId = context.session.user.id;
  if ((await analysesToday(context.db, userId)) >= DISHWARE_ANALYSES_PER_DAY) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: t("dishware.dailyLimit", { limit: DISHWARE_ANALYSES_PER_DAY }),
    });
  }
  const model = context.env.AI_VISION_MODEL || DEFAULT_VISION_MODEL;
  const startedAt = Date.now();
  try {
    const { usage, ...analysis } = await analyzeDishwarePhoto(ai, { model, ...input });
    context.waitUntil(
      ledger(context.db, userId, model, startedAt, { ...(usage && typeof usage === "object" ? usage : {}), cardSeen: analysis.cardSeen }),
    );
    return analysis;
  } catch (error) {
    console.error("[dishware] analysis failed", error);
    context.waitUntil(ledger(context.db, userId, model, startedAt, { failed: true }));
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("dishware.analysisFailed") });
  }
}

async function analysesToday(db: Database, userId: string): Promise<number> {
  const { startMs, endMs } = wibDayBounds(jakartaToday());
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.scanType, "dishware"),
        between(aiUsage.createdAt, new Date(startMs), new Date(endMs)),
      ),
    );
  return row?.n ?? 0;
}

function ledger(db: Database, userId: string, model: string, startedAt: number, usage: Record<string, unknown>): Promise<void> {
  return db
    .insert(aiUsage)
    .values({
      id: crypto.randomUUID(),
      userId,
      model,
      scanType: "dishware",
      latencyMs: Date.now() - startedAt,
      usageJson: JSON.stringify(usage),
    })
    .then(
      () => undefined,
      (error: unknown) => console.error("[dishware] ledger insert failed", error),
    );
}

/**
 * "Piring saya": the plates and bowls a user eats from, registered once with their real size so a photo
 * scan can read grams against a known diameter (lib/dishware.ts, docs/dishware.md). Allowlisted users only
 * (DISHWARE_USER_IDS); `status` is how clients know whether to show the screen at all.
 */
export const dishwareRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const enabled = dishwareEnabled(context.env, context.session.user.id);
    const plates = enabled ? (await loadDishware(context.db, context.session.user.id)).map(view) : [];
    return { enabled, max: MAX_DISHWARE, plates };
  }),

  // The registration photo read once: how the plate looks (stored as text for the scan prompt) and, with a
  // bank card lying beside it, a diameter estimate for the user to confirm. Stores nothing.
  analyze: protectedProcedure.input(z.object(photoInput)).handler(async ({ context, input }) => {
    requireEnabled(context);
    return analyzePhoto(context, input);
  }),

  create: protectedProcedure
    .input(
      z.object({
        ...photoInput,
        name: nameInput,
        kind: kindInput,
        diameterCm: diameterInput,
        // A lunchbox is a rectangle: diameterCm is its long side, widthCm the short one. Others are round.
        widthCm: widthInput.optional(),
        diameterSource: z.enum(["manual", "card"]).default("manual"),
        // From `analyze`, when the client already ran it; otherwise the description is written here.
        description: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      requireEnabled(context);
      const t = serverT(context.locale, "errors");
      const userId = context.session.user.id;
      const bucket = context.env.STICKERS;
      if (!bucket) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("ai.storageUnavailable") });
      const existing = await loadDishware(context.db, userId);
      if (existing.length >= MAX_DISHWARE) {
        throw new ORPCError("CONFLICT", { message: t("dishware.full", { max: MAX_DISHWARE }) });
      }
      const given = promptText(input.description ?? "", MAX_DESCRIPTION);
      const description = given || (await analyzePhoto(context, input)).description;
      const id = crypto.randomUUID().replaceAll("-", "");
      const photoId = crypto.randomUUID().replaceAll("-", "");
      const key = dishwarePhotoKey(userId, photoId);
      try {
        await bucket.put(key, base64ToBytes(input.imageBase64), { httpMetadata: { contentType: input.mimeType } });
      } catch (error) {
        console.error("[dishware] photo put failed", error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("ai.storageUnavailable") });
      }
      try {
        const [row] = await context.db
          .insert(dishware)
          .values({
            id,
            userId,
            name: input.name,
            kind: input.kind,
            diameterCm: input.diameterCm,
            widthCm: input.kind === "lunchbox" ? (input.widthCm ?? null) : null,
            diameterSource: input.diameterSource,
            description,
            photoId,
          })
          .returning();
        if (!row) throw new Error("insert returned no row");
        return view(row);
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        throw error;
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        name: nameInput.optional(),
        kind: kindInput.optional(),
        diameterCm: diameterInput.optional(),
        widthCm: widthInput.nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      requireEnabled(context);
      const userId = context.session.user.id;
      const [current] = await context.db
        .select()
        .from(dishware)
        .where(and(eq(dishware.id, input.id), eq(dishware.userId, userId)))
        .limit(1);
      if (!current) throw notFound(context);
      const kind = input.kind ?? current.kind;
      const [row] = await context.db
        .update(dishware)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          kind,
          // A typed diameter replaces whatever the card estimated.
          ...(input.diameterCm !== undefined ? { diameterCm: input.diameterCm, diameterSource: "manual" as const } : {}),
          widthCm: kind === "lunchbox" ? (input.widthCm === undefined ? current.widthCm : input.widthCm) : null,
        })
        .where(and(eq(dishware.id, input.id), eq(dishware.userId, userId)))
        .returning();
      if (!row) throw notFound(context);
      return view(row);
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .handler(async ({ context, input }) => {
      requireEnabled(context);
      const userId = context.session.user.id;
      const [row] = await context.db
        .delete(dishware)
        .where(and(eq(dishware.id, input.id), eq(dishware.userId, userId)))
        .returning();
      if (!row) throw notFound(context);
      await context.env.STICKERS?.delete(dishwarePhotoKey(userId, row.photoId)).catch((error: unknown) =>
        console.error("[dishware] photo delete failed", error),
      );
      return { ok: true as const };
    }),
};
