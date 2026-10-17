import type { SendEmail } from "@cloudflare/workers-types";
import { and, eq } from "drizzle-orm";

import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { emailLog } from "@joyorogo/db/schema/billing";

import { BROADCAST_SENDER } from "./broadcast-campaign";
import { renderBroadcast } from "./broadcast-render";
import type { Campaign, RenderedMail } from "./broadcast-render";
import { claimEmail } from "./email";
import { listOptedOut, signUnsubscribeToken } from "./unsubscribe";

/**
 * One-time announcement mail to every user.
 *
 * - Recipients: users with a verified email, minus opt-outs (R2 `email-optout/`).
 *   There is no banned/deleted flag on `user`: a deleted account has no row.
 * - Once per user and campaign: the email_log row (kind `broadcast:<id>`,
 *   ref = user id, UNIQUE(kind, ref)) is claimed BEFORE the send, like every
 *   other mail here, and released when the send fails.
 * - Batched: each call handles at most `limit` users, a few at a time, and stops
 *   at the first sign of rate limiting. Progress lives in email_log, so re-clicking
 *   "Kirim" in the admin console or the five-minute cron (R2 state `email-broadcast/<id>.json`,
 *   status "sending") simply continues with whoever is left.
 */

export const CAMPAIGN_ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** Users per call (admin click or cron tick). */
export const BATCH_LIMIT = 40;
const CONCURRENCY = 4;
/** A user whose send failed this many times (other than by rate limit) is left out. */
const MAX_ATTEMPTS = 3;
const MAX_CONSECUTIVE_FAILURES = 3;
const RATE_LIMIT_RE = /rate|limit|throttl|429|too many|quota/i;

const STATE_PREFIX = "email-broadcast/";
const stateKey = (campaignId: string) => `${STATE_PREFIX}${campaignId}.json`;

export type BroadcastDeps = {
  db: Database;
  bucket: StickersBucket;
  /** The `send_email` binding; missing = email off. */
  email: SendEmail | undefined;
  /** BETTER_AUTH_SECRET: signs the unsubscribe tokens. */
  secret: string;
  /** API origin serving /unsubscribe, e.g. https://api.joyorogo.com. */
  baseUrl: string;
  sender?: typeof BROADCAST_SENDER;
};

type Recipient = { id: string; name: string; email: string };

type BroadcastState = Campaign & {
  status: "sending" | "done";
  startedAt: number;
  finishedAt?: number;
  /** Users whose sends failed, with the last error; `attempts` counts non-rate-limit failures. */
  failures: Record<string, { attempts: number; error: string }>;
};

export type BroadcastStatus = {
  id: string;
  state: "idle" | "sending" | "done";
  /** Users with a verified email. */
  eligible: number;
  /** Eligible users who opted out. */
  optedOut: number;
  /** Eligible users already mailed (email_log). */
  sent: number;
  /** Users given up on after repeated send failures. */
  failed: number;
  /** Users still to be mailed. */
  remaining: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** The text a started campaign sends (frozen at the first click); null before. */
  campaign: Campaign | null;
};

export type BatchResult = {
  sent: number;
  failed: number;
  /** Why the batch stopped before its limit (rate limiting or repeated failures). */
  stopped: string | null;
};

type MailResult = { ok: true } | { ok: false; error: string };

const unsubscribeUrl = async (deps: BroadcastDeps, userId: string) =>
  `${deps.baseUrl.replace(/\/$/, "")}/unsubscribe?t=${await signUnsubscribeToken(deps.secret, userId)}`;

/** The mail one recipient gets, with their own signed unsubscribe link. */
export async function renderFor(deps: BroadcastDeps, campaign: Campaign, to: Pick<Recipient, "id" | "name">) {
  const url = await unsubscribeUrl(deps, to.id);
  return { mail: renderBroadcast({ campaign, name: to.name, unsubscribeUrl: url }), unsubscribeUrl: url };
}

/** Sends one mail; never throws. */
async function deliver(deps: BroadcastDeps, mail: RenderedMail, to: string, unsubscribe: string): Promise<MailResult> {
  if (!deps.email) return { ok: false, error: "email off (no EMAIL binding)" };
  const sender = deps.sender ?? BROADCAST_SENDER;
  try {
    await deps.email.send({
      to,
      from: { email: sender.email, name: sender.name },
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: {
        "List-Unsubscribe": `<${unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    return { ok: true };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`broadcast email failed (${code}):`, message);
    return { ok: false, error: `failed (${code}): ${message}` };
  }
}

/**
 * Admin test: one real mail to one existing user (so the unsubscribe link in it
 * works), recorded in email_log as `broadcast_test:<id>` after it went out. Test
 * rows do not count as the campaign mail, so the same user still gets the real one.
 */
export async function sendBroadcastTest(
  deps: BroadcastDeps,
  campaign: Campaign,
  to: Recipient,
): Promise<MailResult & { logged: boolean }> {
  const { mail, unsubscribeUrl: url } = await renderFor(deps, campaign, to);
  const result = await deliver(deps, mail, to.email, url);
  if (!result.ok) return { ...result, logged: false };
  const ref = `${to.id}:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const claimed = await claimEmail(deps.db, to.id, `broadcast_test:${campaign.id}`, ref);
  return { ...result, logged: claimed };
}

async function readState(bucket: StickersBucket, campaignId: string): Promise<BroadcastState | null> {
  const object = await bucket.get(stateKey(campaignId));
  if (!object) return null;
  return JSON.parse(await new Response(object.body).text()) as BroadcastState;
}

const writeState = (bucket: StickersBucket, state: BroadcastState) =>
  bucket.put(stateKey(state.id), JSON.stringify(state), { httpMetadata: { contentType: "application/json" } });

/** Everyone who could get this campaign, sorted into who is done, opted out, given up on, and still to mail. */
async function audience(deps: BroadcastDeps, campaignId: string, state: BroadcastState | null) {
  const kind = `broadcast:${campaignId}` as const;
  const [users, optedOut, sentRows] = await Promise.all([
    deps.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.emailVerified, true))
      .orderBy(user.id),
    listOptedOut(deps.bucket),
    deps.db.select({ ref: emailLog.ref }).from(emailLog).where(eq(emailLog.kind, kind)),
  ]);
  const sentIds = new Set(sentRows.map((row) => row.ref));
  const eligible = users.filter((u) => u.email.includes("@"));
  const optedOutUsers = eligible.filter((u) => optedOut.has(u.id));
  const sent = eligible.filter((u) => sentIds.has(u.id));
  const open = eligible.filter((u) => !optedOut.has(u.id) && !sentIds.has(u.id));
  const exhausted = (id: string) => (state?.failures[id]?.attempts ?? 0) >= MAX_ATTEMPTS;
  return {
    eligible,
    optedOut: optedOutUsers,
    sent,
    gaveUp: open.filter((u) => exhausted(u.id)),
    pending: open.filter((u) => !exhausted(u.id)),
  };
}

export async function broadcastStatus(deps: BroadcastDeps, campaignId: string): Promise<BroadcastStatus> {
  const state = await readState(deps.bucket, campaignId);
  const who = await audience(deps, campaignId, state);
  return {
    id: campaignId,
    state: state ? state.status : "idle",
    eligible: who.eligible.length,
    optedOut: who.optedOut.length,
    sent: who.sent.length,
    failed: who.gaveUp.length,
    remaining: who.pending.length,
    startedAt: state?.startedAt ?? null,
    finishedAt: state?.finishedAt ?? null,
    campaign: state ? { id: state.id, subject: state.subject, body: state.body } : null,
  };
}

/** Mails up to `limit` of the users still open. Safe to run concurrently with itself: the email_log claim decides. */
async function runBatch(deps: BroadcastDeps, state: BroadcastState, limit: number): Promise<BatchResult> {
  const kind = `broadcast:${state.id}` as const;
  const { pending } = await audience(deps, state.id, state);
  if (!deps.email) return { sent: 0, failed: 0, stopped: "email off (no EMAIL binding)" };
  const todo = pending.slice(0, limit);
  let next = 0;
  let sent = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let stopped: string | null = null;

  const worker = async () => {
    while (stopped === null) {
      const recipient = todo[next++];
      if (!recipient) return;
      if (!(await claimEmail(deps.db, recipient.id, kind, recipient.id))) continue;
      const { mail, unsubscribeUrl: url } = await renderFor(deps, state, recipient);
      const result = await deliver(deps, mail, recipient.email, url);
      if (result.ok) {
        sent++;
        consecutiveFailures = 0;
        continue;
      }
      await deps.db.delete(emailLog).where(and(eq(emailLog.kind, kind), eq(emailLog.ref, recipient.id)));
      failed++;
      consecutiveFailures++;
      const rateLimited = RATE_LIMIT_RE.test(result.error);
      const previous = state.failures[recipient.id]?.attempts ?? 0;
      state.failures[recipient.id] = { attempts: rateLimited ? previous : previous + 1, error: result.error };
      if (rateLimited || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) stopped = result.error;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { sent, failed, stopped };
}

export class RecipientCountChanged extends Error {
  constructor(public current: number) {
    super(`recipient count changed: now ${current}`);
  }
}

/**
 * Starts (or continues) a campaign and mails one batch. The first call freezes
 * the subject and body in R2 so the cron can finish the job with exactly what was
 * confirmed, and requires `expected` to match the number of users about to be
 * mailed. Later calls ignore `campaign` and `expected` and just resume.
 */
export async function sendBroadcast(
  deps: BroadcastDeps,
  campaign: Campaign,
  expected: number,
  limit = BATCH_LIMIT,
): Promise<{ batch: BatchResult; status: BroadcastStatus }> {
  let state = await readState(deps.bucket, campaign.id);
  if (!state) {
    const who = await audience(deps, campaign.id, null);
    if (who.pending.length !== expected) throw new RecipientCountChanged(who.pending.length);
    state = { ...campaign, status: "sending", startedAt: Date.now(), failures: {} };
  } else {
    state = { ...state, status: "sending", finishedAt: undefined };
  }
  await writeState(deps.bucket, state);
  return finishBatch(deps, state, limit);
}

async function finishBatch(deps: BroadcastDeps, state: BroadcastState, limit: number) {
  const batch = await runBatch(deps, state, limit);
  // Failures first: the status below reads them back to know who was given up on.
  await writeState(deps.bucket, state);
  const status = await broadcastStatus(deps, state.id);
  const next: BroadcastState =
    status.remaining === 0 ? { ...state, status: "done", finishedAt: state.finishedAt ?? Date.now() } : state;
  if (next !== state) await writeState(deps.bucket, next);
  return { batch, status: { ...status, state: next.status, finishedAt: next.finishedAt ?? null } };
}

/** Cron: continues a campaign left in "sending" (rate limited, or the admin closed the tab). One batch per tick. */
export async function runBroadcastTick(deps: BroadcastDeps, limit = BATCH_LIMIT): Promise<BatchResult | null> {
  const listing = await deps.bucket.list({ prefix: STATE_PREFIX });
  for (const { key } of listing.objects) {
    const state = await readState(deps.bucket, key.slice(STATE_PREFIX.length).replace(/\.json$/, ""));
    if (state?.status !== "sending") continue;
    return (await finishBatch(deps, state, limit)).batch;
  }
  return null;
}
