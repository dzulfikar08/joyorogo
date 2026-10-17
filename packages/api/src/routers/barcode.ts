import { ORPCError } from "@orpc/server";
import { and, between, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { barcodeProduct } from "@joyorogo/db/schema/barcode";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import type { Locale } from "@joyorogo/i18n";

import { protectedProcedure } from "../index";
import { SourceUnavailableError, normalizeBarcode } from "../lib/barcode";
import type { BarcodeLookup } from "../lib/barcode";
import { LabelReadError, readLabelPhotos } from "../lib/barcode-label";
import type { LabelDraft } from "../lib/barcode-nutrition";
import {
  confirmationInput,
  lookupBarcode,
  recordContribution,
  withOwnership,
} from "../lib/barcode-lookup";
import type { ContributionInput, ContributionOutcome, ContributionResult } from "../lib/barcode-lookup";
import { barcodeSources } from "../lib/barcode-sources";
import { jakartaToday } from "../lib/engine";
import { serverT } from "../lib/messages";
import { wibDayBounds } from "../lib/tiers";
import { DEFAULT_VISION_MODEL } from "../lib/vision";

/** Label photo reads per user per WIB day, failures included (each one costs a model call). */
export const MAX_LABEL_READS_PER_DAY = 12;

const codeSchema = z.string().trim().min(1).max(32);

const photoSchema = z.object({
  // Clients send <=1280 px JPEGs (~0.3 MB base64); 8 MB caps abuse.
  imageBase64: z.base64().min(50).max(8_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

const nutrient = z.number().min(0).max(1000).nullish();

const contributeSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).nullish(),
  quantity: z.string().trim().max(60).nullish(),
  servingSize: z.number().positive().max(5000).nullish(),
  unit: z.enum(["g", "ml"]),
  /** What the numbers below are per: one printed serving, or 100 g/ml. */
  basis: z.enum(["serving", "per100"]),
  kcal: z.number().min(0).max(5000),
  protein: nutrient,
  carbs: nutrient,
  fat: nutrient,
  fiber: nutrient,
  sugar: nutrient,
  /** Re-send after the energy warning when the label really reads that way. */
  confirmEnergyMismatch: z.boolean().optional(),
});

export type ContributeResponse = {
  outcome: ContributionOutcome;
  contributors: number;
  /** The product as every user now sees it, ready to log. */
  lookup: BarcodeLookup;
};

function normalizedCode(raw: string, locale: Locale): string {
  const code = normalizeBarcode(raw);
  if (!code) {
    throw new ORPCError("BAD_REQUEST", { message: serverT(locale, "barcode")("errors.invalidCode") });
  }
  return code;
}

/** A refused contribution as the error clients localize from `data.reason` and show as `message`. */
function contributionError(result: Extract<ContributionResult, { ok: false }>, locale: Locale) {
  const t = serverT(locale, "barcode");
  switch (result.reason) {
    case "implausible":
      return new ORPCError("BAD_REQUEST", { message: t("errors.implausible"), data: { reason: result.reason } });
    case "energy_mismatch":
      return new ORPCError("BAD_REQUEST", { message: t("errors.energyMismatch"), data: { reason: result.reason } });
    case "serving_required":
      return new ORPCError("BAD_REQUEST", { message: t("errors.servingRequired"), data: { reason: result.reason } });
    case "name_invalid":
      return new ORPCError("BAD_REQUEST", { message: t("errors.nameInvalid"), data: { reason: result.reason } });
    case "already_known":
      return new ORPCError("CONFLICT", { message: t("errors.alreadyKnown"), data: { reason: result.reason } });
    case "daily_limit":
      return new ORPCError("TOO_MANY_REQUESTS", {
        message: t("errors.contributionLimit"),
        data: { reason: result.reason },
      });
  }
}

function labelReadError(error: unknown, locale: Locale) {
  const t = serverT(locale, "barcode");
  const reason = error instanceof LabelReadError ? error.reason : "failed";
  const key = {
    unclear: "errors.labelUnclear",
    not_label: "errors.labelNotLabel",
    timeout: "errors.labelTimeout",
    failed: "errors.labelFailed",
  } as const;
  return new ORPCError(
    reason === "unclear" || reason === "not_label" ? "UNPROCESSABLE_CONTENT" : "INTERNAL_SERVER_ERROR",
    { message: t(key[reason]), data: { reason } },
  );
}

export const barcodeRouter = {
  // Looks a scanned or typed code up: our own rows (label photos) first, then
  // each external source, all through the shared D1 cache. A fresh row never
  // touches a source; when a source is down a stale row is served rather than
  // an error, and outages are never cached as "not found".
  lookup: protectedProcedure
    .input(z.object({ code: codeSchema }))
    .handler(async ({ context, input }): Promise<BarcodeLookup> => {
      const code = normalizedCode(input.code, context.locale);
      try {
        const result = await lookupBarcode(context.db, code, barcodeSources());
        return await withOwnership(context.db, context.session.user.id, result);
      } catch (error) {
        if (!(error instanceof SourceUnavailableError)) throw error;
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: serverT(context.locale, "barcode")("errors.sourcesUnavailable"),
        });
      }
    }),

  // Reads a photo of the nutrition panel (and optionally the front of the pack)
  // into a draft the user confirms on a form. The photos exist only inside this
  // request: they go to the model and are dropped, never stored or logged.
  // Free of the daily scan quota (it improves the shared database) but capped.
  readLabel: protectedProcedure
    .input(
      z.object({
        code: codeSchema,
        label: photoSchema,
        front: photoSchema.optional(),
      }),
    )
    .handler(async ({ context, input }): Promise<{ draft: LabelDraft }> => {
      normalizedCode(input.code, context.locale);
      const t = serverT(context.locale, "barcode");
      const ai = context.env.AI;
      if (!ai) throw new ORPCError("SERVICE_UNAVAILABLE", { message: t("errors.aiUnavailable") });
      const userId = context.session.user.id;
      const { startMs, endMs } = wibDayBounds(jakartaToday());
      const [used] = await context.db
        .select({ n: sql<number>`count(*)` })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userId, userId),
            eq(aiUsage.scanType, "label"),
            between(aiUsage.createdAt, new Date(startMs), new Date(endMs)),
          ),
        );
      if ((used?.n ?? 0) >= MAX_LABEL_READS_PER_DAY) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: t("errors.labelLimit", { count: MAX_LABEL_READS_PER_DAY }),
          data: { reason: "limit" },
        });
      }
      const model = context.env.AI_VISION_MODEL || DEFAULT_VISION_MODEL;
      const startedAt = Date.now();
      const ledger = (usage: Record<string, unknown>) =>
        context.db
          .insert(aiUsage)
          .values({
            id: crypto.randomUUID(),
            userId,
            model,
            scanType: "label",
            latencyMs: Date.now() - startedAt,
            usageJson: JSON.stringify({ kind: "label", front: input.front !== undefined, ...usage }),
          })
          .then(
            () => undefined,
            (error: unknown) => console.error("[barcode] label ledger insert failed", error),
          );
      try {
        const run = await readLabelPhotos(ai, { model, label: input.label, front: input.front ?? null });
        context.waitUntil(ledger({ ok: true, ...run.usage }));
        return { draft: run.draft };
      } catch (error) {
        const reason = error instanceof LabelReadError ? error.reason : "failed";
        context.waitUntil(ledger({ ok: false, reason }));
        throw labelReadError(error, context.locale);
      }
    }),

  // Saves what the user confirmed on the label form for everyone. Values only.
  contribute: protectedProcedure.input(contributeSchema).handler(async ({ context, input }): Promise<ContributeResponse> => {
    const code = normalizedCode(input.code, context.locale);
    const contribution: ContributionInput = {
      name: input.name,
      brand: input.brand ?? null,
      quantity: input.quantity ?? null,
      servingSize: input.servingSize ?? null,
      unit: input.unit,
      basis: input.basis,
      nutrients: {
        kcal: input.kcal,
        protein: input.protein ?? null,
        carbs: input.carbs ?? null,
        fat: input.fat ?? null,
        fiber: input.fiber ?? null,
        sugar: input.sugar ?? null,
      },
      confirmEnergyMismatch: input.confirmEnergyMismatch,
    };
    const result = await recordContribution(context.db, context.session.user.id, code, contribution);
    if (!result.ok) throw contributionError(result, context.locale);
    return {
      outcome: result.outcome,
      contributors: result.contributors,
      lookup: await withOwnership(context.db, context.session.user.id, result.lookup),
    };
  }),

  // "Angkanya sesuai label": the user checked a community product against the
  // pack and agrees. Counts as their own submission of the shown numbers.
  confirm: protectedProcedure
    .input(z.object({ code: codeSchema }))
    .handler(async ({ context, input }): Promise<ContributeResponse> => {
      const code = normalizedCode(input.code, context.locale);
      const [row] = await context.db.select().from(barcodeProduct).where(eq(barcodeProduct.code, code)).limit(1);
      const contribution = row ? confirmationInput(row) : null;
      if (!contribution) {
        throw new ORPCError("CONFLICT", {
          message: serverT(context.locale, "barcode")("errors.notConfirmable"),
          data: { reason: "not_confirmable" },
        });
      }
      const result = await recordContribution(context.db, context.session.user.id, code, contribution);
      if (!result.ok) throw contributionError(result, context.locale);
      return {
        outcome: result.outcome,
        contributors: result.contributors,
        lookup: await withOwnership(context.db, context.session.user.id, result.lookup),
      };
    }),
};
