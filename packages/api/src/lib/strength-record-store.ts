// Storage of JoyoFit's strength records (D1 `strength_record`), shared by the oRPC router.
// - last write wins per (user, kind, id) on the record's own `updated_at`: an incoming row replaces the stored one
//   only when it is at least as new, decided by the upsert itself so two phones racing cannot both win.
// - `server_at` of every row stored by a push is later than anything the account already has and strictly increases
//   inside the push, so a pull by (server_at, kind, id) never skips a row.
// - an account keeps at most STRENGTH_LIMITS.perUser records; a push over the cap stores what fits.

import { and, asc, eq, gt, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { strengthRecord } from "@joyorogo/db/schema/strength";

import { insertChunked, readChunked } from "./d1";
import {
  STRENGTH_LIMITS,
  buildPullPage,
  firstServerAt,
  validateStrengthRecord,
  type PullPage,
  type StrengthInvalidReason,
  type StrengthRecordInput,
} from "./strength-record";

export interface StrengthRejected {
  kind: string;
  id: string;
  reason: StrengthInvalidReason | "full";
}

export interface StrengthPushOutcome {
  /** Rows written (new, or at least as new as the stored one). */
  stored: number;
  /** Rows the account already has in a newer version. */
  skipped: number;
  /** Rows that were not stored and never will be as sent: a document that is not valid, or an account at its cap. */
  rejected: StrengthRejected[];
}

export async function strengthTotals(db: Database, userId: string): Promise<{ count: number; maxServerAt: number | null }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`, maxServerAt: sql<number | null>`max(${strengthRecord.serverAt})` })
    .from(strengthRecord)
    .where(eq(strengthRecord.userId, userId));
  return { count: row?.count ?? 0, maxServerAt: row?.maxServerAt ?? null };
}

export async function readStrengthPage(db: Database, userId: string, since: number, limit: number): Promise<PullPage> {
  const rows = await db
    .select({
      kind: strengthRecord.kind,
      id: strengthRecord.id,
      json: strengthRecord.json,
      updatedAt: strengthRecord.updatedAt,
      deletedAt: strengthRecord.deletedAt,
      serverAt: strengthRecord.serverAt,
    })
    .from(strengthRecord)
    .where(and(eq(strengthRecord.userId, userId), gt(strengthRecord.serverAt, since)))
    .orderBy(asc(strengthRecord.serverAt), asc(strengthRecord.kind), asc(strengthRecord.id))
    .limit(limit + 1);
  return buildPullPage(rows, since, limit);
}

async function existingKeys(db: Database, userId: string, records: readonly StrengthRecordInput[]): Promise<Set<string>> {
  const rows = await readChunked(
    records,
    (slice) => {
      const pairs = slice.map((r) => sql`(${r.kind}, ${r.id})`);
      return db
        .select({ kind: strengthRecord.kind, id: strengthRecord.id })
        .from(strengthRecord)
        .where(and(eq(strengthRecord.userId, userId), sql`(${strengthRecord.kind}, ${strengthRecord.id}) in (values ${sql.join(pairs, sql`, `)})`));
    },
    { reserved: 1, perKey: 2 },
  );
  return new Set(rows.map((row) => `${row.kind}\u0000${row.id}`));
}

/** Stores a batch (the caller has checked the Pro gate and `STRENGTH_LIMITS.batch`). */
export async function pushStrengthRecords(
  db: Database,
  userId: string,
  records: readonly StrengthRecordInput[],
  now: number = Date.now(),
): Promise<StrengthPushOutcome> {
  const rejected: StrengthRejected[] = [];
  // One row per key: the newest version in the batch (the later one when equal).
  const newest = new Map<string, StrengthRecordInput>();
  for (const record of records) {
    const verdict = validateStrengthRecord(record);
    if (!verdict.ok) {
      rejected.push({ kind: record.kind, id: record.id, reason: verdict.reason });
      continue;
    }
    const key = `${record.kind}\u0000${record.id}`;
    const seen = newest.get(key);
    if (!seen || record.updatedAt >= seen.updatedAt) newest.set(key, record);
  }
  let accepted = [...newest.values()];
  if (accepted.length === 0) return { stored: 0, skipped: 0, rejected };

  const totals = await strengthTotals(db, userId);
  const room = Math.max(0, STRENGTH_LIMITS.perUser - totals.count);
  if (accepted.length > room) {
    // Rows that already exist never grow the account; new ones are taken in order while there is room.
    const existing = await existingKeys(db, userId, accepted);
    let free = room;
    accepted = accepted.filter((record) => {
      if (existing.has(`${record.kind}\u0000${record.id}`)) return true;
      if (free > 0) {
        free -= 1;
        return true;
      }
      rejected.push({ kind: record.kind, id: record.id, reason: "full" });
      return false;
    });
    if (accepted.length === 0) return { stored: 0, skipped: 0, rejected };
  }

  const base = firstServerAt(now, totals.maxServerAt);
  const rows = accepted.map((record, index) => ({
    userId,
    kind: record.kind,
    id: record.id,
    json: record.json,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    serverAt: base + index,
  }));
  const results = await insertChunked(db, strengthRecord, rows, (insert) =>
    insert
      .onConflictDoUpdate({
        target: [strengthRecord.userId, strengthRecord.kind, strengthRecord.id],
        set: {
          json: sql`excluded.json`,
          updatedAt: sql`excluded.updated_at`,
          deletedAt: sql`excluded.deleted_at`,
          serverAt: sql`excluded.server_at`,
        },
        setWhere: sql`excluded.updated_at >= ${strengthRecord.updatedAt}`,
      })
      .returning({ id: strengthRecord.id }),
  );
  const stored = results.reduce((total, rows) => total + rows.length, 0);
  return { stored, skipped: accepted.length - stored, rejected };
}

/** Deletes every record of the account (the app's "delete cloud data"). */
export async function wipeStrength(db: Database, userId: string): Promise<void> {
  await db.delete(strengthRecord).where(eq(strengthRecord.userId, userId));
}
