// Threads mention bot pipeline (docs/threads-bot.md): a mention arrives (webhook or cron poll), is filtered BEFORE any
// model call, scanned in memory with the app's own photo pipeline, and answered with a kcal-range reply: queued for an
// admin (review) or posted at once (auto). Nothing about the photo is stored.

import { eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import { threadsAccount } from "@joyorogo/db/schema/threads";

import { bytesToBase64 } from "../sticker";
import { VisionError } from "../vision";
import type { VisionAnalysis } from "../vision";
import type { BotConfig } from "./config";
import { fetchImage, getMedia, listMentions, publishReply } from "./graph";
import type { ThreadsMedia } from "./graph";
import { UNCLEAR_REPLY, formatEstimate, isLowConfidence } from "./reply";
import {
  STALE_MS,
  dishesJson,
  expireReceived,
  getMention,
  insertReceived,
  markSkipped,
  photoAlreadyHandled,
  reserveSlot,
  retryLater,
  staleReceived,
  transition,
} from "./store";
import { ensureAccount } from "./token";
import type { BotAccount } from "./token";

export type ScanImage = { imageBase64: string; mimeType: string };

export type BotDeps = {
  db: Database;
  config: BotConfig;
  /** The app's photo scan on one image (analyzeFoodPhoto, with the production model and the food gate). */
  scan: (image: ScanImage) => Promise<VisionAnalysis>;
  /** Clock in ms; tests pin it. Default Date.now. */
  now?: () => number;
  /** Wait before the one retry of threads_publish (default 4 s); tests shorten it. */
  publishRetryMs?: number;
};

export type MentionOutcome =
  | { status: "off" }
  | { status: "no_token" }
  | { status: "duplicate" }
  | { status: "queued" }
  | { status: "skipped"; reason: string }
  | { status: "pending_review"; kind: "estimate" | "unclear" }
  | { status: "sent"; replyId: string }
  | { status: "failed"; error: string }
  | { status: "retry"; error: string };

/** Mentions the cron tick answers directly from the poll; the rest wait as `received` for the sweep. */
const TICK_BUDGET = 8;
const POLL_FIRST_LOOKBACK_S = 3600;

/** Threads timestamps look like 2024-08-07T10:33:16+0000, which not every runtime parses. */
export function parseThreadsTime(raw: string | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(ms) ? null : ms;
}

type Photo = { url: string; sourceId: string };

/** The first image of a post: the image itself, or the first IMAGE child of a carousel (at most 5 child reads). */
async function imageOf(token: string, media: ThreadsMedia): Promise<Photo | null> {
  if (media.media_type === "IMAGE" && media.media_url)
    return { url: media.media_url, sourceId: media.id };
  if (media.media_type !== "CAROUSEL_ALBUM") return null;
  for (const child of (media.children?.data ?? []).slice(0, 5)) {
    const full =
      child.media_type && child.media_url
        ? child
        : await getMedia(token, child.id, "id,media_type,media_url");
    if (full.media_type === "IMAGE" && full.media_url)
      return { url: full.media_url, sourceId: media.id };
  }
  return null;
}

/** A webhook value may leave out fields (media_url, children, reply links): read the post whole when what we need is missing. */
async function hydrate(token: string, post: ThreadsMedia): Promise<ThreadsMedia> {
  const complete =
    post.media_type !== undefined &&
    (post.media_type !== "IMAGE" || post.media_url !== undefined) &&
    (post.media_type !== "CAROUSEL_ALBUM" || post.children !== undefined) &&
    (post.is_reply !== true || post.replied_to !== undefined);
  return complete ? post : { ...post, ...(await getMedia(token, post.id)) };
}

async function ownsThread(
  token: string,
  account: BotAccount,
  post: ThreadsMedia,
): Promise<boolean> {
  const root = post.root_post;
  if (!root) return false;
  if (root.owner_id === account.userId || root.username?.toLowerCase() === account.username)
    return true;
  if (root.owner_id || root.username) return false;
  return (
    (await getMedia(token, root.id, "id,username")).username?.toLowerCase() === account.username
  );
}

type Found = { kind: "found"; photo: Photo } | { kind: "none" } | { kind: "own_thread" };

/** The mention's own image, else the image of the post it replies to; and whether it sits inside our own reply chain. */
async function findPhoto(account: BotAccount, post: ThreadsMedia): Promise<Found> {
  if (await ownsThread(account.token, account, post)) return { kind: "own_thread" };
  const parent = post.replied_to ? await getMedia(account.token, post.replied_to.id) : null;
  if (parent?.username?.toLowerCase() === account.username) return { kind: "own_thread" };
  const photo =
    (await imageOf(account.token, post)) ?? (parent ? await imageOf(account.token, parent) : null);
  return photo ? { kind: "found", photo } : { kind: "none" };
}

async function logUsage(
  db: Database,
  model: string,
  latencyMs: number,
  usage: unknown,
): Promise<void> {
  await db
    .insert(aiUsage)
    .values({
      id: crypto.randomUUID(),
      userId: null,
      model,
      scanType: "threads",
      latencyMs,
      usageJson: JSON.stringify(usage),
    })
    .catch((error: unknown) => console.error("[threads-bot] usage log failed", error));
}

/** Posts a claimed draft and settles the row. A failed post goes back to the queue with the error, never lost. */
async function publishClaimed(
  deps: BotDeps,
  account: BotAccount,
  mediaId: string,
  text: string,
  reviewedBy?: string,
): Promise<MentionOutcome> {
  const now = (deps.now ?? Date.now)();
  try {
    const replyId = await publishReply(
      account.token,
      account.userId,
      mediaId,
      text,
      deps.publishRetryMs,
    );
    await transition(
      deps.db,
      mediaId,
      ["publishing"],
      {
        status: "sent",
        replyMediaId: replyId,
        sentAt: new Date(now),
        error: null,
        ...(reviewedBy ? { reviewedBy, reviewedAt: new Date(now) } : {}),
      },
      now,
    );
    return { status: "sent", replyId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await transition(
      deps.db,
      mediaId,
      ["publishing"],
      { status: "pending_review", error: message.slice(0, 300) },
      now,
    );
    return { status: "failed", error: message };
  }
}

/**
 * Admin approve: posts the queued draft (or `text`, an edited one). Compare-and-set on `pending_review` makes a double
 * click or two admins post once. Refused while the kill switch is off.
 */
export async function approveDraft(
  deps: BotDeps,
  mediaId: string,
  reviewer: string,
  text?: string,
): Promise<MentionOutcome | "not_pending" | "off" | "no_token"> {
  if (deps.config.mode === "off") return "off";
  const now = (deps.now ?? Date.now)();
  const account = await ensureAccount(deps.db, deps.config.seedToken, now);
  if (!account) return "no_token";
  const row = await getMention(deps.db, mediaId);
  const finalText = text ?? row?.replyText;
  if (!row || row.status !== "pending_review" || !finalText) return "not_pending";
  const claimed = await transition(
    deps.db,
    mediaId,
    ["pending_review"],
    { status: "publishing", replyText: finalText },
    now,
  );
  if (!claimed) return "not_pending";
  return publishClaimed(deps, account, mediaId, finalText, reviewer);
}

export async function rejectDraft(
  db: Database,
  mediaId: string,
  reviewer: string,
  now: number,
): Promise<boolean> {
  return transition(
    db,
    mediaId,
    ["pending_review"],
    { status: "rejected", reviewedBy: reviewer, reviewedAt: new Date(now) },
    now,
  );
}

/** Saves an edited draft without posting it. */
export async function editDraft(
  db: Database,
  mediaId: string,
  text: string,
  now: number,
): Promise<boolean> {
  return transition(db, mediaId, ["pending_review"], { replyText: text }, now);
}

/**
 * One mention, start to finish. Idempotent by media id: a second delivery of the same mention (webhook retry, the poll
 * seeing it too) returns `duplicate` and does nothing. Order matters: every cheap filter runs before the model, and the
 * caps are reserved atomically before it.
 */
export async function processMention(
  deps: BotDeps,
  incoming: ThreadsMedia,
  opts: { retry?: boolean } = {},
): Promise<MentionOutcome> {
  const { db, config } = deps;
  if (config.mode === "off") return { status: "off" };
  const now = (deps.now ?? Date.now)();
  const mediaId = incoming.id;
  const author = (incoming.username ?? "").toLowerCase();

  if (!opts.retry && !(await insertReceived(db, mediaId, author, now)))
    return { status: "duplicate" };

  const postedAt = parseThreadsTime(incoming.timestamp);
  if (postedAt !== null && now - postedAt > STALE_MS) {
    await markSkipped(db, mediaId, "stale", now);
    return { status: "skipped", reason: "stale" };
  }

  const account = await ensureAccount(db, config.seedToken, now);
  if (!account) return { status: "no_token" };

  const skip = async (reason: string): Promise<MentionOutcome> => {
    await markSkipped(db, mediaId, reason, now);
    return { status: "skipped", reason };
  };

  let post: ThreadsMedia;
  let found: Found;
  try {
    post = await hydrate(account.token, incoming);
    if (!post.username) return await skip("no_author");
    if (post.username.toLowerCase() === account.username) return await skip("own_post");
    found = await findPhoto(account, post);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await retryLater(db, mediaId, message, now);
    return { status: "retry", error: message };
  }
  if (found.kind === "own_thread") return skip("own_thread");
  if (found.kind === "none") return skip("no_image");
  const { photo } = found;

  if (await photoAlreadyHandled(db, photo.sourceId, mediaId)) return skip("duplicate_photo");

  const who = post.username!.toLowerCase();
  if (who !== author) await transition(db, mediaId, ["received"], { authorUsername: who }, now);
  const slot = await reserveSlot(
    db,
    mediaId,
    who,
    photo.sourceId,
    { user: config.userCap, global: config.globalCap },
    now,
  );
  if (slot === "gone") return { status: "duplicate" };
  if (slot !== "reserved") return skip(slot);

  let image: { bytes: ArrayBuffer; mimeType: string };
  try {
    image = await fetchImage(photo.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await retryLater(db, mediaId, message, now);
    return { status: "retry", error: message };
  }

  const startedAt = Date.now();
  let analysis: VisionAnalysis;
  try {
    analysis = await deps.scan({
      imageBase64: bytesToBase64(image.bytes),
      mimeType: image.mimeType,
    });
  } catch (error) {
    const reason = error instanceof VisionError ? error.reason : "failed";
    await logUsage(db, "threads", Date.now() - startedAt, { outcome: reason });
    if (reason === "not_food") return skip("not_food");
    if (reason === "unclear" || reason === "too_many")
      return draft(deps, account, mediaId, { kind: "unclear", text: UNCLEAR_REPLY });
    await transition(
      db,
      mediaId,
      ["scanning"],
      { status: "failed", error: `scan: ${reason}` },
      now,
    );
    return { status: "failed", error: `scan: ${reason}` };
  }
  await logUsage(db, analysis.model, Date.now() - startedAt, {
    ...analysis.usage,
    outcome: "ok",
    itemCount: analysis.items.length,
  });

  if (isLowConfidence(analysis.items))
    return draft(deps, account, mediaId, { kind: "unclear", text: UNCLEAR_REPLY });
  const estimate = formatEstimate(analysis.items, config.band);
  return draft(deps, account, mediaId, {
    kind: "estimate",
    text: estimate.text,
    dishes: dishesJson(estimate.dishes),
    kcalLow: estimate.low,
    kcalHigh: estimate.high,
  });
}

type Draft = {
  kind: "estimate" | "unclear";
  text: string;
  dishes?: string;
  kcalLow?: number;
  kcalHigh?: number;
};

/** Stores the reply: queued in review mode, posted straight away in auto mode (and queued if that post fails). */
async function draft(
  deps: BotDeps,
  account: BotAccount,
  mediaId: string,
  reply: Draft,
): Promise<MentionOutcome> {
  const now = (deps.now ?? Date.now)();
  const fields = {
    kind: reply.kind,
    replyText: reply.text,
    dishesJson: reply.dishes ?? null,
    kcalLow: reply.kcalLow ?? null,
    kcalHigh: reply.kcalHigh ?? null,
    mode: deps.config.mode === "auto" ? ("auto" as const) : ("review" as const),
  };
  if (deps.config.mode !== "auto") {
    await transition(deps.db, mediaId, ["scanning"], { ...fields, status: "pending_review" }, now);
    return { status: "pending_review", kind: reply.kind };
  }
  await transition(deps.db, mediaId, ["scanning"], { ...fields, status: "publishing" }, now);
  return publishClaimed(deps, account, mediaId, reply.text);
}

/**
 * Cron: reads the mentions edge since the saved cursor and handles what is new. The first poll looks back one hour;
 * later ones start at the newest mention seen. Idempotent, so the overlap is harmless. At most TICK_BUDGET mentions are
 * answered per tick; the rest are recorded as `received` and the sweep picks them up.
 */
export async function pollMentions(deps: BotDeps): Promise<{ polled: number; handled: number }> {
  const { db, config } = deps;
  if (config.mode === "off") return { polled: 0, handled: 0 };
  const now = (deps.now ?? Date.now)();
  const account = await ensureAccount(db, config.seedToken, now);
  if (!account) return { polled: 0, handled: 0 };

  const [row] = await db
    .select({ since: threadsAccount.mentionsSince })
    .from(threadsAccount)
    .where(eq(threadsAccount.id, 1))
    .limit(1);
  const floor = Math.floor((now - STALE_MS) / 1000);
  const since = Math.max(row?.since ?? Math.floor(now / 1000) - POLL_FIRST_LOOKBACK_S, floor);

  let posts: ThreadsMedia[];
  try {
    posts = await listMentions(account.token, account.userId, since);
  } catch (error) {
    await db
      .update(threadsAccount)
      .set({
        lastError: `poll: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
        lastPolledAt: new Date(now),
      })
      .where(eq(threadsAccount.id, 1));
    return { polled: 0, handled: 0 };
  }

  posts.sort((a, b) => (parseThreadsTime(a.timestamp) ?? 0) - (parseThreadsTime(b.timestamp) ?? 0));
  let handled = 0;
  for (const post of posts) {
    try {
      if (handled < TICK_BUDGET) {
        const outcome = await processMention(deps, post);
        if (outcome.status !== "duplicate") handled += 1;
      } else {
        await insertReceived(db, post.id, post.username ?? "", now);
      }
    } catch (error) {
      console.error("[threads-bot] mention failed", post.id, error);
    }
  }

  const newest = posts.reduce(
    (max, post) => Math.max(max, Math.floor((parseThreadsTime(post.timestamp) ?? 0) / 1000)),
    0,
  );
  await db
    .update(threadsAccount)
    .set({
      lastPolledAt: new Date(now),
      lastError: null,
      ...(newest > 0 ? { mentionsSince: Math.max(newest, since) } : {}),
    })
    .where(eq(threadsAccount.id, 1));
  return { polled: posts.length, handled };
}

/** Cron: finishes mentions left `received` (a Graph call failed, the poll's per-tick budget ran out, the token was missing). */
export async function sweepReceived(deps: BotDeps, limit = TICK_BUDGET): Promise<number> {
  const { db, config } = deps;
  if (config.mode === "off") return 0;
  const now = (deps.now ?? Date.now)();
  await expireReceived(db, now);
  const account = await ensureAccount(db, config.seedToken, now);
  if (!account) return 0;
  let done = 0;
  for (const row of await staleReceived(db, now, limit)) {
    try {
      const post = await getMedia(account.token, row.mediaId);
      await processMention(deps, post, { retry: true });
      done += 1;
    } catch (error) {
      await retryLater(
        db,
        row.mediaId,
        error instanceof Error ? error.message : String(error),
        now,
      );
    }
  }
  return done;
}

/** For the admin page: the photo and permalink of a queued mention, read live from Threads (never stored). */
export async function liveSource(
  token: string,
  sourceMediaId: string,
): Promise<{ photoUrl: string | null; permalink: string | null }> {
  try {
    const media = await getMedia(token, sourceMediaId);
    return {
      photoUrl: (await imageOf(token, media))?.url ?? null,
      permalink: media.permalink ?? null,
    };
  } catch {
    return { photoUrl: null, permalink: null };
  }
}
