import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { exerciseRouter } from "./exercise";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id'), ('b', 'b', 'b@test.id');`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

async function logs(userId: string) {
  const result = await client.execute({
    // Insertion order: rows written in the same millisecond share created_at, and the id is a random UUID.
    sql: "SELECT date, type, duration_min, kcal, source, external_id FROM exercise_log WHERE user_id = ? ORDER BY created_at, rowid",
    args: [userId],
  });
  const raw: Record<string, unknown>[] = result.rows;
  return raw;
}

const watch = (start: number, over: Record<string, unknown> = {}) => ({
  externalId: `watch:${start}`,
  date: "2026-10-18",
  name: "Jalan",
  durationMin: 30,
  kcal: 120,
  type: "jalan_cepat",
  ...over,
});
const hc = (id: string, over: Record<string, unknown> = {}) => ({
  date: "2026-10-18",
  type: "Walk",
  name: "Jalan",
  durationMin: 30,
  kcal: 118,
  source: "health_connect" as const,
  externalId: id,
  ...over,
});

describe("a watch workout that reaches the diary from JoyoFit and from Health Connect", () => {
  test("JoyoFit first: the import is absorbed by the watch row and stored nowhere", async () => {
    await call(exerciseRouter.upsertJoyofit, watch(1_000), as("a"));
    const returned = await call(exerciseRouter.add, hc("hc-1"), as("a"));
    expect(returned).toMatchObject({ source: "joyofit", externalId: "watch:1000" });
    const rows = await logs("a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "joyofit", external_id: "watch:1000", kcal: 120 });
    // The import is retried at every sync and stays absorbed.
    await call(exerciseRouter.add, hc("hc-1"), as("a"));
    expect(await logs("a")).toHaveLength(1);
  });

  test("an absorbed import is not stored, so a like import is told apart from its retry only by the free watch rows left", async () => {
    await call(exerciseRouter.upsertJoyofit, watch(1_500), as("a"));
    await call(exerciseRouter.add, hc("hc-2"), as("a"));
    expect((await logs("a")).map((r) => r.source)).toEqual(["joyofit", "joyofit"]);
  });

  test("a watch row sent again updates itself (kcal) and never absorbs", async () => {
    await call(exerciseRouter.upsertJoyofit, watch(1_000, { kcal: 140 }), as("a"));
    const rows = await logs("a");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source === "joyofit")).toMatchObject({ kcal: 140 });
  });

  test("Health Connect first: the watch row is absorbed by the import, and again when sent twice", async () => {
    await call(exerciseRouter.add, hc("hc-b1", { date: "2026-10-17" }), as("b"));
    await call(exerciseRouter.upsertJoyofit, watch(2_000, { date: "2026-10-17" }), as("b"));
    await call(exerciseRouter.upsertJoyofit, watch(2_000, { date: "2026-10-17" }), as("b"));
    const rows = await logs("b");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "health_connect" });
  });

  test("another kind or length is not absorbed; strength rows never are", async () => {
    await call(exerciseRouter.upsertJoyofit, watch(3_000, { date: "2026-10-17", type: "lari", name: "Lari" }), as("b"));
    await call(exerciseRouter.upsertJoyofit, watch(3_100, { date: "2026-10-17", durationMin: 50 }), as("b"));
    await call(
      exerciseRouter.upsertJoyofit,
      { externalId: "strength:x", date: "2026-10-17", name: "Strength", durationMin: 30, kcal: 100, type: "jalan_cepat" },
      as("b"),
    );
    const rows = await logs("b");
    expect(rows.map((r) => r.external_id)).toEqual(["hc-b1", "watch:3000", "watch:3100", "strength:x"]);
  });

  test("manual rows are never absorbed and never absorb", async () => {
    await call(exerciseRouter.add, { name: "Manual", kcal: 90, type: "Walk", durationMin: 30, date: "2026-10-16" }, as("b"));
    await call(exerciseRouter.upsertJoyofit, watch(4_000, { date: "2026-10-16" }), as("b"));
    expect((await logs("b")).filter((r) => r.date === "2026-10-16").map((r) => r.source)).toEqual(["manual", "joyofit"]);
  });
});
