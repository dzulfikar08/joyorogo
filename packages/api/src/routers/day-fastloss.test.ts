import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { dayRouter } from "./day";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const today = jakartaToday();

// calm: 0.3 kg a week; fast: 1 kg a week (about 1.3% of 76 kg); gain / bf: the same fast fall under a plan that must
// stay silent; low: steady weight but far too little food.
const USERS = [
  { id: "calm", goal: "lose", maternal: "none", perWeek: 0.3 },
  { id: "fast", goal: "lose", maternal: "none", perWeek: 1 },
  { id: "gain", goal: "gain", maternal: "none", perWeek: 1 },
  { id: "bf", goal: "lose", maternal: "breastfeeding", perWeek: 1 },
  { id: "low", goal: "lose", maternal: "none", perWeek: 0 },
] as const;

for (const u of USERS) {
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, tier) VALUES (?, ?, ?, 'free')`,
    args: [u.id, u.id, `${u.id}@test.id`],
  });
  await client.execute({
    sql: `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, goal, maternal_mode, baby_birth_date, breastfeeding_type)
          VALUES (?, 1990, 'male', 170, 80, ?, '2027-12-01', 'light', ?, ?, ?, ?)`,
    args: [
      u.id,
      u.goal === "gain" ? 90 : 70,
      u.goal,
      u.maternal,
      u.maternal === "breastfeeding" ? shiftDate(today, -120) : null,
      u.maternal === "breastfeeding" ? "exclusive" : null,
    ],
  });
  const rows: string[] = [];
  for (let ago = 29; ago >= 0; ago--) {
    const kg = Math.round((80 - (u.perWeek / 7) * (29 - ago)) * 10) / 10;
    rows.push(`('${u.id}-w${ago}', '${u.id}', '${shiftDate(today, -ago)}', ${kg})`);
  }
  await client.execute(`INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ${rows.join(",")}`);
}

// "low" and "bf" eat 1000 kcal on 4 fully logged days: far under a male 170 cm BMR of about 1500.
for (const id of ["low", "bf"]) {
  const rows: string[] = [];
  for (const back of [1, 2, 3, 4]) {
    const date = shiftDate(today, -back);
    rows.push(
      `('${id}-${back}-a', '${id}', '${date}', 'sarapan', 'Roti', 300)`,
      `('${id}-${back}-b', '${id}', '${date}', 'makan_siang', 'Nasi', 400)`,
      `('${id}-${back}-c', '${id}', '${date}', 'makan_malam', 'Sayur', 300)`,
    );
  }
  await client.execute(`INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES ${rows.join(",")}`);
}

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: {
    db,
    env: {},
    waitUntil: () => {},
    session: { user: { id: userId, createdAt: new Date() } },
  } as unknown as Context,
});
const summary = (userId: string, date?: string) => call(dayRouter.summary, { date }, as(userId));

describe("day.summary fastLoss", () => {
  test("a calm trend has no note", async () => {
    expect((await summary("calm")).fastLoss).toBeNull();
  });

  test("a fast smoothed fall carries the weight reason and the percent", async () => {
    const note = (await summary("fast")).fastLoss;
    expect(note?.reasons).toEqual(["weight"]);
    expect(note?.weeklyPct).toBeGreaterThanOrEqual(1);
  });

  test("steady weight but 4 fully logged days far under BMR carries the intake reason", async () => {
    const note = (await summary("low")).fastLoss;
    expect(note?.reasons).toEqual(["intake"]);
    expect(note?.lowIntakeDays).toBe(4);
  });

  test("a gain plan and a breastfeeding profile get nothing, whatever the data says", async () => {
    expect((await summary("gain")).fastLoss).toBeNull();
    expect((await summary("bf")).fastLoss).toBeNull();
  });

  test("a browsed past day never carries the note", async () => {
    expect((await summary("fast", shiftDate(today, -1))).fastLoss).toBeNull();
  });
});
