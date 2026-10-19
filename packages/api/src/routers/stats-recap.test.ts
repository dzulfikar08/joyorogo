import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { ADD_BACK_NOTICE_BEFORE_MS } from "../lib/exercise-credit";
import { jakartaToday, shiftDate } from "../lib/engine";
import { weekStartOf } from "../lib/recap";
import { activityRouter } from "./activity";
import { dayRouter } from "./day";
import { statsRouter } from "./stats";

// The weekly recap judges each day against the budget Beranda showed for it (base plus that day's activity), not the
// bare base: a day with a workout was reported "over" while Beranda said there was room left.

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const old = ADD_BACK_NOTICE_BEFORE_MS - 86_400_000;
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('u', 'u', 'u@test.id', 'founder', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    VALUES ('u', 1990, 'male', 170, 108, 90, '2031-01-01', 'mid');
`);

const db = drizzle(client) as unknown as Database;
const as = {
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "u", createdAt: new Date(old) } } } as unknown as Context,
};

test("a day with all-day activity is judged against the same budget day.summary gives it", async () => {
  const day = shiftDate(jakartaToday(), -1);
  const quiet = shiftDate(day, -1);
  await call(activityRouter.upsert, { date: day, steps: 9000, distanceMeters: 6000, activeCalories: 400, exerciseMinutes: 60, source: "health_connect" }, as);

  const recap = await call(statsRouter.weekRecap, { weekStart: weekStartOf(day) }, as);
  const busy = await call(dayRouter.summary, { date: day }, as);
  const recapDay = recap!.days.find((d) => d.date === day)!;
  expect(recapDay.targetKcal).toBe(Math.round(busy.targets!.eatKcal));
  expect(recapDay.targetKcal).toBeGreaterThan(recap!.days.find((d) => d.date === quiet)?.targetKcal ?? 0);
});
