// The phone half of multi-device sync, pure (no React, no storage, no network): `runSync` pulls what other phones
// changed, merges it through the app's adapters, and pushes what changed here. This file is byte-identical in the
// JoyoRogo repo (packages/api/src/lib/sync-engine.ts) and JoyoFit (src/cloud/syncEngine.ts); change both together.
// Server side: sync-record.ts / sync-record-store.ts (JoyoRogo). Contract for humans: docs/multi-device.md.
//
// Ordering. The server orders by each record's `updatedAt` shifted by the clock skew of the pushing phone, so a
// record is "newer" in server time. A phone therefore compares in server time too: a record it has not pushed yet
// (`dirty`) is in the phone's clock and moves by `skew`; a record that came from, or was acknowledged by, the server
// already is in server time (`markPushed` rewrites it). `skew` = server clock - phone clock, learned from the
// `now` every answer carries.

export interface WireRecord {
  kind: string;
  id: string;
  /** A JSON object, serialized. */
  json: string;
  updatedAt: number;
  /** Set for a tombstone (the delete's time); the document stays. */
  deletedAt: number | null;
  /** Coverage for partial kinds (higher wins before time does); 0 otherwise. */
  rank: number;
}

export interface LocalState extends WireRecord {
  /** Changed here and not acknowledged by the server yet; `updatedAt` is then in the phone's clock. */
  dirty: boolean;
}

export interface PullAnswer {
  records: WireRecord[];
  cursor: number;
  hasMore: boolean;
  /** Server clock (ms) when it answered. */
  now: number;
}

export interface PushRejected {
  kind: string;
  id: string;
  reason: string;
}

export type PushAnswer =
  | { status: "locked" }
  | { status: "ok"; stored: number; skipped: number; rejected: PushRejected[]; now: number };

export interface SyncIo {
  /** The phone's clock (ms). */
  now(): number;
  pull(since: number): Promise<PullAnswer>;
  push(clientNow: number, records: WireRecord[]): Promise<PushAnswer>;
  getCursor(): Promise<number>;
  setCursor(cursor: number): Promise<void>;
}

export interface RecordAdapter {
  kind: string;
  /** Up to `limit` records changed here and not acknowledged yet, with the phone's own times. */
  listDirty(limit: number): Promise<WireRecord[]>;
  /**
   * The server stored (or already had a winning version of) exactly these records. For each one that is still
   * unchanged locally: clear `dirty` and store the server-time versions given by `serverTimes`; a record edited
   * meanwhile stays dirty untouched.
   */
  markPushed(sent: WireRecord[], serverTimes: (record: WireRecord) => ServerTimes): Promise<void>;
  /** Merges one pulled record into local state with `remoteWins` (and writes it where the app keeps it). */
  applyRemote(remote: WireRecord, skew: number): Promise<boolean>;
}

export interface ServerTimes {
  updatedAt: number;
  deletedAt: number | null;
}

export interface SyncReport {
  pulled: number;
  applied: number;
  pushed: number;
  skipped: number;
  /** Rejected as invalid for good (never retried) or because the account is full. */
  rejected: PushRejected[];
  /** Pro is needed to upload; nothing was pushed (pulling still ran). */
  locked: boolean;
  /** At least one record could not be stored because the account holds the most records it may; it stays waiting. */
  full: boolean;
  /** At least one record could not be stored because the account's documents are at the size quota; it stays waiting. */
  quota: boolean;
}

/** Records in one push; the server accepts at most this many. */
export const PUSH_BATCH = 100;
/** Serialized documents in one push; the server accepts 2 MB, this leaves room for the envelope. */
export const PUSH_BYTES = 1_500_000;
/**
 * A pull starts this far before the stored cursor. Two pushes racing can store a row with a `server_at` a little
 * below one a puller already saw; the overlap re-reads them, and re-applying a record is a no-op.
 */
export const PULL_OVERLAP_MS = 10_000;
const MAX_PUSH_ROUNDS = 200;
const MAX_PULL_PAGES = 10_000;

/** A record's times on the server clock; the same formula as the server's `normalizeTimes`. */
export function toServerTime(record: Pick<WireRecord, "updatedAt" | "deletedAt">, clientNow: number, serverNow: number): ServerTimes {
  const skew = serverNow - clientNow;
  const shift = (value: number) => Math.min(serverNow, Math.max(0, value + skew));
  return { updatedAt: shift(record.updatedAt), deletedAt: record.deletedAt === null ? null : shift(record.deletedAt) };
}

/**
 * Whether a pulled record replaces the local one. Same document: no. A tombstone on either side is ordered by time;
 * two live versions by `rank` (coverage) first, then time. A tie keeps the local version.
 */
export function remoteWins(local: LocalState | null, remote: WireRecord, skew: number): boolean {
  if (local === null) return true;
  if (local.json === remote.json && (local.deletedAt === null) === (remote.deletedAt === null)) return false;
  const localAt = local.dirty ? local.updatedAt + skew : local.updatedAt;
  if (local.deletedAt !== null || remote.deletedAt !== null) return remote.updatedAt > localAt;
  if (remote.rank !== local.rank) return remote.rank > local.rank;
  return remote.updatedAt > localAt;
}

export async function runSync(io: SyncIo, adapters: readonly RecordAdapter[]): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, applied: 0, pushed: 0, skipped: 0, rejected: [], locked: false, full: false, quota: false };
  const byKind = new Map(adapters.map((adapter) => [adapter.kind, adapter]));

  let since = Math.max(0, (await io.getCursor()) - PULL_OVERLAP_MS);
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const answer = await io.pull(since);
    const skew = answer.now - io.now();
    for (const remote of answer.records) {
      report.pulled += 1;
      // A kind this build does not know came from a newer app: skip it, the cursor still moves on.
      const applied = await byKind.get(remote.kind)?.applyRemote(remote, skew);
      if (applied) report.applied += 1;
    }
    await io.setCursor(answer.cursor);
    if (!answer.hasMore) break;
    since = answer.cursor;
  }

  const waiting = new Set<string>();
  for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
    const batch: { adapter: RecordAdapter; record: WireRecord }[] = [];
    let bytes = 0;
    for (const adapter of adapters) {
      if (batch.length >= PUSH_BATCH) break;
      for (const record of await adapter.listDirty(PUSH_BATCH - batch.length)) {
        if (waiting.has(`${record.kind}\u0000${record.id}`)) continue;
        if (batch.length > 0 && bytes + record.json.length > PUSH_BYTES) break;
        bytes += record.json.length;
        batch.push({ adapter, record });
      }
    }
    if (batch.length === 0) break;

    const clientNow = io.now();
    const answer = await io.push(clientNow, batch.map((entry) => entry.record));
    if (answer.status === "locked") {
      report.locked = true;
      break;
    }
    report.pushed += answer.stored;
    report.skipped += answer.skipped;
    // `full` (record count) and `quota` (bytes) are not the record's fault: it keeps waiting, dirty, and is not retried
    // in this run.
    const held = new Set<string>();
    for (const rejected of answer.rejected) {
      report.rejected.push(rejected);
      if (rejected.reason === "full") report.full = true;
      else if (rejected.reason === "quota") report.quota = true;
      else continue;
      held.add(`${rejected.kind}\u0000${rejected.id}`);
    }
    for (const key of held) waiting.add(key);

    const acknowledged = batch.filter((entry) => !held.has(`${entry.record.kind}\u0000${entry.record.id}`));
    for (const adapter of adapters) {
      const sent = acknowledged.filter((entry) => entry.adapter === adapter).map((entry) => entry.record);
      if (sent.length > 0) await adapter.markPushed(sent, (record) => toServerTime(record, clientNow, answer.now));
    }
    if (acknowledged.length === 0) break;
  }
  return report;
}
