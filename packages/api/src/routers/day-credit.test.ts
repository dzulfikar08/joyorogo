import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { jakartaToday } from "../lib/engine";
import { ADD_BACK_NOTICE_BEFORE_MS } from "../lib/exercise-credit";
import { getDailyTotals } from "../lib/fit-data";
import { dayRouter } from "./day";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const today = jakartaToday();
const old = ADD_BACK_NOTICE_BEFORE_MS - 86_400_000;
const fresh = ADD_BACK_NOTICE_BEFORE_MS + 86_400_000;

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES
    ('loss', 'loss', 'loss@test.id', 'free', ${old}),
    ('off', 'off', 'off@test.id', 'free', ${old}),
    ('steps', 'steps', 'steps@test.id', 'free', ${old}),
    ('gain', 'gain', 'gain@test.id', 'free', ${old}),
    ('mom', 'mom', 'mom@test.id', 'free', ${old}),
    ('newbie', 'newbie', 'newbie@test.id', 'free', ${fresh}),
    ('closed', 'closed', 'closed@test.id', 'free', ${old}),
    ('none', 'none', 'none@test.id', 'free', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 170, 130, 120, '2031-01-01', 'mid' FROM "user" WHERE id NOT IN ('gain', 'mom');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, goal, goal_start_kg)
    VALUES ('gain', 1990, 'male', 170, 60, 66, '2031-01-01', 'mid', 'gain', 60);
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, maternal_mode, pregnancy_lmp, pregnancy_date_kind, pre_pregnancy_weight_kg)
    VALUES ('mom', 1995, 'female', 160, 60, 60, '2031-01-01', 'high', 'pregnant', '2026-05-01', 'hpht', 60);
`);

const db = drizzle(client) as unknown as Database;
const createdAt: Record<string, number> = { newbie: fresh };
const as = (userId: string) => ({
  context: {
    db,
    env: {},
    waitUntil: () => {},
    session: { user: { id: userId, createdAt: new Date(createdAt[userId] ?? old) } },
  } as unknown as Context,
});

const seedExercise = (userId: string, rows: { kcal: number; source: string; type?: string; min?: number }[]) =>
  client.executeMultiple(
    rows
      .map(
        (row, i) =>
          `INSERT INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source) VALUES ('${userId}-${i}', '${userId}', '${today}', ${row.type ? `'${row.type}'` : "NULL"}, 'x', ${row.min ?? "NULL"}, ${row.kcal}, '${row.source}');`,
      )
      .join("\n"),
  );

const pref = (userId: string, id: string, value: unknown) =>
  client.execute({
    sql: `INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, deleted_at, rank, server_at) VALUES (?, 'rogo', 'pref', ?, ?, 1, NULL, 0, 1)`,
    args: [userId, id, JSON.stringify({ value })],
  });

const summary = (userId: string) => call(dayRouter.summary, { date: today }, as(userId));

await seedExercise("loss", [
  { kcal: 200, source: "manual" },
  { kcal: 100, source: "joyofit" },
  { kcal: 100, source: "health_connect" },
  { kcal: 50, source: "strava" },
  { kcal: 400, source: "rest" },
]);
await seedExercise("off", [{ kcal: 400, source: "manual" }]);
await pref("off", "exercise.addBack.enabled", false);
await seedExercise("steps", [{ kcal: 250, source: "apple_health", type: "jalan_cepat", min: 60 }]);
await pref("steps", "exercise.addBack.source", "workouts+steps");
await pref("steps", "exercise.addBack.pct", 100);
await client.execute(`INSERT INTO daily_activity (id, user_id, date, steps) VALUES ('s1', 'steps', '${today}', 12000)`);
await seedExercise("gain", [{ kcal: 400, source: "joyofit" }]);
await seedExercise("mom", [{ kcal: 400, source: "manual" }]);
await seedExercise("newbie", [{ kcal: 5000, source: "manual" }]);
await pref("closed", "dismissed.addBackNotice", true);

describe("day.summary budget with counted exercise", () => {
  test("no exercise: the budget is the plan's base, nothing added", async () => {
    const s = await summary("none");
    expect(s.targets!.exerciseKcal).toBe(0);
    expect(s.exerciseCredit!.countedKcal).toBe(0);
    expect(s.exerciseCredit!.enabled).toBe(true);
  });

  test("the default counts 75% of every recorded source (rest rows excluded) into targets.eatKcal", async () => {
    const s = await summary("loss");
    const none = await summary("none");
    expect(s.burnedKcal).toBe(450);
    expect(s.exerciseCredit).toMatchObject({ workoutKcal: 450, countedKcal: 338, pct: 75, cap: 1000 });
    expect(s.targets!.exerciseKcal).toBe(338);
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 338);
  });

  test("the setting off: the budget is the plan again", async () => {
    const s = await summary("off");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ enabled: false, countedKcal: 0, workoutKcal: 400 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal);
  });

  test("pct, steps source and no double counting of a recorded walk", async () => {
    const s = await summary("steps");
    // 60 min brisk walk = 6900 steps inside 12000: 12000 - 6900 - 5000 = 100 steps over, at 0.0005 * 130 kg
    expect(s.exerciseCredit).toMatchObject({ source: "workouts+steps", pct: 100, countedSteps: 100 });
    expect(s.exerciseCredit!.countedKcal).toBe(250 + s.exerciseCredit!.stepKcal);
  });

  test("the cap holds", async () => {
    const s = await summary("newbie");
    expect(s.exerciseCredit).toMatchObject({ workoutKcal: 5000, countedKcal: 1000, capped: true });
  });

  test("gain mode: the same rule raises the budget", async () => {
    const s = await summary("gain");
    expect(s.targets!.gain).not.toBeNull();
    expect(s.exerciseCredit!.countedKcal).toBe(300);
    expect(s.targets!.eatKcal).toBe(s.targets!.tdee + s.targets!.gain!.surplusKcal + 300);
  });

  test("Hamil: exercise raises the target and the base is the unchanged AKG target", async () => {
    const s = await summary("mom");
    expect(s.targets!.maternal).not.toBeNull();
    expect(s.targets!.exerciseKcal).toBe(300);
    expect(s.targets!.eatKcal).toBe(s.targets!.maternal!.baseKcal + s.targets!.maternal!.addKcal + 300);
  });
});

describe("day.summary notice gating", () => {
  test("an account made before the change sees the notice, until the dismissal is stored", async () => {
    expect((await summary("loss")).addBackNotice).toBe(true);
    expect((await summary("closed")).addBackNotice).toBe(false);
  });

  test("an account made after the change never sees it", async () => {
    expect((await summary("newbie")).addBackNotice).toBe(false);
  });
});

describe("getDailyTotals uses the same rule (Strava rows excluded)", () => {
  test("remaining includes the counted exercise and reports it", async () => {
    await client.execute(
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES ('f1', 'loss', '${today}', 'sarapan', 'x', 500), ('f2', 'off', '${today}', 'sarapan', 'x', 500)`,
    );
    const loss = await getDailyTotals(db, "loss", today, today);
    const off = await getDailyTotals(db, "off", today, today);
    // loss: manual 200 + joyofit 100 + health_connect 100 = 400 (Strava's 50 never reaches the MCP) * 0.75
    expect(loss.days[0]).toMatchObject({ exerciseKcal: 400, exerciseAddedKcal: 300 });
    expect(loss.days[0]!.remainingKcal).toBe(loss.targets!.eatKcal + 300 - 500);
    expect(off.days[0]).toMatchObject({ exerciseAddedKcal: 0 });
    expect(off.days[0]!.remainingKcal).toBe(off.targets!.eatKcal - 500);
    expect(loss.exerciseAddBack.pct).toBe(75);
    expect(off.exerciseAddBack.enabled).toBe(false);
  });
});
