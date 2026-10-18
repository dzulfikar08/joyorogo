import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { deleteAllUserData } from "../lib/privacy";
import { SYNC_LIMITS, type SyncNs } from "../lib/sync-record";
import {
  remoteWins,
  runSync,
  type LocalState,
  type RecordAdapter,
  type ServerTimes,
  type SyncIo,
  type SyncReport,
  type WireRecord,
} from "../lib/sync-engine";
import { syncRouter } from "./sync";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, founder_until) VALUES
    ('free', 'free', 'free@test.id', 'free', NULL),
    ('pro', 'pro', 'pro@test.id', 'founder', NULL),
    ('pro2', 'pro2', 'pro2@test.id', 'founder', NULL);
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string, env: Context["env"] = { FREE_DAILY_SCANS: "3" }) => ({
  context: { db, env, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const at = (seconds: number) => T0 + seconds * 1000;
const clock = (ms: number) => setSystemTime(new Date(ms));
afterEach(() => setSystemTime());

/** An in-memory adapter for one kind: a map of documents with the engine's dirty / server-time rules. */
class MemAdapter implements RecordAdapter {
  readonly rows = new Map<string, LocalState>();
  constructor(
    readonly kind: string,
    private readonly now: () => number,
  ) {}

  edit(id: string, value: unknown, rank = 0): void {
    this.rows.set(id, { kind: this.kind, id, json: JSON.stringify({ value }), updatedAt: this.now(), deletedAt: null, rank, dirty: true });
  }

  remove(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    const t = this.now();
    this.rows.set(id, { ...row, updatedAt: t, deletedAt: t, dirty: true });
  }

  /** The live value of a document, or undefined when missing or deleted. */
  value(id: string): unknown {
    const row = this.rows.get(id);
    return row && row.deletedAt === null ? (JSON.parse(row.json) as { value: unknown }).value : undefined;
  }

  async listDirty(limit: number): Promise<WireRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.dirty)
      .slice(0, limit)
      .map(({ dirty: _dirty, ...wire }) => wire);
  }

  async markPushed(sent: WireRecord[], serverTimes: (record: WireRecord) => ServerTimes): Promise<void> {
    for (const record of sent) {
      const current = this.rows.get(record.id);
      if (!current || current.updatedAt !== record.updatedAt || current.json !== record.json) continue;
      this.rows.set(record.id, { ...current, ...serverTimes(record), dirty: false });
    }
  }

  async applyRemote(remote: WireRecord, skew: number): Promise<boolean> {
    if (!remoteWins(this.rows.get(remote.id) ?? null, remote, skew)) return false;
    this.rows.set(remote.id, { ...remote, dirty: false });
    return true;
  }
}

/** A phone: its own clock (offset from the real one), its adapters, its cursor, talking to the real router. */
class Phone {
  cursor = 0;
  readonly adapters: Record<string, MemAdapter> = {};
  constructor(
    private userId: string,
    private ns: SyncNs,
    private offsetMs = 0,
    kinds: string[] = ["pref"],
  ) {
    for (const kind of kinds) this.adapters[kind] = new MemAdapter(kind, () => this.now());
  }

  now = () => Date.now() + this.offsetMs;
  get pref(): MemAdapter {
    return this.adapters.pref!;
  }

  private io(): SyncIo {
    return {
      now: this.now,
      pull: async (since) => {
        const page = await call(syncRouter.pull, { ns: this.ns, since }, as(this.userId));
        return page;
      },
      push: (clientNow, records) =>
        call(syncRouter.push, { ns: this.ns, clientNow, records: records.map((r) => ({ ...r })) }, as(this.userId)),
      getCursor: async () => this.cursor,
      setCursor: async (cursor) => {
        this.cursor = cursor;
      },
    };
  }

  sync(): Promise<SyncReport> {
    return runSync(this.io(), Object.values(this.adapters));
  }

  /** Sign-out wipes this phone only: local rows and the cursor go, the account keeps its records. */
  signOutWipe(): void {
    for (const adapter of Object.values(this.adapters)) adapter.rows.clear();
    this.cursor = 0;
  }
}

async function rows(userId: string, ns: string) {
  const result = await client.execute({
    sql: "SELECT kind, id, json, updated_at, deleted_at, rank, server_at FROM sync_record WHERE user_id = ? AND ns = ? ORDER BY server_at, kind, id",
    args: [userId, ns],
  });
  const raw: Record<string, unknown>[] = result.rows;
  return raw.map((r) => ({
    kind: String(r.kind),
    id: String(r.id),
    updatedAt: Number(r.updated_at),
    deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
    rank: Number(r.rank),
    serverAt: Number(r.server_at),
  }));
}

describe("two phones, JoyoRogo preferences (free)", () => {
  test("create on A appears on B", async () => {
    clock(at(0));
    const a = new Phone("free", "rogo");
    const b = new Phone("free", "rogo");
    a.pref.edit("theme", "dark");
    const report = await a.sync();
    expect(report.pushed).toBe(1);
    expect(report.locked).toBe(false);
    clock(at(5));
    await b.sync();
    expect(b.pref.value("theme")).toBe("dark");
    expect(b.pref.rows.get("theme")?.dirty).toBe(false);
  });

  test("edit on B updates A", async () => {
    clock(at(100));
    const a = new Phone("free", "rogo");
    const b = new Phone("free", "rogo");
    a.pref.edit("makan.view", "list");
    await a.sync();
    clock(at(110));
    await b.sync();
    clock(at(120));
    b.pref.edit("makan.view", "week");
    await b.sync();
    clock(at(130));
    const second = await a.sync();
    expect(second.applied).toBe(1);
    expect(a.pref.value("makan.view")).toBe("week");
    // A pulling its own acknowledged record again changes nothing and uploads nothing.
    clock(at(140));
    const third = await a.sync();
    expect(third.pushed).toBe(0);
    expect(third.applied).toBe(0);
  });

  test("a delete on A is a tombstone that removes the value on B", async () => {
    clock(at(200));
    const a = new Phone("free", "rogo");
    const b = new Phone("free", "rogo");
    a.pref.edit("sticker", { watermark: false });
    await a.sync();
    clock(at(210));
    await b.sync();
    expect(b.pref.value("sticker")).toEqual({ watermark: false });
    clock(at(220));
    a.pref.remove("sticker");
    await a.sync();
    clock(at(230));
    await b.sync();
    expect(b.pref.value("sticker")).toBeUndefined();
    const stored = (await rows("free", "rogo")).find((r) => r.id === "sticker");
    expect(stored?.deletedAt).not.toBeNull();
  });

  test("concurrent offline edits: the later edit wins on both phones", async () => {
    clock(at(300));
    const a = new Phone("free", "rogo");
    const b = new Phone("free", "rogo");
    a.pref.edit("theme", "light");
    await a.sync();
    await b.sync();
    clock(at(310));
    a.pref.edit("theme", "dark"); // earlier, never pushed yet
    clock(at(320));
    b.pref.edit("theme", "system"); // later
    clock(at(330));
    await a.sync(); // A pushes its (older) edit first
    clock(at(340));
    await b.sync(); // B pulls A's older edit (keeps its own, dirty and newer), pushes
    clock(at(350));
    await a.sync();
    expect(a.pref.value("theme")).toBe("system");
    expect(b.pref.value("theme")).toBe("system");
  });

  test("a phone whose clock is an hour behind still wins with its later edit", async () => {
    clock(at(400));
    const a = new Phone("free", "rogo");
    const b = new Phone("free", "rogo", -3_600_000);
    clock(at(410));
    a.pref.edit("reminders", { water: true });
    clock(at(420));
    b.pref.edit("reminders", { water: false }); // real time later, B's clock reads an hour earlier
    clock(at(430));
    await a.sync();
    clock(at(440));
    await b.sync();
    clock(at(450));
    await a.sync();
    expect(a.pref.value("reminders")).toEqual({ water: false });
    expect(b.pref.value("reminders")).toEqual({ water: false });
  });

  test("a phone whose clock is a day ahead cannot win over a later real edit, nor sit in the future", async () => {
    clock(at(500));
    const a = new Phone("free", "rogo", 86_400_000);
    const b = new Phone("free", "rogo");
    clock(at(510));
    a.pref.edit("theme", "dark"); // A's clock says tomorrow
    await a.sync();
    clock(at(520));
    b.pref.edit("theme", "light");
    await b.sync();
    clock(at(530));
    await a.sync();
    expect(a.pref.value("theme")).toBe("light");
    const stored = (await rows("free", "rogo")).find((r) => r.id === "theme");
    expect(stored!.updatedAt).toBeLessThanOrEqual(at(530));
  });

  test("first sign-in on a new phone restores everything, across pages", async () => {
    clock(at(600));
    const a = new Phone("free", "rogo");
    for (let i = 0; i < SYNC_LIMITS.pullPage + 50; i++) a.pref.edit(`dismissed.k${i}`, true);
    // 250 records go in three pushes of at most 100.
    const upload = await a.sync();
    expect(upload.pushed).toBe(SYNC_LIMITS.pullPage + 50);
    clock(at(610));
    const fresh = new Phone("free", "rogo");
    const restore = await fresh.sync();
    // The account also holds the records the earlier tests left; the new phone restores all of them.
    expect(restore.applied).toBe((await rows("free", "rogo")).length);
    expect(restore.applied).toBeGreaterThan(SYNC_LIMITS.pullPage + 50);
    expect(fresh.pref.value("dismissed.k249")).toBe(true);
    expect(restore.pushed).toBe(0);
  });

  test("sign-out wipes this phone only; signing in again restores it", async () => {
    clock(at(700));
    const a = new Phone("free", "rogo");
    a.pref.edit("theme", "dark");
    await a.sync();
    a.signOutWipe();
    expect(a.pref.value("theme")).toBeUndefined();
    expect((await rows("free", "rogo")).some((r) => r.id === "theme" && r.deletedAt === null)).toBe(true);
    clock(at(710));
    await a.sync();
    expect(a.pref.value("theme")).toBe("dark");
  });

  test("another account never sees these records", async () => {
    clock(at(800));
    const a = new Phone("free", "rogo");
    a.pref.edit("theme", "dark");
    await a.sync();
    const other = new Phone("pro2", "rogo");
    await other.sync();
    expect(other.pref.value("theme")).toBeUndefined();
  });
});

describe("two phones, JoyoFit documents (Pro writes)", () => {
  const kinds = ["pref", "sticker", "route", "metric", "hrv", "cycleday"];

  test("a free account is told it is locked, keeps its records waiting, and can still read", async () => {
    clock(at(1000));
    const proPhone = new Phone("pro", "fit", 0, kinds);
    proPhone.pref.edit("ftp", 250);
    await proPhone.sync();
    const free = new Phone("free", "fit", 0, kinds);
    free.pref.edit("ftp", 100);
    const report = await free.sync();
    expect(report.locked).toBe(true);
    expect(report.pushed).toBe(0);
    expect(free.pref.rows.get("ftp")?.dirty).toBe(true);
    expect(await rows("free", "fit")).toHaveLength(0);
    // Reads are open: a lapsed account still restores what it uploaded while Pro.
    await call(syncRouter.status, { ns: "fit" }, as("free")).then((s) => expect(s.unlocked).toBe(false));
    const status = await call(syncRouter.status, { ns: "fit" }, as("pro"));
    expect(status).toMatchObject({ unlocked: true, records: 1, quotaBytes: SYNC_LIMITS.perUserBytes });
    expect(status.bytes).toBeGreaterThan(0);
  });

  test("routes, stickers and cycle days restore on a second phone; a route delete is a tombstone", async () => {
    clock(at(1100));
    const a = new Phone("pro", "fit", 0, kinds);
    const b = new Phone("pro", "fit", 0, kinds);
    a.adapters.route!.edit("r1", { name: "Pagi", pts: [1, 2, 3] });
    a.adapters.sticker!.edit("s1", { template: "x" });
    a.adapters.cycleday!.edit("2026-10-17", { flow: 2 });
    await a.sync();
    clock(at(1110));
    await b.sync();
    expect(b.adapters.route!.value("r1")).toEqual({ name: "Pagi", pts: [1, 2, 3] });
    expect(b.adapters.sticker!.value("s1")).toEqual({ template: "x" });
    expect(b.adapters.cycleday!.value("2026-10-17")).toEqual({ flow: 2 });
    clock(at(1120));
    b.adapters.route!.remove("r1");
    await b.sync();
    clock(at(1130));
    await a.sync();
    expect(a.adapters.route!.value("r1")).toBeUndefined();
  });

  test("coverage: a fuller day bundle beats a newer partial one; a delete ignores coverage", async () => {
    clock(at(1200));
    const a = new Phone("pro", "fit", 0, kinds);
    const b = new Phone("pro", "fit", 0, kinds);
    a.adapters.metric!.edit("spo2:2026-10-17", { n: 300 }, 300);
    await a.sync();
    clock(at(1210));
    b.adapters.metric!.edit("spo2:2026-10-17", { n: 20 }, 20); // newer, fewer samples
    await b.sync();
    clock(at(1220));
    await a.sync();
    await b.sync();
    expect(a.adapters.metric!.value("spo2:2026-10-17")).toEqual({ n: 300 });
    expect(b.adapters.metric!.value("spo2:2026-10-17")).toEqual({ n: 300 });
    clock(at(1230));
    a.adapters.metric!.remove("spo2:2026-10-17");
    await a.sync();
    clock(at(1240));
    await b.sync();
    expect(b.adapters.metric!.value("spo2:2026-10-17")).toBeUndefined();
  });

  test("pushing the same batch twice stores one row per record", async () => {
    clock(at(1300));
    const a = new Phone("pro", "fit", 0, kinds);
    a.adapters.hrv!.edit("1792000000:night", { rmssd: 42 });
    await a.sync();
    const before = (await rows("pro", "fit")).filter((r) => r.kind === "hrv");
    const record = {
      kind: "hrv",
      id: "1792000000:night",
      json: JSON.stringify({ value: { rmssd: 42 } }),
      updatedAt: at(1300),
      deletedAt: null,
      rank: 0,
    };
    await call(syncRouter.push, { ns: "fit", clientNow: at(1300), records: [record, record] }, as("pro"));
    const after = (await rows("pro", "fit")).filter((r) => r.kind === "hrv");
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
  });

  test("unknown kinds, oversized and non-object documents are rejected, valid ones stored", async () => {
    clock(at(1400));
    const base = { updatedAt: at(1400), deletedAt: null, rank: 0 };
    const result = await call(
      syncRouter.push,
      {
        ns: "fit",
        clientNow: at(1400),
        records: [
          { ...base, kind: "nope", id: "a", json: "{}" },
          { ...base, kind: "hrv", id: "big", json: JSON.stringify({ pad: "x".repeat(2000) }) },
          { ...base, kind: "hrv", id: "arr", json: "[1]" },
          { ...base, kind: "hrv", id: "bad", json: "{oops" },
          { ...base, kind: "hrv", id: "ok", json: "{}" },
        ],
      },
      as("pro"),
    );
    if (result.status !== "ok") throw new Error("locked");
    expect(result.stored).toBe(1);
    expect(result.rejected.map((r) => [r.id, r.reason])).toEqual([
      ["a", "unknown_kind"],
      ["big", "too_large"],
      ["arr", "shape"],
      ["bad", "not_json"],
    ]);
    // `cycleday` belongs to fit, not rogo.
    const rogo = await call(
      syncRouter.push,
      { ns: "rogo", clientNow: at(1400), records: [{ ...base, kind: "cycleday", id: "d", json: "{}" }] },
      as("pro"),
    );
    if (rogo.status !== "ok") throw new Error("locked");
    expect(rogo.rejected[0]?.reason).toBe("unknown_kind");
  });
});

describe("account size quota", () => {
  /** Rows written directly (a push is capped at 2 MB) until exactly `freeBytes` of the quota are left. */
  async function fillTo(userId: string, freeBytes: number) {
    await client.execute({ sql: 'INSERT INTO "user" (id, name, email, tier, founder_until) VALUES (?, ?, ?, \'founder\', NULL)', args: [userId, userId, `${userId}@test.id`] });
    const insert = (id: string, pad: number, serverAt: number) =>
      client.execute({
        sql: "INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, deleted_at, rank, server_at) VALUES (?, 'fit', 'route', ?, ?, 1, NULL, 0, ?)",
        args: [userId, id, JSON.stringify({ pad: "x".repeat(pad) }), serverAt],
      });
    const chunk = 1_000_000;
    let used = 0;
    let n = 0;
    while (SYNC_LIMITS.perUserBytes - used - freeBytes > chunk + 20) {
      await insert(`fill${n}`, chunk, ++n);
      used += chunk + 10;
    }
    const last = SYNC_LIMITS.perUserBytes - used - freeBytes - 10;
    await insert("fill-last", last, ++n);
    const [row] = (await client.execute({ sql: "SELECT sum(length(cast(json as blob))) AS n FROM sync_record WHERE user_id = ?", args: [userId] })).rows;
    expect(SYNC_LIMITS.perUserBytes - Number(row?.n)).toBe(freeBytes);
  }

  const record = (kind: string, id: string, doc: unknown, t: number) => ({ kind, id, json: JSON.stringify(doc), updatedAt: t, deletedAt: null, rank: 0 });

  test("a push over the byte quota stores what fits, rejects the rest as quota, and a rewrite that shrinks always fits", async () => {
    clock(at(3000));
    await fillTo("quota", 10_000);
    const small = record("pref", "small", { value: 1 }, at(3000));
    const big = record("sticker", "big", { pad: "y".repeat(30_000) }, at(3000));
    const result = await call(syncRouter.push, { ns: "fit", clientNow: at(3000), records: [big, small] }, as("quota"));
    if (result.status !== "ok") throw new Error("locked");
    expect(result.stored).toBe(1);
    expect(result.rejected).toEqual([{ kind: "sticker", id: "big", reason: "quota" }]);
    expect((await rows("quota", "fit")).some((r) => r.id === "big")).toBe(false);

    const shrink = record("route", "fill0", { pad: "z" }, at(3010));
    const again = await call(syncRouter.push, { ns: "fit", clientNow: at(3010), records: [shrink] }, as("quota"));
    if (again.status !== "ok") throw new Error("locked");
    expect(again.stored).toBe(1);
    expect(again.rejected).toEqual([]);

    // The shrink freed about 1 MB: the big record now fits.
    const retry = await call(syncRouter.push, { ns: "fit", clientNow: at(3020), records: [{ ...big, updatedAt: at(3020) }] }, as("quota"));
    if (retry.status !== "ok") throw new Error("locked");
    expect(retry.stored).toBe(1);

    const status = await call(syncRouter.status, { ns: "fit" }, as("quota"));
    expect(status.quotaBytes).toBe(SYNC_LIMITS.perUserBytes);
    expect(status.bytes).toBeLessThanOrEqual(SYNC_LIMITS.perUserBytes);
  });

  test("the engine keeps quota-rejected records dirty and reports quota", async () => {
    clock(at(3100));
    await fillTo("quota2", 5_000);
    const a = new Phone("quota2", "fit", 0, ["pref", "sticker"]);
    a.adapters.sticker!.edit("huge", { pad: "h".repeat(40_000) });
    a.adapters.pref!.edit("tiny", true);
    const report = await a.sync();
    expect(report.quota).toBe(true);
    expect(report.full).toBe(false);
    expect(report.pushed).toBe(1);
    expect(a.adapters.sticker!.rows.get("huge")?.dirty).toBe(true);
    expect(a.adapters.pref!.rows.get("tiny")?.dirty).toBe(false);
  });
});

describe("wipe and account deletion", () => {
  test("wipe with kinds removes only those kinds; without kinds the namespace; account deletion removes all", async () => {
    clock(at(2000));
    const a = new Phone("pro2", "fit", 0, ["pref", "cycleday", "cycleperiod"]);
    a.pref.edit("ftp", 200);
    a.adapters.cycleday!.edit("2026-10-01", { flow: 1 });
    a.adapters.cycleperiod!.edit("2026-10-01", { end: null });
    await a.sync();
    await call(syncRouter.wipe, { ns: "fit", kinds: ["cycleday", "cycleperiod"] }, as("pro2"));
    expect((await rows("pro2", "fit")).map((r) => r.kind)).toEqual(["pref"]);
    await call(syncRouter.wipe, { ns: "fit" }, as("pro2"));
    expect(await rows("pro2", "fit")).toHaveLength(0);

    a.pref.edit("ftp", 210);
    await a.sync();
    await deleteAllUserData(db, "pro2");
    expect(await rows("pro2", "fit")).toHaveLength(0);
  });
});

describe("remoteWins", () => {
  const local = (over: Partial<LocalState>): LocalState => ({
    kind: "pref",
    id: "k",
    json: '{"value":1}',
    updatedAt: 1000,
    deletedAt: null,
    rank: 0,
    dirty: false,
    ...over,
  });
  const remote = (over: Partial<WireRecord>): WireRecord => ({
    kind: "pref",
    id: "k",
    json: '{"value":2}',
    updatedAt: 2000,
    deletedAt: null,
    rank: 0,
    ...over,
  });

  test("time, tie, skew of a dirty record, rank, tombstone", () => {
    expect(remoteWins(null, remote({}), 0)).toBe(true);
    expect(remoteWins(local({}), remote({}), 0)).toBe(true);
    expect(remoteWins(local({ updatedAt: 2000 }), remote({}), 0)).toBe(false);
    expect(remoteWins(local({ json: remote({}).json }), remote({ updatedAt: 9999 }), 0)).toBe(false);
    // A dirty record is in the phone's clock: 1500 + 1000 skew = 2500 on the server clock.
    expect(remoteWins(local({ updatedAt: 1500, dirty: true }), remote({}), 1000)).toBe(false);
    expect(remoteWins(local({ updatedAt: 1500, dirty: false }), remote({}), 1000)).toBe(true);
    expect(remoteWins(local({ rank: 5 }), remote({ rank: 1 }), 0)).toBe(false);
    expect(remoteWins(local({ rank: 1 }), remote({ rank: 5, updatedAt: 1 }), 0)).toBe(true);
    expect(remoteWins(local({ rank: 5 }), remote({ rank: 0, deletedAt: 2000 }), 0)).toBe(true);
  });
});
