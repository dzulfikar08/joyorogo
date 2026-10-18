// Multi-device sync records (D1 `sync_record`): preferences and small user-made documents of JoyoRogo (`ns` "rogo")
// and JoyoFit (`ns` "fit"). A record is `{ kind, id, json, updatedAt, deletedAt, rank }`; `json` is a JSON object the
// phone owns, stored as sent so keys a newer app adds survive an older server. Storage and pull: sync-record-store.ts.
// Contract for humans: docs/multi-device.md in both repos.

import { z } from "zod";

/**
 * Kinds per namespace and the largest serialized document each accepts. An unknown ns/kind pair fails the whole
 * request. Writes to `fit` need Pro (like every JoyoFit cloud write); `rogo` writes are free (a few KB per account,
 * and JoyoRogo's own data is server-side for everyone). Reads are always open so data is never locked away.
 */
export const SYNC_KINDS = {
  rogo: {
    /** One preference: id is the key (`theme`, `reminders`, ...), `json` is `{ "value": ... }`. */
    pref: 8 * 1024,
  },
  fit: {
    pref: 8 * 1024,
    /** A Sticker Studio template. */
    sticker: 64 * 1024,
    /** A saved route: meta, thumbnail and its points (at most 5 000). */
    route: 256 * 1024,
    /** A named bike sensor. */
    sensor: 4 * 1024,
    /** One HRV reading, id `<start>:<source>`. */
    hrv: 1024,
    /** One night's sleep score, id is the night's start (unix s). */
    sleepscore: 1024,
    /** A cycle period, id is its start day. Needs the person's "Sinkron data siklus" switch. */
    cycleperiod: 1024,
    /** A cycle day (flow, cramps), id is the day. Same switch. */
    cycleday: 1024,
    /** One health metric type for one day, id `<type>:<yyyy-mm-dd>`; `rank` is its sample count. */
    metric: 64 * 1024,
  },
} as const;

export type SyncNs = keyof typeof SYNC_KINDS;
export const SYNC_NAMESPACES = Object.keys(SYNC_KINDS) as [SyncNs, ...SyncNs[]];

/** Namespaces whose writes need Pro. */
export const SYNC_PRO_NAMESPACES: readonly SyncNs[] = ["fit"];

export const SYNC_LIMITS = {
  /** Records in one push. */
  batch: 100,
  /** Serialized documents in one push, so a request stays small. */
  pushBytes: 2_000_000,
  /** Records one account may hold. */
  perUser: 100_000,
  /** Records in one pull page. */
  pullPage: 200,
  /** Serialized size of one pull page; at least one record always goes out. */
  pullPageBytes: 1_500_000,
  maxId: 96,
  maxRank: 1_000_000_000,
} as const;

const ms = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ns = z.enum(SYNC_NAMESPACES);

export const syncRecordSchema = z.object({
  kind: z.string().min(1).max(32),
  id: z.string().min(1).max(SYNC_LIMITS.maxId),
  json: z.string().min(2).max(256 * 1024),
  updatedAt: ms,
  deletedAt: ms.nullable(),
  rank: z.number().int().min(0).max(SYNC_LIMITS.maxRank).default(0),
});

export type SyncRecordInput = z.infer<typeof syncRecordSchema>;

export const syncPushSchema = z
  .object({
    ns,
    /** The phone's clock when it sent the request; the server shifts every record's times by `now - clientNow`. */
    clientNow: ms,
    records: z.array(syncRecordSchema).max(SYNC_LIMITS.batch),
  })
  .refine((v) => v.records.reduce((n, r) => n + r.json.length, 0) <= SYNC_LIMITS.pushBytes, {
    message: "push_too_large",
  });

export const syncPullSchema = z.object({
  ns,
  since: ms.default(0),
  limit: z.number().int().min(1).max(SYNC_LIMITS.pullPage).optional(),
});

export const syncWipeSchema = z.object({
  ns,
  /** Only these kinds (hard delete); omit to delete the whole namespace. */
  kinds: z.array(z.string().min(1).max(32)).max(16).optional(),
});

export type SyncInvalidReason = "unknown_kind" | "too_large" | "not_json" | "shape";

export type SyncValidation = { ok: true } | { ok: false; reason: SyncInvalidReason };

/** The cap of a kind, or null when the namespace has no such kind. */
export function kindLimit(namespace: SyncNs, kind: string): number | null {
  const kinds: Record<string, number> = SYNC_KINDS[namespace];
  return Object.hasOwn(kinds, kind) ? kinds[kind]! : null;
}

/** Checks a record against its kind: known, within its size cap, a JSON object. */
export function validateSyncRecord(namespace: SyncNs, record: SyncRecordInput): SyncValidation {
  const cap = kindLimit(namespace, record.kind);
  if (cap === null) return { ok: false, reason: "unknown_kind" };
  if (new TextEncoder().encode(record.json).length > cap) return { ok: false, reason: "too_large" };
  let value: unknown;
  try {
    value = JSON.parse(record.json);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "shape" };
  return { ok: true };
}

/**
 * A record's times on the server clock. The phone's clock may be minutes or days off, so both times move by the
 * offset between the server clock and the phone's clock at the moment of the push (an edit made offline an hour
 * before the push stays an hour before it), and never land after the server's own `now`.
 */
export function normalizeTimes(
  record: Pick<SyncRecordInput, "updatedAt" | "deletedAt">,
  clientNow: number,
  now: number,
): { updatedAt: number; deletedAt: number | null } {
  const skew = now - clientNow;
  const shift = (value: number) => Math.min(now, Math.max(0, value + skew));
  return {
    updatedAt: shift(record.updatedAt),
    deletedAt: record.deletedAt === null ? null : shift(record.deletedAt),
  };
}

export interface SyncPullRow {
  kind: string;
  id: string;
  json: string;
  updatedAt: number;
  deletedAt: number | null;
  rank: number;
  serverAt: number;
}

export interface SyncPullPage {
  records: Omit<SyncPullRow, "serverAt">[];
  /** `server_at` of the last record of the page, or the `since` that was asked for when the page is empty. */
  cursor: number;
  hasMore: boolean;
}

/**
 * Builds the answer from rows read in (server_at, kind, id) order, `limit + 1` of them at most: the extra row only
 * says there is more. A page also stops at `pullPageBytes` of documents (never before its first record).
 */
export function buildSyncPage(rows: readonly SyncPullRow[], since: number, limit: number): SyncPullPage {
  const records: SyncPullPage["records"] = [];
  let bytes = 0;
  let cursor = since;
  let taken = 0;
  for (const row of rows) {
    if (taken >= limit) break;
    if (taken > 0 && bytes + row.json.length > SYNC_LIMITS.pullPageBytes) break;
    bytes += row.json.length;
    taken += 1;
    cursor = row.serverAt;
    records.push({
      kind: row.kind,
      id: row.id,
      json: row.json,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      rank: row.rank,
    });
  }
  return { records, cursor, hasMore: taken < rows.length };
}

/** The `server_at` of the first row of a push: after `now` and after every row the account already has. */
export function firstSyncServerAt(now: number, maxServerAt: number | null): number {
  return Math.max(now, (maxServerAt ?? 0) + 1);
}
