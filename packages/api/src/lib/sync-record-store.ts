// Storage of multi-device sync records (D1 `sync_record`), shared by the oRPC router.
// - per (user, ns, kind, id) the newest write wins, decided by the upsert itself so two phones racing cannot both
//   win: a tombstone on either side is ordered by `updated_at`; two live rows by `rank` (coverage) first, then
//   `updated_at`. Equal everything: the later push replaces the earlier (same bytes, harmless).
// - times are the phone's, shifted by the push's clock skew and capped at the server clock (`normalizeTimes`).
// - `server_at` of every row stored by a push is later than anything the account already has and strictly increases
//   inside the push, so a pull by (server_at, kind, id) never skips a row.
// - an account keeps at most SYNC_LIMITS.perUser records and SYNC_LIMITS.perUserBytes of documents; a push over a cap
//   stores what fits (a record that already exists may always shrink or keep its size) and rejects the rest as `full`
//   (record count) or `quota` (bytes), which the phone keeps waiting.

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { syncRecord } from "@joyorogo/db/schema/sync";

import { insertChunked, readChunked } from "./d1";
import {
  SYNC_LIMITS,
  buildSyncPage,
  firstSyncServerAt,
  normalizeTimes,
  validateSyncRecord,
  type SyncInvalidReason,
  type SyncNs,
  type SyncPullPage,
  type SyncRecordInput,
} from "./sync-record";

export interface SyncRejected {
  kind: string;
  id: string;
  reason: SyncInvalidReason | "full" | "quota";
}

export interface SyncPushOutcome {
  /** Rows written (new, or winning over the stored one). */
  stored: number;
  /** Rows the account already has in a winning version. */
  skipped: number;
  /** Rows that were not stored and never will be as sent: an invalid document, or an account at its cap. */
  rejected: SyncRejected[];
}

export async function syncTotals(
  db: Database,
  userId: string,
): Promise<{ count: number; bytes: number; maxServerAt: number | null }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(length(cast(${syncRecord.json} as blob))), 0)`,
      maxServerAt: sql<number | null>`max(${syncRecord.serverAt})`,
    })
    .from(syncRecord)
    .where(eq(syncRecord.userId, userId));
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0, maxServerAt: row?.maxServerAt ?? null };
}

export async function syncCount(db: Database, userId: string, ns: SyncNs): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(syncRecord)
    .where(and(eq(syncRecord.userId, userId), eq(syncRecord.ns, ns)));
  return row?.count ?? 0;
}

export async function readSyncPage(
  db: Database,
  userId: string,
  ns: SyncNs,
  since: number,
  limit: number,
): Promise<SyncPullPage> {
  const rows = await db
    .select({
      kind: syncRecord.kind,
      id: syncRecord.id,
      json: syncRecord.json,
      updatedAt: syncRecord.updatedAt,
      deletedAt: syncRecord.deletedAt,
      rank: syncRecord.rank,
      serverAt: syncRecord.serverAt,
    })
    .from(syncRecord)
    .where(and(eq(syncRecord.userId, userId), eq(syncRecord.ns, ns), gt(syncRecord.serverAt, since)))
    .orderBy(asc(syncRecord.serverAt), asc(syncRecord.kind), asc(syncRecord.id))
    .limit(limit + 1);
  return buildSyncPage(rows, since, limit);
}

/** The stored size in bytes of each of `records` that already exists, by `kind\0id`. */
async function existingSizes(
  db: Database,
  userId: string,
  ns: SyncNs,
  records: readonly SyncRecordInput[],
): Promise<Map<string, number>> {
  const rows = await readChunked(
    records,
    (slice) => {
      const pairs = slice.map((r) => sql`(${r.kind}, ${r.id})`);
      return db
        .select({
          kind: syncRecord.kind,
          id: syncRecord.id,
          bytes: sql<number>`length(cast(${syncRecord.json} as blob))`,
        })
        .from(syncRecord)
        .where(
          and(
            eq(syncRecord.userId, userId),
            eq(syncRecord.ns, ns),
            sql`(${syncRecord.kind}, ${syncRecord.id}) in (values ${sql.join(pairs, sql`, `)})`,
          ),
        );
    },
    { reserved: 2, perKey: 2 },
  );
  return new Map(rows.map((row) => [`${row.kind}\u0000${row.id}`, row.bytes]));
}

/** Stores a batch (the caller has checked the Pro gate, `SYNC_LIMITS.batch` and `pushBytes`). */
export async function pushSyncRecords(
  db: Database,
  userId: string,
  ns: SyncNs,
  clientNow: number,
  records: readonly SyncRecordInput[],
  now: number = Date.now(),
): Promise<SyncPushOutcome> {
  const rejected: SyncRejected[] = [];
  // One row per key: the newest version in the batch (the later one when equal).
  const newest = new Map<string, SyncRecordInput>();
  for (const record of records) {
    const verdict = validateSyncRecord(ns, record);
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

  const totals = await syncTotals(db, userId);
  const room = Math.max(0, SYNC_LIMITS.perUser - totals.count);
  const incoming = accepted.map((record) => new TextEncoder().encode(record.json).length);
  const incomingBytes = incoming.reduce((sum, n) => sum + n, 0);
  if (accepted.length > room || totals.bytes + incomingBytes > SYNC_LIMITS.perUserBytes) {
    // Rows that already exist never grow the record count and may always shrink or keep their size; new rows and
    // growth are taken in order while there is room in both the count and the bytes.
    const existing = await existingSizes(db, userId, ns, accepted);
    let freeRecords = room;
    let freeBytes = Math.max(0, SYNC_LIMITS.perUserBytes - totals.bytes);
    const kept: SyncRecordInput[] = [];
    accepted.forEach((record, index) => {
      const size = incoming[index]!;
      const stored = existing.get(`${record.kind}\u0000${record.id}`);
      const growth = Math.max(0, size - (stored ?? 0));
      if (stored === undefined && freeRecords <= 0) {
        rejected.push({ kind: record.kind, id: record.id, reason: "full" });
        return;
      }
      if (growth > freeBytes) {
        rejected.push({ kind: record.kind, id: record.id, reason: "quota" });
        return;
      }
      if (stored === undefined) freeRecords -= 1;
      freeBytes -= growth;
      kept.push(record);
    });
    accepted = kept;
    if (accepted.length === 0) return { stored: 0, skipped: 0, rejected };
  }

  const base = firstSyncServerAt(now, totals.maxServerAt);
  const rows = accepted.map((record, index) => ({
    userId,
    ns,
    kind: record.kind,
    id: record.id,
    json: record.json,
    ...normalizeTimes(record, clientNow, now),
    rank: record.rank,
    serverAt: base + index,
  }));
  const results = await insertChunked(db, syncRecord, rows, (insert) =>
    insert
      .onConflictDoUpdate({
        target: [syncRecord.userId, syncRecord.ns, syncRecord.kind, syncRecord.id],
        set: {
          json: sql`excluded.json`,
          updatedAt: sql`excluded.updated_at`,
          deletedAt: sql`excluded.deleted_at`,
          rank: sql`excluded.rank`,
          serverAt: sql`excluded.server_at`,
        },
        setWhere: sql`CASE
          WHEN excluded.deleted_at IS NOT NULL OR ${syncRecord.deletedAt} IS NOT NULL
            THEN excluded.updated_at >= ${syncRecord.updatedAt}
          ELSE excluded.rank > ${syncRecord.rank}
            OR (excluded.rank = ${syncRecord.rank} AND excluded.updated_at >= ${syncRecord.updatedAt})
          END`,
      })
      .returning({ id: syncRecord.id }),
  );
  const stored = results.reduce((total, rows) => total + rows.length, 0);
  return { stored, skipped: accepted.length - stored, rejected };
}

/** Hard-deletes the account's records of a namespace (all, or only the listed kinds). Not a tombstone. */
export async function wipeSync(db: Database, userId: string, ns: SyncNs, kinds?: readonly string[]): Promise<void> {
  const scope = [eq(syncRecord.userId, userId), eq(syncRecord.ns, ns)];
  if (kinds && kinds.length > 0) scope.push(inArray(syncRecord.kind, [...kinds]));
  await db.delete(syncRecord).where(and(...scope));
}
