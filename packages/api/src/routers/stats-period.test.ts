import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { ENERGY_NOTICE_BEFORE_MS } from "../lib/energy-notice";
import { jakartaToday, shiftDate } from "../lib/engine";
import { statsRouter } from "./stats";

// stats.periodProgress reads real rows: days logged, the deficit against the plan's TDEE, the weight trend.

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const old = ENERGY_NOTICE_BEFORE_MS - 86_400_000;
const today = jakartaToday();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('u', 'u', 'u@test.id', 'free', ${old}), ('bare', 'bare', 'b@test.id', 'free', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    VALUES ('u', 1990, 'male', 170, 90, 80, '2031-01-01', 'light');
`);
const rows: string[] = [];
for (let back = 1; back <= 10; back += 1) {
  const date = shiftDate(today, -back);
  rows.push(`('f${back}', 'u', '${date}', 'makan_siang', 'Nasi', 1500, 0, 0, 0, 'manual')`);
  rows.push(`('w${back}', 'u', '${date}', ${90 - (10 - back) * 0.1})`);
}
await client.executeMultiple(`
  INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, source) VALUES ${rows.filter((r) => r.startsWith("('f")).join(",")};
  INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ${rows.filter((r) => r.startsWith("('w")).join(",")};
`);

const db = drizzle(client) as unknown as Database;
const as = (id: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id, createdAt: new Date(old) } } } as unknown as Context,
});

test("a period reads logged days, a deficit against the plan's TDEE and the trend", async () => {
  const p = await call(statsRouter.periodProgress, { from: shiftDate(today, -13), to: today }, as("u"));
  expect(p).not.toBeNull();
  expect(p!.calendarDays).toBe(14);
  // days -13..-1 are finished (13), today has nothing
  expect(p!.judgedDays).toBe(13);
  expect(p!.loggedDays).toBe(10);
  expect(p!.streakDays).toBeGreaterThanOrEqual(10);
  expect(p!.energy?.countedDays).toBe(10);
  expect(p!.energy?.eatenKcal).toBe(15000);
  // a 1990-born 170 cm man at 90 kg burns well above 1.500 kcal
  expect(p!.energy!.balanceKcal).toBeGreaterThan(0);
  expect(p!.weight?.direction).toBe("down");
  expect(p!.intake.bars.length).toBeGreaterThan(0);
});

test("without from, the period starts at the first weigh-in or food log", async () => {
  const p = await call(statsRouter.periodProgress, {}, as("u"));
  expect(p!.from).toBe(shiftDate(today, -10));
  expect(p!.to).toBe(today);
});

test("an account with no profile has no period", async () => {
  expect(await call(statsRouter.periodProgress, {}, as("bare"))).toBeNull();
});

test("from after to is rejected", async () => {
  await expect(call(statsRouter.periodProgress, { from: today, to: shiftDate(today, -1) }, as("u"))).rejects.toThrow();
});
