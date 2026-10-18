import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { deleteAllUserData } from "../lib/privacy";
import { STRENGTH_LIMITS } from "../lib/strength-record";
import type { StrengthRecordInput } from "../lib/strength-record";
import { strengthRouter } from "./strength";

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

const pref = (id: string, updatedAt: number, restSec: number | null = 90, deletedAt: number | null = null): StrengthRecordInput => ({
  kind: "pref",
  id,
  json: JSON.stringify({ id, restSec, updatedAt, deletedAt }),
  updatedAt,
  deletedAt,
});

const push = (userId: string, records: StrengthRecordInput[]) => call(strengthRouter.push, { records }, as(userId));
const pull = (userId: string, since = 0, limit?: number) => call(strengthRouter.pull, { since, limit }, as(userId));

async function rows(userId: string) {
  const result = await client.execute({
    sql: "SELECT kind, id, json, updated_at, deleted_at, server_at FROM strength_record WHERE user_id = ? ORDER BY server_at, kind, id",
    args: [userId],
  });
  const raw: Record<string, unknown>[] = result.rows;
  return raw.map((r) => ({
    kind: String(r.kind),
    id: String(r.id),
    json: String(r.json),
    updatedAt: Number(r.updated_at),
    deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
    serverAt: Number(r.server_at),
  }));
}

describe("strength.push", () => {
  test("a free account is told it is locked and nothing is stored", async () => {
    expect(await push("free", [pref("a", 1)])).toEqual({ status: "locked" });
    expect(await rows("free")).toHaveLength(0);
  });

  test("Pro stores records; unlocked shows in status", async () => {
    const result = await push("pro", [pref("a", 10), pref("b", 11)]);
    expect(result).toEqual({ status: "ok", stored: 2, skipped: 0, rejected: [] });
    expect(await call(strengthRouter.status, undefined, as("pro"))).toEqual({ unlocked: true, records: 2 });
    expect(await call(strengthRouter.status, undefined, as("free"))).toEqual({ unlocked: false, records: 0 });
  });

  test("last write wins on the record's updatedAt, equal counts as a rewrite", async () => {
    await push("pro", [pref("lww", 100, 60)]);
    const older = await push("pro", [pref("lww", 99, 30)]);
    expect(older).toMatchObject({ status: "ok", stored: 0, skipped: 1 });
    let stored = (await rows("pro")).find((r) => r.id === "lww")!;
    expect(JSON.parse(stored.json).restSec).toBe(60);
    const newer = await push("pro", [pref("lww", 101, 45)]);
    expect(newer).toMatchObject({ stored: 1, skipped: 0 });
    stored = (await rows("pro")).find((r) => r.id === "lww")!;
    expect(JSON.parse(stored.json).restSec).toBe(45);
    expect(stored.updatedAt).toBe(101);
    const same = await push("pro", [pref("lww", 101, 45)]);
    expect(same).toMatchObject({ stored: 1, skipped: 0 });
  });

  test("a delete is a tombstone that older edits cannot undo", async () => {
    await push("pro", [pref("gone", 200, 90)]);
    await push("pro", [pref("gone", 300, null, 300)]);
    await push("pro", [pref("gone", 250, 120)]);
    const stored = (await rows("pro")).find((r) => r.id === "gone")!;
    expect(stored.deletedAt).toBe(300);
    expect(JSON.parse(stored.json).restSec).toBeNull();
  });

  test("invalid records are rejected one by one, the rest is stored", async () => {
    const bad: StrengthRecordInput = { kind: "workout", id: "w9", json: JSON.stringify({ id: "w9" }), updatedAt: 1, deletedAt: null };
    const mismatch: StrengthRecordInput = { ...pref("m1", 5), id: "m2" };
    const result = await push("pro", [bad, mismatch, pref("fine", 5)]);
    expect(result).toEqual({
      status: "ok",
      stored: 1,
      skipped: 0,
      rejected: [
        { kind: "workout", id: "w9", reason: "shape" },
        { kind: "pref", id: "m2", reason: "id_mismatch" },
      ],
    });
  });

  test("the same key twice in a batch keeps the newer one", async () => {
    const result = await push("pro", [pref("dup", 20, 10), pref("dup", 30, 20), pref("dup", 25, 15)]);
    expect(result).toMatchObject({ stored: 1, skipped: 0 });
    const stored = (await rows("pro")).find((r) => r.id === "dup")!;
    expect(JSON.parse(stored.json).restSec).toBe(20);
  });

  test("a batch of 100 spans several statements and server_at strictly increases", async () => {
    const records = Array.from({ length: STRENGTH_LIMITS.batch }, (_, i) => pref(`bulk${String(i).padStart(3, "0")}`, 1000 + i));
    const result = await push("pro2", records);
    expect(result).toMatchObject({ status: "ok", stored: 100, skipped: 0 });
    const stored = await rows("pro2");
    expect(stored).toHaveLength(100);
    for (let i = 1; i < stored.length; i += 1) expect(stored[i]!.serverAt).toBeGreaterThan(stored[i - 1]!.serverAt);
    // A second push right after still lands after the first one.
    const last = stored[stored.length - 1]!.serverAt;
    await push("pro2", [pref("after", 5000)]);
    expect((await rows("pro2")).find((r) => r.id === "after")!.serverAt).toBeGreaterThan(last);
  });

  test("an unknown kind and more than 100 records are refused outright", async () => {
    await expect(push("pro", [{ ...pref("x", 1), kind: "gizmo" as never }])).rejects.toThrow();
    await expect(push("pro", Array.from({ length: 101 }, (_, i) => pref(`o${i}`, 1)))).rejects.toThrow();
  });
});

describe("strength.pull", () => {
  test("is open to a free account and returns its own rows only", async () => {
    const page = await pull("free");
    expect(page).toEqual({ records: [], cursor: 0, hasMore: false });
    await client.execute({
      sql: "INSERT INTO strength_record (user_id, kind, id, json, updated_at, deleted_at, server_at) VALUES ('free', 'pref', 'old', ?, 1, NULL, 77)",
      args: [JSON.stringify({ id: "old", restSec: 30, updatedAt: 1, deletedAt: null })],
    });
    const after = await pull("free");
    expect(after.records.map((r) => r.id)).toEqual(["old"]);
    expect(after.cursor).toBe(77);
    expect((await pull("pro2")).records.some((r) => r.id === "old")).toBe(false);
  });

  test("pages by server_at; the overlap of one millisecond repeats the last row", async () => {
    const first = await pull("pro2", 0, 40);
    expect(first.records).toHaveLength(40);
    expect(first.hasMore).toBe(true);
    const second = await pull("pro2", first.cursor, 200);
    expect(second.records.length).toBeGreaterThan(0);
    expect(second.records[0]!.id).not.toBe(first.records[first.records.length - 1]!.id);
    // Asking again from cursor - 1 gets the last row of the page back, then the rest.
    const overlap = await pull("pro2", first.cursor - 1, 200);
    expect(overlap.records[0]!.id).toBe(first.records[first.records.length - 1]!.id);
    expect(overlap.records).toHaveLength(second.records.length + 1);
    expect(second.hasMore).toBe(false);
  });

  test("returns the wire shape", async () => {
    await push("pro", [pref("shape", 4000, 75)]);
    const page = await pull("pro");
    const one = page.records.find((r) => r.id === "shape")!;
    expect(Object.keys(one).sort()).toEqual(["deletedAt", "id", "json", "kind", "updatedAt"]);
    expect(one).toMatchObject({ kind: "pref", updatedAt: 4000, deletedAt: null });
  });
});

describe("account cap", () => {
  test("a push over the cap stores what fits; existing rows can still be updated", async () => {
    await client.executeMultiple(`INSERT INTO "user" (id, name, email, tier) VALUES ('capped', 'c', 'c@test.id', 'founder');`);
    // Fill to cap - 2 with one statement of generated rows.
    await client.execute({
      sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
            INSERT INTO strength_record (user_id, kind, id, json, updated_at, deleted_at, server_at)
            SELECT 'capped', 'pref', 'fill' || i, '{"id":"fill' || i || '","restSec":90,"updatedAt":1,"deletedAt":null}', 1, NULL, i FROM n`,
      args: [STRENGTH_LIMITS.perUser - 2],
    });
    const result = await push("capped", [pref("fill1", 50, 20), pref("new1", 5), pref("new2", 5), pref("new3", 5)]);
    expect(result).toMatchObject({ status: "ok", stored: 3, skipped: 0 });
    expect(result.status === "ok" && result.rejected).toEqual([{ kind: "pref", id: "new3", reason: "full" }]);
    expect((await call(strengthRouter.status, undefined, as("capped"))).records).toBe(STRENGTH_LIMITS.perUser);
    const again = await push("capped", [pref("new4", 5), pref("fill2", 60, 10)]);
    expect(again).toMatchObject({ stored: 1 });
    expect(again.status === "ok" && again.rejected).toEqual([{ kind: "pref", id: "new4", reason: "full" }]);
  });
});

describe("strength.wipe and account deletion", () => {
  test("wipe deletes the caller's rows only and needs no Pro", async () => {
    await call(strengthRouter.wipe, undefined, as("free"));
    expect(await rows("free")).toHaveLength(0);
    expect((await rows("pro")).length).toBeGreaterThan(0);
    expect(await call(strengthRouter.wipe, undefined, as("pro"))).toEqual({ ok: true });
    expect(await rows("pro")).toHaveLength(0);
    expect((await rows("pro2")).length).toBeGreaterThan(0);
  });

  test("deleteAllUserData removes the strength rows", async () => {
    await deleteAllUserData(db, "pro2");
    expect(await rows("pro2")).toHaveLength(0);
  });
});
