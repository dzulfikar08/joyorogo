import { ORPCError } from "@orpc/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import type { Locale } from "@joyorogo/i18n";
import { aiUsage, scanCorrection, scanFeedback } from "@joyorogo/db/schema/fitness";
import {
  SCAN_ID_RE,
  base64ToBytes,
  bytesToBase64,
  makeSticker,
  makeWholeCutout,
  newScanId,
  readPhotoSize,
  runScanStickers,
  scanSrcKey,
  stickerKey,
  claimBoxSticker,
  cutBoxSticker,
  markBoxPending,
  waitBoxSticker,
} from "../lib/sticker";
import type {
  ImagesBinding,
  PhotoSize,
  ScanStickerTiming,
  StickersBucket,
  WholeCutout,
} from "../lib/sticker";

import { protectedProcedure } from "../index";
import { serverT } from "../lib/messages";
import { scanFailMessage } from "../lib/scan-fail-message";
import { MEALS, jakartaToday } from "../lib/engine";
import { dateSchema, mealSchema } from "../lib/schemas";
import { TRANSCRIBE_MODEL, parseFoodStory, transcribeStory } from "../lib/story";
import { MAX_SCAN_RETRIES, requireAiQuota } from "../lib/quota";
import { wibDayBounds } from "../lib/tiers";
import { DEFAULT_VISION_MODEL, VisionError, analyzeFoodPhoto, normalizeBox } from "../lib/vision";
import type { ItemBox, VisionAnalysis, VisionEvent } from "../lib/vision";
import { EventChannel } from "../lib/event-channel";
import type { ScanStreamEvent } from "../lib/scan-live";
import type { Context } from "../context";
import { assertCorrectionAllowed, correctionsLeft, correctionsUsed } from "../lib/correct-limit";
import {
  datasetEnabled,
  recordCorrection,
  recordFeedback,
  recordRetry,
  recordScan,
} from "../lib/dataset";
import { keepFeedbackPhoto } from "../lib/feedback-keep";
import {
  FEEDBACK_MARK,
  buildFeedbackReasons,
  compactItems,
  loadSession,
  markRetryTapFeedback,
  markSessionKeep,
  recordSessionCorrection,
  recordSessionRetry,
  retryJustRan,
} from "../lib/scan-outcome";
import {
  CorrectionError,
  DEFAULT_CORRECT_MODEL,
  MAX_CORRECTED_ITEMS,
  correctScanItems,
  correctionItemSchema,
} from "../lib/scan-correct";
import type { CorrectionReason, CorrectionRun } from "../lib/scan-correct";

/** i18n key (scan namespace, correct.error.*) of each correction failure. */
const CORRECTION_ERROR_KEY = {
  unclear: "unclear",
  unknown_reference: "unknownReference",
  empty_result: "emptyResult",
  failed: "failed",
  voice_empty: "voiceEmpty",
} as const satisfies Record<CorrectionReason, string>;

/** Cutouts per photo: 12 items for the first pass plus each allowed retry. */
const MAX_STICKERS_PER_PHOTO = 12 * (1 + MAX_SCAN_RETRIES);
/** How long scanSticker waits on a cut another request is running. */
const STICKER_WAIT_MS = 15_000;

/** The distinct boxes of an analysis (at most 12: one cutout per item). */
function distinctBoxes(items: ReadonlyArray<{ box?: ItemBox }>): ItemBox[] {
  const byKey = new Map<string, ItemBox>();
  for (const item of items) {
    if (item.box) byKey.set(item.box.join("-"), item.box);
  }
  return [...byKey.values()].slice(0, 12);
}

/** The ORPC error for a failed scan: `data.reason` lets clients pick the right guidance. */
function scanFailure(error: unknown, locale: Locale) {
  const reason = error instanceof VisionError ? error.reason : "failed";
  return new ORPCError(
    reason === "failed" || reason === "timeout" ? "INTERNAL_SERVER_ERROR" : "UNPROCESSABLE_CONTENT",
    { message: scanFailMessage(reason, locale), data: { reason } },
  );
}

/**
 * A failed scan leaves a ledger row (reason, item count, finish reason, token
 * usage) so prod shows why photos fail. Scan type "failed" never counts
 * against the quota, which only counts "user" rows. Bookkeeping: never throws.
 */
function logScanFailure(
  db: Database,
  userId: string,
  error: unknown,
  startedAt: number,
  kind: "photo" | "retry",
  clientTiming?: unknown,
): Promise<void> {
  const failure = error instanceof VisionError ? error : null;
  return db
    .insert(aiUsage)
    .values({
      id: crypto.randomUUID(),
      userId,
      model: DEFAULT_VISION_MODEL,
      scanType: "failed",
      latencyMs: Date.now() - startedAt,
      usageJson: JSON.stringify({
        kind,
        reason: failure?.reason ?? "failed",
        itemCount: failure?.detail.itemCount ?? 0,
        finish: failure?.detail.finish ?? null,
        attempts: failure?.detail.attempts ?? null,
        ...failure?.detail.usage,
        ...(clientTiming ? { clientTiming } : {}),
      }),
    })
    .then(
      () => undefined,
      (insertError: unknown) => console.error("[ai] failure ledger insert failed", insertError),
    );
}

const timingMs = z.number().min(0).max(600_000);
const clientTimingSchema = z.object({
  captureMs: timingMs.optional(),
  resizeMs: timingMs.optional(),
  encodeMs: timingMs.optional(),
  payloadKb: z.number().min(0).max(100_000).optional(),
  prevRoundTripMs: timingMs.optional(),
  prevRenderMs: timingMs.optional(),
  prevCropMs: timingMs.optional(),
  // Streaming scans: previous scan's wait for the first item name / first complete item.
  prevFirstNameMs: timingMs.optional(),
  prevFirstItemMs: timingMs.optional(),
});

const analyzeFoodInput = z.object({
  // Clients send ≤1024 px images (~0.2–0.5 MB base64); 8 MB caps abuse.
  imageBase64: z.base64().min(50).max(8_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  // Clients that crop per item from the boxes (and save via
  // food.addScan) skip the legacy whole-plate sticker.
  crops: z.boolean().optional(),
  // Phase timings (ms) the client measured, stored in ai_usage.usage_json
  // so prod data shows where the felt latency goes. Prev* describe the
  // previous scan of this session, which finished after its own request.
  clientTiming: clientTimingSchema.optional(),
});
type AnalyzeFoodInput = z.infer<typeof analyzeFoodInput>;

/** What a handler behind protectedProcedure sees. */
type AuthedContext = Context & { session: NonNullable<Context["session"]> };

/** What analyzeFood answers, and what the closing `done` event of analyzeFoodStream carries. */
export type AnalyzeFoodResult = {
  items: VisionAnalysis["items"];
  tooMany: boolean;
  scanId: string | null;
  photoId: string | null;
  retriesLeft: number;
  quotaReached: boolean;
  model: string;
  askFeedback: boolean;
};

/**
 * One photo scan: quota, the model call, the ledger row, the photo kept for
 * "Hitung ulang" and the sticker cutouts. Behind both analyzeFood (plain) and
 * analyzeFoodStream, which passes `onEvent` to see items while the model is
 * still writing; the returned result is the same either way.
 */
async function runAnalyzeFood(
  context: AuthedContext,
  input: AnalyzeFoodInput,
  onEvent?: (event: VisionEvent) => void,
): Promise<AnalyzeFoodResult> {
  const userId = context.session.user.id;
  const requestStartedAt = Date.now();
  // Request start (createContext: session lookup, then the body upload as the
  // worker saw it) to here. Absent outside the worker (tests).
  const receiveMs =
    context.requestStartedAt === undefined ? undefined : requestStartedAt - context.requestStartedAt;
  const { ai, quotaReached } = await requireAiQuota(
    context.db,
    context.env,
    userId,
    context.locale,
  );
  const quotaMs = Date.now() - requestStartedAt;

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
  const images = context.env.IMAGES as ImagesBinding | undefined;
  // Legacy stiker piring (older app builds): segmentation runs
  // concurrently with inference. The response waits for it only when it
  // outlasts the model call; current clients send `crops` and never wait.
  const cutout =
    stickers && !input.crops
      ? makeSticker(
          context.env.IMAGES as ImagesBinding | undefined,
          base64ToBytes(input.imageBase64),
        )
      : Promise.resolve(null);
  // Hitung ulang support: keep the exact photo the model saw so a retry
  // sends only the id — no recapture, no reupload, no second scan of the
  // daily quota. The counter metadata `n` (retries used) is the
  // server-side cap; scan-src/ objects are short-lived via lifecycle.
  // The put runs concurrently with inference: it hides entirely behind
  // the model call instead of adding an R2 roundtrip after it.
  const photoBytes = base64ToBytes(input.imageBase64);
  // The whole photo starts segmenting now, in parallel with the vision call;
  // the boxes it returns only need cropping out of this cutout afterwards.
  const photoSize: Promise<PhotoSize> =
    stickers && images && input.crops ? readPhotoSize(images, photoBytes) : Promise.resolve({});
  const wholeCutout: Promise<WholeCutout | null> = photoSize.then((size) =>
    stickers && images && input.crops ? makeWholeCutout(images, photoBytes, size) : null,
  );
  const photoStored: Promise<string | null> = stickers
    ? (async () => {
        const id = newScanId();
        try {
          await stickers.put(scanSrcKey(userId, id), photoBytes, {
            httpMetadata: { contentType: input.mimeType },
            customMetadata: { n: "0" },
          });
          return id;
        } catch {
          return null;
        }
      })()
    : Promise.resolve(null);
  // Streaming scans: when the first name and the first finished item reached
  // the client, in ms since this handler started.
  const firstSeen: { firstNameMs?: number; firstItemMs?: number } = {};
  const report = onEvent
    ? (event: VisionEvent) => {
        if (event.type === "name") firstSeen.firstNameMs ??= Date.now() - requestStartedAt;
        if (event.type === "item") firstSeen.firstItemMs ??= Date.now() - requestStartedAt;
        onEvent(event);
      }
    : undefined;
  let analysis;
  try {
    analysis = await analyzeFoodPhoto(ai, {
      imageBase64: input.imageBase64,
      mimeType: input.mimeType,
      model: context.env.AI_VISION_MODEL || undefined,
      locale: context.locale,
      onEvent: report,
    });
  } catch (error) {
    // No result, no retry target: drop the photo stored alongside inference.
    if (stickers) {
      context.waitUntil(
        photoStored.then((id) => (id ? stickers.delete(scanSrcKey(userId, id)) : undefined)).catch(() => {}),
      );
    }
    context.waitUntil(
      logScanFailure(context.db, userId, error, startedAt, "photo", input.clientTiming),
    );
    throw scanFailure(error, context.locale);
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
  // Charge only successful analyses — quota counts these ledger rows. The
  // insert is bookkeeping the user never sees, so it runs after the
  // response instead of adding a DB roundtrip to the critical path.
  const ledgerId = crypto.randomUUID();
  // The scan session key: the photo id the clients carry through retry,
  // correction, feedback and the diary save. The R2 put ran beside the model
  // call, so this wait is normally already over.
  const storedPhotoId = await photoStored;
  const serverTiming = {
    ...(receiveMs !== undefined ? { receiveMs } : {}),
    quotaMs,
    aiMs: latencyMs,
    ...(analysis.timing.ttftMs !== undefined ? { ttftMs: analysis.timing.ttftMs } : {}),
    attempts: analysis.timing.attempts,
    ...(onEvent ? { streamed: true, ...firstSeen } : {}),
    totalMs: Date.now() - requestStartedAt,
  };
  const ledgerUsage = {
    ...analysis.usage,
    itemCount: analysis.items.length,
    ...(analysis.tooMany ? { tooMany: true } : {}),
    ...(analysis.modelTooMany ? { modelTooMany: true } : {}),
    ...(analysis.repaired ? { repaired: true } : {}),
    serverTiming,
    ...(input.clientTiming ? { clientTiming: input.clientTiming } : {}),
    // Implicit outcome labels (lib/scan-outcome.ts) build on these two.
    ...(storedPhotoId ? { photoId: storedPhotoId, aiItems: compactItems(analysis.items) } : {}),
  };
  const ledger = context.db
    .insert(aiUsage)
    .values({
      id: ledgerId,
      userId,
      model: analysis.model,
      scanType: "user",
      latencyMs,
      usageJson: JSON.stringify(ledgerUsage),
    })
    .then(
      () => true,
      (error: unknown) => {
        console.error("[ai] ledger insert failed", error);
        return false;
      },
    );
  context.waitUntil(ledger);
  // Every detected box gets its sticker right away, in waitUntil: a quick
  // crop of the whole-photo cutout that has been segmenting since the photo
  // arrived, then the refined per-box cut. The pending markers are written
  // before responding, so a scanSticker call that lands first waits on
  // them instead of cutting the same box twice. Legacy clients (no
  // `crops`) use the plate sticker.
  const boxes = stickers && images && input.crops ? distinctBoxes(analysis.items) : [];
  const stickerRun: { promise: Promise<ScanStickerTiming> | null } = { promise: null };
  const datasetOn = stickers !== undefined && datasetEnabled(context.env, userId);
  const [scanId, photoId, [[scansEverRow], [askedTodayRow]]] = await Promise.all([
    storeSticker(),
    photoStored.then(async (id) => {
      if (id && stickers && images && boxes.length > 0) {
        const photoKey = scanSrcKey(userId, id);
        try {
          await Promise.all(boxes.map((box) => markBoxPending(stickers, photoKey, box)));
          stickerRun.promise = runScanStickers({
            images,
            bucket: stickers,
            userId,
            photoKey,
            bytes: photoBytes,
            boxes,
            size: await photoSize,
            whole: wholeCutout,
            refine: context.env.STICKER_REFINE !== "0",
            startedAt: requestStartedAt,
          });
          context.waitUntil(stickerRun.promise);
        } catch {
          // no markers, no background cut: scanSticker claims each box itself
        }
      }
      return id;
    }),
    feedbackGate,
    // Owner dataset: the photo and the model's first answer, in R2 beside
    // the scan session. Runs in parallel with the cutouts; never fails the scan.
    datasetOn && stickers
      ? photoStored.then((id) =>
          recordScan(stickers, {
            userId,
            scanId: id ?? newScanId(),
            photo: photoBytes,
            mimeType: input.mimeType,
            model: analysis.model,
            locale: context.locale,
            items: analysis.items,
            tooMany: analysis.tooMany,
          }),
        )
      : undefined,
  ]);
  // Read the real numbers off prod: the ledger row gains stickerTiming
  // (ms since the request started) once the cuts settle.
  const responseMs = Date.now() - requestStartedAt;
  if (stickerRun.promise) {
    context.waitUntil(
      Promise.all([ledger, stickerRun.promise])
        .then(async ([inserted, timing]) => {
          const stickerTiming = { responseMs, ...timing };
          console.log("[sticker]", JSON.stringify(stickerTiming));
          if (!inserted) return;
          // json_set, not a rewrite: the session fields (retries, saved...) may
          // already be in this row by now.
          await context.db
            .update(aiUsage)
            .set({
              usageJson: sql`json_set(coalesce(${aiUsage.usageJson}, '{}'), '$.serverTiming', json(${JSON.stringify({ ...serverTiming, responseMs })}), '$.stickerTiming', json(${JSON.stringify(stickerTiming)}))`,
            })
            .where(eq(aiUsage.id, ledgerId));
        })
        .catch((error: unknown) => console.error("[ai] sticker timing failed", error)),
    );
  }
  return {
    items: analysis.items,
    tooMany: analysis.tooMany,
    scanId,
    photoId,
    retriesLeft: photoId ? MAX_SCAN_RETRIES : 0,
    quotaReached,
    model: analysis.model,
    askFeedback: (scansEverRow?.n ?? 0) < 3 || (askedTodayRow?.n ?? 0) === 0,
  };
}

export const aiRouter = {
  analyzeFood: protectedProcedure
    .input(analyzeFoodInput)
    .handler(({ context, input }) => runAnalyzeFood(context, input)),
  // The same scan as a stream of events: each item's name as soon as the model
  // has written it, the item with its numbers and calibration once complete,
  // then `done` carrying exactly what analyzeFood returns. The live items are
  // provisional (dedupe, the broth rule and the item cap only exist in the
  // final result), so clients show them while waiting and then swap in
  // `done`. An error ends the stream like analyzeFood's throws. analyzeFood
  // stays for builds that cannot read an event stream.
  analyzeFoodStream: protectedProcedure
    .input(analyzeFoodInput)
    .handler(async function* ({ context, input }) {
      const channel = new EventChannel<ScanStreamEvent<AnalyzeFoodResult>>();
      const run = runAnalyzeFood(context, input, (event) => channel.push(event));
      // Not kept alive with waitUntil: a client that drops the stream (Batalkan)
      // cancels the request like it does for analyzeFood, so no ledger row is
      // written and no scan is billed for an answer nobody sees.
      run.then(
        (result) => {
          channel.push({ type: "done", result });
          channel.close();
        },
        (error: unknown) => channel.fail(error),
      );
      yield* channel;
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
      const requestStartedAt = Date.now();
      const t = serverT(context.locale, "errors");
      const ai = context.env.AI;
      if (!ai) {
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: t("ai.unavailable") });
      }
      const bucket = context.env.STICKERS;
      if (!bucket) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("ai.storageUnavailable") });
      }
      // The key embeds the owner: another user's id 404s by construction.
      const key = scanSrcKey(userId, input.photoId);
      const photo = await bucket.get(key).catch(() => null);
      if (!photo) {
        throw new ORPCError("NOT_FOUND", {
          message: t("ai.photoNotFound"),
        });
      }
      const used = Number.parseInt(photo.customMetadata?.n ?? "0", 10) || 0;
      if (used >= MAX_SCAN_RETRIES) {
        throw new ORPCError("FORBIDDEN", {
          message: t("ai.retriesExhausted", { count: MAX_SCAN_RETRIES }),
          data: { retriesExhausted: true },
        });
      }
      const bytes = await photo.arrayBuffer();
      const mimeType = photo.httpMetadata?.contentType;
      const startedAt = Date.now();
      // R2 read of the kept photo (before the model can start).
      const loadMs = startedAt - requestStartedAt;
      let analysis;
      try {
        analysis = await analyzeFoodPhoto(ai, {
          imageBase64: bytesToBase64(bytes),
          mimeType:
            mimeType === "image/png" || mimeType === "image/webp" ? mimeType : "image/jpeg",
          model: context.env.AI_VISION_MODEL || undefined,
          retry: { hint: input.hint },
          locale: context.locale,
        });
      } catch (error) {
        context.waitUntil(logScanFailure(context.db, userId, error, startedAt, "retry"));
        throw scanFailure(error, context.locale);
      }
      const aiMs = Date.now() - startedAt;
      // Both writes come after inference: a failed or abandoned attempt
      // never consumes the cap, and ledger rows marked "retry" stay outside
      // the daily quota count (scansUsedToday only counts "user").
      // Boxes this pass found that no earlier pass of the photo has cut yet
      // (a changed box = a new marker) start their cutouts now, in waitUntil.
      const images = context.env.IMAGES as ImagesBinding | undefined;
      const claimedBoxes: ItemBox[] = [];
      const claimBoxes = async () => {
        if (!images) return;
        for (const box of distinctBoxes(analysis.items)) {
          try {
            const claim = await claimBoxSticker(bucket, key, box, MAX_STICKERS_PER_PHOTO);
            if (claim.kind === "claimed") claimedBoxes.push(box);
          } catch {
            // scanSticker claims it later
          }
        }
      };
      await Promise.all([
        bucket.put(key, bytes, {
          httpMetadata: photo.httpMetadata,
          customMetadata: { n: String(used + 1) },
        }),
        claimBoxes(),
        context.db.insert(aiUsage).values({
          id: crypto.randomUUID(),
          userId,
          model: analysis.model,
          scanType: "retry",
          latencyMs: Date.now() - startedAt,
          usageJson: JSON.stringify({
            kind: "retry",
            ...(input.hint ? { hint: input.hint } : {}),
            itemCount: analysis.items.length,
            ...(analysis.tooMany ? { tooMany: true } : {}),
            ...(analysis.modelTooMany ? { modelTooMany: true } : {}),
            ...(analysis.repaired ? { repaired: true } : {}),
            ...analysis.usage,
            serverTiming: {
              loadMs,
              aiMs,
              attempts: analysis.timing.attempts,
              totalMs: Date.now() - requestStartedAt,
            },
          }),
        }),
      ]);
      // Implicit outcome: this scan session was retried. Old clients also sent
      // an implicit kurang_akurat with the tap: mark it so it is not an explicit rating.
      context.waitUntil(
        Promise.all([
          recordSessionRetry(context.db, userId, input.photoId, {
            model: analysis.model,
            hint: input.hint,
            items: analysis.items,
          }),
          markRetryTapFeedback(context.db, userId, input.photoId),
        ]).catch((error: unknown) => console.error("[ai] retry outcome failed", error)),
      );
      if (datasetEnabled(context.env, userId)) {
        context.waitUntil(
          recordRetry(bucket, userId, input.photoId, {
            model: analysis.model,
            hint: input.hint,
            items: analysis.items,
          }),
        );
      }
      if (images && claimedBoxes.length > 0) {
        context.waitUntil(
          Promise.all(
            claimedBoxes.map((box) => cutBoxSticker(images, bucket, userId, key, bytes, box)),
          ),
        );
      }
      return {
        items: analysis.items,
        tooMany: analysis.tooMany,
        retriesLeft: MAX_SCAN_RETRIES - (used + 1),
        model: analysis.model,
      };
    }),
  // Real background-removed cutout of one detected item, for the result screen.
  // analyzeFood (and the retry) already start every box's cut in waitUntil, so
  // this usually just returns the finished sticker id from the box's marker, or
  // briefly waits for the cut in flight. Only a box nobody started (older
  // server pass, failed marker write, a stale claim) is cut here. Reads the
  // photo kept for "Hitung ulang", so it costs no scan quota and no pixels
  // travel again. The cutout lands under the scan-src/ lifecycle prefix;
  // food.addScan promotes it on save. Never throws: null just means "keep the
  // rectangular crop".
  //
  // Each cut is a paid Images call, bounded per photo by the marker ledger:
  // one marker per box (repeats answer from it) and at most
  // MAX_STICKERS_PER_PHOTO markers (12 items x the first pass plus retries).
  scanSticker: protectedProcedure
    .input(
      z.object({
        photoId: z.string().regex(SCAN_ID_RE),
        box: z.array(z.number()).length(4),
        // Second call for a sticker that came back as a quick crop: waits for
        // the refined per-box cutout (or gives the quick one back on timeout).
        refine: z.boolean().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const bucket = context.env.STICKERS as StickersBucket | undefined;
      const images = context.env.IMAGES as ImagesBinding | undefined;
      const box = normalizeBox(input.box);
      if (!bucket || !images || !box) return { scanId: null, final: true };
      const userId = context.session.user.id;
      try {
        // The key embeds the owner: another user's photo id resolves to nothing.
        const photoKey = scanSrcKey(userId, input.photoId);
        const claim = await claimBoxSticker(bucket, photoKey, box, MAX_STICKERS_PER_PHOTO);
        if (claim.kind === "capped") return { scanId: null, final: true };
        if (claim.kind === "existing") {
          if (claim.final) return { scanId: claim.scanId, final: true };
          // Nothing yet (pending) or only the quick crop: wait for what was asked.
          if (claim.pending || input.refine) {
            return await waitBoxSticker(
              bucket,
              photoKey,
              box,
              STICKER_WAIT_MS,
              input.refine ? "final" : "any",
            );
          }
          return { scanId: claim.scanId, final: false };
        }
        const photo = await bucket.get(photoKey);
        const bytes = photo ? await photo.arrayBuffer() : null;
        return {
          scanId: await cutBoxSticker(images, bucket, userId, photoKey, bytes, box),
          final: true,
        };
      } catch {
        return { scanId: null, final: true };
      }
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
        // Opt-in ("Boleh simpan foto ini untuk bantu memperbaiki AI"): honored
        // only with a negative rating; keeps the photo + meta under feedback/.
        keepPhoto: z.boolean().optional(),
        model: z.string().max(100).optional(),
        source: z.enum(["web", "native"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const bucket = context.env.STICKERS as StickersBucket | undefined;
      if (bucket && datasetEnabled(context.env, userId)) {
        context.waitUntil(
          recordFeedback(bucket, userId, input.photoId, {
            rating: input.rating,
            reasons: input.reasons,
            note: input.note,
          }),
        );
      }
      const negative = input.rating === "kurang_akurat" || input.rating === "salah";
      const keepPhoto = negative && input.keepPhoto === true;
      const afterRetry = input.afterRetry ?? false;
      // The session behind the rating: what the AI said, and (old clients) a
      // retry that already ran. Only read when something needs it.
      const session =
        keepPhoto || (input.rating === "kurang_akurat" && !afterRetry)
          ? await loadSession(context.db, userId, input.photoId)
          : null;
      // Old clients rate kurang_akurat (nothing else) on the "Hitung ulang"
      // tap; the retry was recorded first, so this row is that tap.
      const retryTap =
        input.rating === "kurang_akurat" &&
        !afterRetry &&
        !input.reasons?.length &&
        !input.note &&
        !keepPhoto &&
        retryJustRan(session?.session);
      const marks = [
        ...(retryTap ? [FEEDBACK_MARK.retryTap] : []),
        ...(keepPhoto ? [FEEDBACK_MARK.keepPhoto] : []),
      ];
      await context.db.insert(scanFeedback).values({
        id: crypto.randomUUID(),
        userId,
        photoId: input.photoId,
        rating: input.rating,
        reasonsJson: buildFeedbackReasons(input.reasons ?? [], marks),
        note: input.note,
        afterRetry,
        model: input.model,
        source: input.source,
      });
      if (keepPhoto && bucket) {
        const ai = session?.session;
        context.waitUntil(
          (async () => {
            await keepFeedbackPhoto(bucket, {
              version: 1,
              photoId: input.photoId,
              userId,
              createdAt: new Date().toISOString(),
              source: input.source,
              ...(input.model ? { model: input.model } : {}),
              rating: input.rating as "kurang_akurat" | "salah",
              reasons: input.reasons ?? [],
              ...(input.note ? { note: input.note } : {}),
              afterRetry,
              aiItems: ai?.aiItems ?? [],
              ...(ai?.retryItems ? { retryItems: ai.retryItems } : {}),
              ...(ai?.savedItems ? { savedItems: ai.savedItems, savedAt: ai.savedAt } : {}),
            });
            // The save may follow later: addScan sees `keep` and completes the meta.
            await markSessionKeep(context.db, userId, input.photoId);
          })().catch((error: unknown) => console.error("[ai] keep photo failed", error)),
        );
      }
      return { ok: true };
    }),
  // "Koreksi": the user types or says what the scan got wrong ("itu rolade
  // bukan perkedel", "nasinya setengah aja") and gets the patched list back.
  // Text-only model call (the photo never travels), so it answers in ~1 s.
  // Never spends the daily scan quota; the ledger-backed caps in
  // correct-limit.ts (per scan session and per day) are its only limit.
  // Nothing is saved: the client applies the patch and keeps undo.
  correctScan: protectedProcedure
    .input(
      z.object({
        photoId: z.string().regex(SCAN_ID_RE).optional(),
        items: z.array(correctionItemSchema).min(1).max(MAX_CORRECTED_ITEMS),
        text: z.string().trim().min(2).max(300).optional(),
        // Same ≤60 s voice notes as describeFood.
        audioBase64: z.base64().min(100).max(3_000_000).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const t = serverT(context.locale, "scan");
      if ((input.text === undefined) === (input.audioBase64 === undefined)) {
        throw new ORPCError("BAD_REQUEST", { message: t("correct.error.inputRequired") });
      }
      const ai = context.env.AI;
      if (!ai) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: serverT(context.locale, "errors")("ai.unavailable"),
        });
      }
      const used = await correctionsUsed(context.db, userId, input.photoId);
      assertCorrectionAllowed(used, context.locale);

      const startedAt = Date.now();
      const via = input.audioBase64 !== undefined ? "voice" : "text";
      let transcript: string | null = null;
      let transcribeUsage: Record<string, unknown> | null = null;
      let run: CorrectionRun | null = null;
      let failure: CorrectionError | null = null;
      try {
        if (input.audioBase64 !== undefined) {
          const heard = await transcribeStory(ai, input.audioBase64, context.locale);
          transcript = heard.text;
          transcribeUsage = heard.usage;
        }
        run = await correctScanItems(ai, {
          items: input.items,
          text: (transcript ?? input.text ?? "").slice(0, 300),
          model: context.env.AI_CORRECT_MODEL || undefined,
          locale: context.locale,
        });
      } catch (error) {
        failure =
          error instanceof CorrectionError
            ? error
            : new CorrectionError(transcript === null && via === "voice" ? "voice_empty" : "failed");
        if (!(error instanceof CorrectionError)) console.error("[correct] failed", error);
      }
      const latencyMs = Date.now() - startedAt;
      // Every call that reached the AI counts toward the caps, answer or not.
      context.waitUntil(
        context.db
          .insert(aiUsage)
          .values({
            id: crypto.randomUUID(),
            userId,
            model: run?.model ?? context.env.AI_CORRECT_MODEL ?? DEFAULT_CORRECT_MODEL,
            scanType: "correction",
            latencyMs,
            usageJson: JSON.stringify({
              kind: "correction",
              via,
              ...(input.photoId ? { photoId: input.photoId } : {}),
              outcome: failure ? failure.reason : "ok",
              itemCount: input.items.length,
              ...(run ? { usage: run.usage } : {}),
              ...(via === "voice" ? { transcribe: { model: TRANSCRIBE_MODEL, ...transcribeUsage } } : {}),
            }),
          })
          .then(
            () => undefined,
            (error: unknown) => console.error("[correct] ledger insert failed", error),
          ),
      );
      if (!run) {
        const reason = failure?.reason ?? "failed";
        throw new ORPCError("UNPROCESSABLE_CONTENT", {
          message: t(`correct.error.${CORRECTION_ERROR_KEY[reason]}`),
          data: { reason, transcript },
        });
      }
      if (input.photoId) {
        context.waitUntil(
          recordSessionCorrection(context.db, userId, input.photoId).catch((error: unknown) =>
            console.error("[ai] correction outcome failed", error),
          ),
        );
      }
      const bucket = context.env.STICKERS as StickersBucket | undefined;
      if (input.photoId && bucket && datasetEnabled(context.env, userId)) {
        context.waitUntil(
          recordCorrection(bucket, userId, input.photoId, {
            via,
            text: (transcript ?? input.text ?? "").slice(0, 300),
            ...(transcript ? { transcript } : {}),
            model: run.model,
            latencyMs,
            before: input.items,
            after: run.patch.items,
            changes: run.patch.changes,
            removed: run.patch.removed,
          }),
        );
      }
      return {
        ...run.patch,
        transcript,
        correctionsLeft: input.photoId ? correctionsLeft(used) : null,
      };
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
        }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if ((input.text === undefined) === (input.audioBase64 === undefined)) {
        throw new ORPCError("BAD_REQUEST", {
          message: serverT(context.locale, "scan")("errors.storyInputRequired"),
        });
      }
      const { ai, quotaReached } = await requireAiQuota(
        context.db,
        context.env,
        userId,
        context.locale,
      );
      const startedAt = Date.now();
      let transcript = input.text ?? "";
      let transcribeUsage: Record<string, unknown> | null = null;
      let analysis;
      try {
        if (input.audioBase64 !== undefined) {
          const heard = await transcribeStory(ai, input.audioBase64, context.locale);
          transcript = heard.text;
          transcribeUsage = heard.usage;
        }
        analysis = await parseFoodStory(ai, {
          text: transcript,
          slots: [...new Set(input.slots)],
          defaultMeal: input.meal,
          referenceDate: input.date,
          model: context.env.AI_VISION_MODEL || undefined,
          locale: context.locale,
        });
      } catch (error) {
        // The transcript still helps the user fix what the AI misheard.
        throw new ORPCError("UNPROCESSABLE_CONTENT", {
          message: error instanceof Error ? error.message : serverT(context.locale, "errors")("story.empty"),
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
