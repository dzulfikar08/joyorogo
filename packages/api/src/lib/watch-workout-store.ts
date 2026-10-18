// Storage of the cloud workouts (D1 `watch_workout` + one R2 document each). The oRPC router (reads, delete, wipe)
// and the upload route in apps/server both go through here, so the rules live in one place:
// - dedupe: one row per (user, start); the same bytes again change nothing, different bytes replace the workout.
// - a deleted workout stays as a tombstone and refuses uploads of the same start.
// - the numbers of the row are read from the uploaded document (see watch-workout.ts).
// - an account keeps at most WATCH_WORKOUT_LIMITS.userBytes.

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";
import type { WatchWorkoutRow } from "@joyorogo/db/schema/watch-workout";

import type { StickersBucket } from "./sticker";
import { premiumUnlocked } from "./readiness-food";
import { paywallConfig } from "./tiers";
import type { PaywallEnv } from "./tiers";
import {
  WATCH_WORKOUT_LIMITS,
  WatchWorkoutDocError,
  readDoc,
  sha256Hex,
  summarize,
  watchBlobKey,
  watchBlobPrefix,
} from "./watch-workout";

/** The upload was refused for a reason that is not the document's fault. */
export class WatchWorkoutRefusal extends Error {
  constructor(
    readonly code: "deleted" | "quota",
    message: string,
  ) {
    super(message);
  }
}

/** What a list or a pull shows of one workout; the document stays in R2. */
export interface WatchWorkoutListItem {
  start: number;
  workoutNumber: number;
  sportName: string;
  sportKind: string;
  elapsedSec: number;
  movingSec: number;
  distanceM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  calories: number;
  steps: number;
  pointCount: number;
  hasGps: boolean;
  hasAnalysis: boolean;
  imported: boolean;
  complete: boolean;
  engineRev: number;
  blobBytes: number;
  version: number;
  /** Epoch ms of the last change. */
  updatedAt: number;
  /** Epoch ms the workout was deleted; its other numbers are then the last known ones. */
  deletedAt: number | null;
}

export function toListItem(row: WatchWorkoutRow): WatchWorkoutListItem {
  return {
    start: row.start,
    workoutNumber: row.workoutNumber,
    sportName: row.sportName,
    sportKind: row.sportKind,
    elapsedSec: row.elapsedSec,
    movingSec: row.movingSec,
    distanceM: row.distanceM,
    elevGainM: row.elevGainM,
    elevLossM: row.elevLossM,
    avgHr: row.avgHr,
    maxHr: row.maxHr,
    calories: row.calories,
    steps: row.steps,
    pointCount: row.pointCount,
    hasGps: row.hasGps,
    hasAnalysis: row.hasAnalysis,
    imported: row.imported,
    complete: row.complete,
    engineRev: row.engineRev,
    blobBytes: row.blobBytes,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** Same rule as `fitness.cloudAccess`: Pro, or any account on a server without a paywall. */
export async function cloudUnlocked(db: Database, env: PaywallEnv, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ tier: user.tier, founderUntil: user.founderUntil })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return premiumUnlocked(row, paywallConfig(env));
}

/** An `updated_at` that is later than every other row of the user, so a pull by (updated_at, start) never skips one. */
function nextUpdatedAt(userId: string) {
  return sql<number>`max(${Date.now()}, coalesce((select max(${watchWorkout.updatedAt}) from ${watchWorkout} where ${watchWorkout.userId} = ${userId}), 0) + 1)`;
}

export type PutStatus = "created" | "updated" | "unchanged";

export interface PutResult {
  start: number;
  version: number;
  status: PutStatus;
  bytes: number;
}

/**
 * Stores one uploaded workout document. Throws WatchWorkoutDocError for a document that is not valid and
 * WatchWorkoutRefusal for a deleted workout or a full account. The caller has checked the Pro gate.
 */
export async function putWorkout(
  db: Database,
  bucket: StickersBucket,
  userId: string,
  start: number,
  body: Uint8Array,
): Promise<PutResult> {
  if (body.byteLength > WATCH_WORKOUT_LIMITS.gzipBytes) {
    throw new WatchWorkoutDocError("too_large", `Upload is larger than ${WATCH_WORKOUT_LIMITS.gzipBytes} bytes`);
  }
  const doc = await readDoc(body);
  // The address says which workout this is; a document of another start would overwrite the wrong one.
  if (doc.workout.start !== start) throw new WatchWorkoutDocError("bad_doc", "workout.start does not match the address");
  const summary = summarize(doc);
  const hash = await sha256Hex(body);

  const [existing] = await db
    .select()
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), eq(watchWorkout.start, summary.start)))
    .limit(1);
  if (existing?.deletedAt != null) {
    throw new WatchWorkoutRefusal("deleted", "This workout was deleted from the cloud");
  }
  if (existing && existing.contentHash === hash) {
    return { start: summary.start, version: existing.version, status: "unchanged", bytes: existing.blobBytes };
  }

  const [used] = await db
    .select({ bytes: sql<number>`coalesce(sum(${watchWorkout.blobBytes}), 0)` })
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), isNull(watchWorkout.deletedAt)));
  if ((used?.bytes ?? 0) - (existing?.blobBytes ?? 0) + body.byteLength > WATCH_WORKOUT_LIMITS.userBytes) {
    throw new WatchWorkoutRefusal("quota", "The cloud storage of this account is full");
  }

  // Blob first: a failed row write leaves an object the retry overwrites, never a row without its document.
  await bucket.put(watchBlobKey(userId, summary.start), body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, {
    httpMetadata: { contentType: "application/gzip" },
  });

  const now = Date.now();
  const values = {
    userId,
    start: summary.start,
    workoutNumber: summary.workoutNumber,
    sportName: summary.sportName,
    sportKind: summary.sportKind,
    elapsedSec: summary.elapsedSec,
    movingSec: summary.movingSec,
    distanceM: summary.distanceM,
    elevGainM: summary.elevGainM,
    elevLossM: summary.elevLossM,
    avgHr: summary.avgHr,
    maxHr: summary.maxHr,
    calories: summary.calories,
    steps: summary.steps,
    pointCount: summary.pointCount,
    hasGps: summary.hasGps,
    hasAnalysis: summary.hasAnalysis,
    imported: summary.imported,
    complete: summary.complete,
    engineRev: summary.engineRev,
    blobBytes: body.byteLength,
    contentHash: hash,
  };
  const [row] = await db
    .insert(watchWorkout)
    .values({ ...values, version: 1, createdAt: now, updatedAt: nextUpdatedAt(userId) })
    .onConflictDoUpdate({
      target: [watchWorkout.userId, watchWorkout.start],
      set: { ...values, version: sql`${watchWorkout.version} + 1`, updatedAt: nextUpdatedAt(userId) },
    })
    .returning({ version: watchWorkout.version });
  if (!row) throw new Error("watch_workout upsert returned no row");
  return { start: summary.start, version: row.version, status: existing ? "updated" : "created", bytes: body.byteLength };
}

/** The stored gzip document of one workout, or null when it is not there (or was deleted). */
export async function getBlob(db: Database, bucket: StickersBucket, userId: string, start: number): Promise<ArrayBuffer | null> {
  const [row] = await db
    .select({ deletedAt: watchWorkout.deletedAt })
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), eq(watchWorkout.start, start)))
    .limit(1);
  if (!row || row.deletedAt != null) return null;
  const object = await bucket.get(watchBlobKey(userId, start));
  return object ? object.arrayBuffer() : null;
}

export async function getRow(db: Database, userId: string, start: number): Promise<WatchWorkoutRow | null> {
  const [row] = await db
    .select()
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), eq(watchWorkout.start, start)))
    .limit(1);
  return row ?? null;
}

export async function listRows(db: Database, userId: string, before: number | null, limit: number): Promise<WatchWorkoutRow[]> {
  return db
    .select()
    .from(watchWorkout)
    .where(
      and(
        eq(watchWorkout.userId, userId),
        isNull(watchWorkout.deletedAt),
        before === null ? undefined : lt(watchWorkout.start, before),
      ),
    )
    .orderBy(desc(watchWorkout.start))
    .limit(limit);
}

/** Rows changed after `(updatedAt, start)`, oldest change first, tombstones included. */
export async function changedRows(
  db: Database,
  userId: string,
  since: { updatedAt: number; start: number } | null,
  limit: number,
): Promise<WatchWorkoutRow[]> {
  return db
    .select()
    .from(watchWorkout)
    .where(
      and(
        eq(watchWorkout.userId, userId),
        since ? sql`(${watchWorkout.updatedAt}, ${watchWorkout.start}) > (${since.updatedAt}, ${since.start})` : undefined,
      ),
    )
    .orderBy(watchWorkout.updatedAt, watchWorkout.start)
    .limit(limit);
}

export interface WatchWorkoutUsage {
  count: number;
  bytes: number;
  /** Epoch ms of the newest change to a workout that still exists; null without one. */
  lastChangeAt: number | null;
}

export async function usage(db: Database, userId: string): Promise<WatchWorkoutUsage> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${watchWorkout.blobBytes}), 0)`,
      lastChangeAt: sql<number | null>`max(${watchWorkout.updatedAt})`,
    })
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), isNull(watchWorkout.deletedAt)));
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0, lastChangeAt: row?.lastChangeAt ?? null };
}

/** Deletes one workout: the document goes, the row stays as a tombstone. False when there was nothing to delete. */
export async function removeWorkout(db: Database, bucket: StickersBucket, userId: string, start: number): Promise<boolean> {
  const row = await getRow(db, userId, start);
  if (!row || row.deletedAt != null) return false;
  await bucket.delete(watchBlobKey(userId, start));
  await db
    .update(watchWorkout)
    .set({ deletedAt: Date.now(), blobBytes: 0, version: sql`${watchWorkout.version} + 1`, updatedAt: nextUpdatedAt(userId) })
    .where(and(eq(watchWorkout.userId, userId), eq(watchWorkout.start, start)));
  return true;
}

/** Everything the account has in the cloud workouts, rows and documents; no tombstones are left. Repeatable. */
export async function wipeWorkouts(db: Database, bucket: StickersBucket, userId: string): Promise<number> {
  const [counted] = await db
    .select({ n: sql<number>`count(*)` })
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), isNull(watchWorkout.deletedAt)));
  const n = counted?.n ?? 0;
  const prefix = watchBlobPrefix(userId);
  for (let cursor: string | undefined; ; ) {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key));
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  await db.delete(watchWorkout).where(eq(watchWorkout.userId, userId));
  return n;
}
