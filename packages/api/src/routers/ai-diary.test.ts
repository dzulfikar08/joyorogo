import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { shiftDate } from "../lib/engine";
import { aiRouter } from "./ai";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('u1', 'u1', 'u1@test.id', 'free'),
    ('u2', 'u2', 'u2@test.id', 'free');
  INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, fiber, source, photo_id, scan_id) VALUES
    ('a1', 'u1', '2026-10-20', 'sarapan', 'Nasi uduk', 400, 10, 60, 12, 2, 'manual', NULL, NULL),
    ('a2', 'u1', '2026-10-20', 'sarapan', 'Roti (quick-log)', 100, NULL, NULL, NULL, NULL, 'manual', NULL, NULL),
    ('a3', 'u1', '2026-10-20', 'snack', 'Pisang', 50.4, 5, 10, NULL, NULL, 'ai', 'photo-secret', 'scan-secret'),
    ('b1', 'u1', '2026-10-21', 'makan_siang', 'Kopi susu', 120, NULL, NULL, NULL, NULL, 'manual', NULL, NULL),
    ('c1', 'u1', '2026-10-22', 'makan_malam', 'Tempe', 200, 14.25, 8, 11, 3.5, 'manual', NULL, NULL),
    ('o1', 'u1', '2026-10-01', 'sarapan', 'Out of range', 999, 99, 99, 99, 99, 'manual', NULL, NULL),
    ('x1', 'u2', '2026-10-20', 'sarapan', 'Someone else', 777, 77, 77, 77, 77, 'manual', NULL, NULL);
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

describe("ai.diaryRange", () => {
  test("one row per logged day for the caller only: kcal, macro sums over the rows that have them, meals, items", async () => {
    const out = await call(aiRouter.diaryRange, { from: "2026-10-19", to: "2026-10-22" }, as("u1"));
    expect(out.days).toEqual([
      {
        date: "2026-10-20",
        kcal: 550,
        protein: 15,
        carbs: 70,
        fat: 12,
        fiber: 2,
        meals: 2,
        items: 3,
        rowsWith: { protein: 2, carbs: 2, fat: 1, fiber: 1 },
      },
      {
        // nothing but a quick-log row: kcal counts, every macro is null (not 0)
        date: "2026-10-21",
        kcal: 120,
        protein: null,
        carbs: null,
        fat: null,
        fiber: null,
        meals: 1,
        items: 1,
        rowsWith: { protein: 0, carbs: 0, fat: 0, fiber: 0 },
      },
      {
        date: "2026-10-22",
        kcal: 200,
        protein: 14.3,
        carbs: 8,
        fat: 11,
        fiber: 3.5,
        meals: 1,
        items: 1,
        rowsWith: { protein: 1, carbs: 1, fat: 1, fiber: 1 },
      },
    ]);
  });

  test("a day with no rows is absent; another user's rows are never counted", async () => {
    const out = await call(aiRouter.diaryRange, { from: "2026-10-19", to: "2026-10-20" }, as("u1"));
    expect(out.days.map((d) => d.date)).toEqual(["2026-10-20"]);
    expect(out.days[0]?.kcal).toBe(550);
    const other = await call(aiRouter.diaryRange, { from: "2026-10-19", to: "2026-10-22" }, as("u2"));
    expect(other.days.map((d) => [d.date, d.kcal])).toEqual([["2026-10-20", 777]]);
    const empty = await call(aiRouter.diaryRange, { from: "2026-11-01", to: "2026-11-05" }, as("u1"));
    expect(empty.days).toEqual([]);
  });

  test("no names, ids or photo fields in the output", async () => {
    const out = await call(aiRouter.diaryRange, { from: "2026-10-01", to: "2026-10-22" }, as("u1"));
    const json = JSON.stringify(out);
    for (const word of ["Nasi uduk", "Roti", "photo-secret", "scan-secret", "photoId", "scanId", "name", "userId", "u1"]) {
      expect(json).not.toContain(word);
    }
    expect(Object.keys(out.days[0] ?? {}).sort()).toEqual(["carbs", "date", "fat", "fiber", "items", "kcal", "meals", "protein", "rowsWith"]);
  });

  test("the range is bounded: from after to and more than 90 days are rejected, exactly 90 days is fine", async () => {
    const to = "2026-10-22";
    await expect(call(aiRouter.diaryRange, { from: to, to: shiftDate(to, -1) }, as("u1"))).rejects.toThrow();
    await expect(call(aiRouter.diaryRange, { from: shiftDate(to, -90), to }, as("u1"))).rejects.toThrow();
    await expect(call(aiRouter.diaryRange, { from: "yesterday", to }, as("u1"))).rejects.toThrow();
    const ok = await call(aiRouter.diaryRange, { from: shiftDate(to, -89), to }, as("u1"));
    expect(ok.days.length).toBeGreaterThan(0);
  });

  test("rows come back oldest first", async () => {
    const out = await call(aiRouter.diaryRange, { from: "2026-10-01", to: "2026-10-22" }, as("u1"));
    expect(out.days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-20", "2026-10-21", "2026-10-22"]);
  });
});
