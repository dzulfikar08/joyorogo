// D1 access of the Threads mention bot: one row per mention, caps counted from it. Every statement binds a handful of
// parameters (D1 allows 100); nothing here is sized by the caller.

import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { threadsMention, THREADS_MENTION_STATUS } from "@joyorogo/db/schema/threads";

import { jakartaToday } from "../engine";
import { wibDayBounds } from "../tiers";
import type { ReplyDish } from "./reply";

export type MentionRow = typeof threadsMention.$inferSelect;
export type MentionStatus = (typeof THREADS_MENTION_STATUS)[number];

const MAX_ATTEMPTS = 3;
/** A mention older than this is not answered: a reply a day later is noise. */
export const STALE_MS = 24 * 3_600_000;

export type SlotResult = "reserved" | "user_cap" | "global_cap" | "gone";

/** The WIB day the daily caps count in (the same day the admin console reports in). */
export function capWindow(now: number): { startMs: number; endMs: number } {
  const { startMs, endMs } = wibDayBounds(jakartaToday(new Date(now)));
  return { startMs, endMs };
}

/** Records a mention the first time it is seen. False = the row exists already (a webhook retry, or the poll saw it too). */
export async function insertReceived(
  db: Database,
  mediaId: string,
  author: string,
  now: number,
): Promise<boolean> {
  const rows = await db
    .insert(threadsMention)
    .values({
      mediaId,
      authorUsername: author.toLowerCase(),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .onConflictDoNothing()
    .returning({ id: threadsMention.mediaId });
  return rows.length === 1;
}

export async function getMention(db: Database, mediaId: string): Promise<MentionRow | null> {
  const [row] = await db
    .select()
    .from(threadsMention)
    .where(eq(threadsMention.mediaId, mediaId))
    .limit(1);
  return row ?? null;
}

type Patch = Partial<Omit<typeof threadsMention.$inferInsert, "mediaId" | "createdAt">>;

/** Updates a row only while it is in one of `from` (compare-and-set); true when it changed. */
export async function transition(
  db: Database,
  mediaId: string,
  from: readonly MentionStatus[],
  patch: Patch,
  now: number,
): Promise<boolean> {
  const rows = await db
    .update(threadsMention)
    .set({ ...patch, updatedAt: new Date(now) })
    .where(and(eq(threadsMention.mediaId, mediaId), inArray(threadsMention.status, [...from])))
    .returning({ id: threadsMention.mediaId });
  return rows.length === 1;
}

export function markSkipped(
  db: Database,
  mediaId: string,
  reason: string,
  now: number,
  patch: Patch = {},
): Promise<boolean> {
  return transition(
    db,
    mediaId,
    ["received", "scanning"],
    { ...patch, status: "skipped", skipReason: reason },
    now,
  );
}

/**
 * Takes one scan slot BEFORE the model is called, in one statement (`UPDATE ... WHERE count < cap`), so concurrent
 * mentions cannot all read "under the cap" and then all run (same idea as reserveJoyoSlot). The row turns `scanning` and
 * counts toward both caps from this moment. When it does not reserve, the reason is the cap that is full.
 */
export async function reserveSlot(
  db: Database,
  mediaId: string,
  author: string,
  sourceMediaId: string,
  caps: { user: number; global: number },
  now: number,
): Promise<SlotResult> {
  const { startMs, endMs } = capWindow(now);
  const who = author.toLowerCase();
  const rows = await db.all<{ media_id: string }>(sql`
    UPDATE threads_mention SET status = 'scanning', scanned_at = ${now}, source_media_id = ${sourceMediaId}, updated_at = ${now}
    WHERE media_id = ${mediaId} AND status = 'received'
      AND (SELECT count(*) FROM threads_mention WHERE author_username = ${who} AND scanned_at >= ${startMs} AND scanned_at < ${endMs}) < ${caps.user}
      AND (SELECT count(*) FROM threads_mention WHERE scanned_at >= ${startMs} AND scanned_at < ${endMs}) < ${caps.global}
    RETURNING media_id
  `);
  if (rows.length === 1) return "reserved";
  const row = await getMention(db, mediaId);
  if (!row || row.status !== "received") return "gone";
  const [mine] = await db
    .select({ n: sql<number>`count(*)` })
    .from(threadsMention)
    .where(
      and(
        eq(threadsMention.authorUsername, who),
        gte(threadsMention.scannedAt, new Date(startMs)),
        lt(threadsMention.scannedAt, new Date(endMs)),
      ),
    );
  return (mine?.n ?? 0) >= caps.user ? "user_cap" : "global_cap";
}

/** Another mention already answers (or is answering) this same photo: five people tagging us under one post get one reply. */
export async function photoAlreadyHandled(
  db: Database,
  sourceMediaId: string,
  mediaId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: threadsMention.mediaId })
    .from(threadsMention)
    .where(
      and(
        eq(threadsMention.sourceMediaId, sourceMediaId),
        ne(threadsMention.mediaId, mediaId),
        inArray(threadsMention.status, ["scanning", "pending_review", "publishing", "sent"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * A Graph step before the model call failed: count the try and leave the row `received` for the cron sweep, or give up
 * (`failed`) on the third. Frees a scan slot taken for this row, so a fetch error does not burn the daily caps.
 */
export function retryLater(
  db: Database,
  mediaId: string,
  error: string,
  now: number,
): Promise<boolean> {
  return db
    .update(threadsMention)
    .set({
      attempts: sql`${threadsMention.attempts} + 1`,
      status: sql`case when ${threadsMention.attempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'received' end`,
      scannedAt: null,
      error: error.slice(0, 300),
      updatedAt: new Date(now),
    })
    .where(
      and(
        eq(threadsMention.mediaId, mediaId),
        inArray(threadsMention.status, ["received", "scanning"]),
      ),
    )
    .returning({ id: threadsMention.mediaId })
    .then((rows) => rows.length === 1);
}

/** A mention nobody could decide on within a day is too old to answer. */
export async function expireReceived(db: Database, now: number): Promise<void> {
  await db
    .update(threadsMention)
    .set({ status: "skipped", skipReason: "stale", updatedAt: new Date(now) })
    .where(
      and(
        eq(threadsMention.status, "received"),
        lt(threadsMention.createdAt, new Date(now - STALE_MS)),
      ),
    );
}

export function dishesJson(dishes: readonly ReplyDish[]): string {
  return JSON.stringify(dishes.map(({ name, kcal, low, high }) => ({ name, kcal, low, high })));
}

export function parseDishes(raw: string | null): ReplyDish[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReplyDish[]) : [];
  } catch {
    return [];
  }
}

/** Rows to retry: `received` for over 5 minutes (a Graph call failed on the way), fewer than 3 tries, younger than 24 hours. */
export async function staleReceived(
  db: Database,
  now: number,
  limit: number,
): Promise<MentionRow[]> {
  return db
    .select()
    .from(threadsMention)
    .where(
      and(
        eq(threadsMention.status, "received"),
        lt(threadsMention.updatedAt, new Date(now - 5 * 60_000)),
        gte(threadsMention.createdAt, new Date(now - STALE_MS)),
        lt(threadsMention.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(threadsMention.createdAt)
    .limit(limit);
}

export async function listByStatus(
  db: Database,
  statuses: readonly MentionStatus[],
  limit: number,
): Promise<MentionRow[]> {
  return db
    .select()
    .from(threadsMention)
    .where(inArray(threadsMention.status, [...statuses]))
    .orderBy(desc(threadsMention.createdAt))
    .limit(limit);
}

/** Counts for the admin header: rows by status, and scans taken today (what the caps count). */
export async function todayCounts(
  db: Database,
  now: number,
): Promise<{ scans: number; sent: number; pending: number }> {
  const { startMs, endMs } = capWindow(now);
  const [row] = await db.all<{ scans: number; sent: number; pending: number }>(sql`
    SELECT
      (SELECT count(*) FROM threads_mention WHERE scanned_at >= ${startMs} AND scanned_at < ${endMs}) AS scans,
      (SELECT count(*) FROM threads_mention WHERE status = 'sent' AND sent_at >= ${startMs} AND sent_at < ${endMs}) AS sent,
      (SELECT count(*) FROM threads_mention WHERE status = 'pending_review') AS pending
  `);
  return { scans: row?.scans ?? 0, sent: row?.sent ?? 0, pending: row?.pending ?? 0 };
}
