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
import { fitnessRouter } from "./fitness";

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
    ('manual', 'manual', 'manual@test.id', 'free', ${old}),
    ('off', 'off', 'off@test.id', 'free', ${old}),
    ('watch', 'watch', 'watch@test.id', 'free', ${old}),
    ('assume', 'assume', 'assume@test.id', 'free', ${old}),
    ('broken', 'broken', 'broken@test.id', 'free', ${old}),
    ('hc', 'hc', 'hc@test.id', 'free', ${old}),
    ('gain', 'gain', 'gain@test.id', 'free', ${old}),
    ('mom', 'mom', 'mom@test.id', 'free', ${old}),
    ('newbie', 'newbie', 'newbie@test.id', 'free', ${fresh}),
    ('closed', 'closed', 'closed@test.id', 'free', ${old}),
    ('old1', 'old1', 'old1@test.id', 'free', ${old}),
    ('none', 'none', 'none@test.id', 'free', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 170, 160, 150, '2031-01-01', 'mid' FROM "user" WHERE id NOT IN ('gain', 'mom');
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

const seedExercise = (userId: string, rows: { kcal: number; source: string }[]) =>
  client.executeMultiple(
    rows
      .map(
        (row, i) =>
          `INSERT INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source) VALUES ('${userId}-${i}', '${userId}', '${today}', NULL, 'x', NULL, ${row.kcal}, '${row.source}');`,
      )
      .join("\n"),
  );

const watchActive = (userId: string, activeKcal: number) =>
  client.execute({
    sql: `INSERT INTO fitness_score (id, user_id, date, active_kcal, source) VALUES (?, ?, ?, ?, 'joyofit')`,
    args: [`fs-${userId}`, userId, today, activeKcal],
  });

const healthStore = (userId: string, steps: number, activeCalories: number, source = "health_connect") =>
  client.execute({
    sql: `INSERT INTO daily_activity (id, user_id, date, steps, active_calories, source) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [`da-${userId}`, userId, today, steps, activeCalories, source],
  });

const pref = (userId: string, id: string, value: unknown) =>
  client.execute({
    sql: `INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, deleted_at, rank, server_at) VALUES (?, 'rogo', 'pref', ?, ?, 1, NULL, 0, 1)`,
    args: [userId, id, JSON.stringify({ value })],
  });

const summary = (userId: string) => call(dayRouter.summary, { date: today }, as(userId));

await seedExercise("manual", [
  { kcal: 200, source: "manual" },
  { kcal: 100, source: "strava" },
  { kcal: 400, source: "rest" },
]);
await seedExercise("off", [{ kcal: 400, source: "manual" }]);
await pref("off", "exercise.addBack.enabled", false);
// 700 kcal all day, of which two watch workouts (300 + 100) and a manual 100 the watch does not know about
await watchActive("watch", 700);
await seedExercise("watch", [
  { kcal: 300, source: "joyofit" },
  { kcal: 100, source: "joyofit" },
  { kcal: 100, source: "manual" },
]);
await pref("watch", "exercise.addBack.pct", 100);
await seedExercise("assume", [{ kcal: 200, source: "manual" }]);
await pref("assume", "exercise.assumedActive", 300);
await watchActive("broken", 9000);
await healthStore("broken", 15000, 0);
await pref("broken", "exercise.assumedActive", 150);
await healthStore("hc", 8000, 450);
await seedExercise("hc", [{ kcal: 120, source: "health_connect" }]);
await watchActive("gain", 400);
await seedExercise("mom", [{ kcal: 400, source: "manual" }]);
await seedExercise("newbie", [{ kcal: 5000, source: "manual" }]);
await pref("closed", "dismissed.addBackNotice2", true);
// the first notice's dismissal and the removed step settings of an older build are ignored
await pref("old1", "dismissed.addBackNotice", true);
await pref("old1", "exercise.addBack.source", "workouts+steps");
await pref("old1", "exercise.addBack.stepThreshold", 3000);

describe("day.summary budget with counted activity", () => {
  test("nothing recorded: the budget is the plan's base, nothing added", async () => {
    const s = await summary("none");
    expect(s.targets!.exerciseKcal).toBe(0);
    expect(s.targets!.assumedKcal).toBe(0);
    expect(s.exerciseCredit).toMatchObject({ enabled: true, allDayKcal: null, countedKcal: 0, assumedKcal: 0 });
    // base = BMR less the deficit, no assumed movement: bmr 2487.5 at 160 kg, age 36
    expect(s.targets!.tdee).toBe(2488);
  });

  test("manual and Strava rows count at 75% (rest rows excluded)", async () => {
    const s = await summary("manual");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ otherWorkoutKcal: 300, activeKcal: 300, countedKcal: 225, pct: 75 });
    expect(s.targets!.exerciseKcal).toBe(225);
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 225);
  });

  test("the setting off: the budget is the plan again", async () => {
    const s = await summary("off");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ enabled: false, countedKcal: 0, activeKcal: 400 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal);
  });

  test("watch all-day energy is the base of the activity: watch workouts are inside it, manual rows add on top", async () => {
    const s = await summary("watch");
    const none = await summary("none");
    // max(700, 400) + 100 manual = 800, at 100%
    expect(s.exerciseCredit).toMatchObject({
      allDayKcal: 700,
      allDaySource: "joyofit",
      deviceWorkoutKcal: 400,
      otherWorkoutKcal: 100,
      activeKcal: 800,
      countedKcal: 800,
    });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 800);
  });

  test("no all-day data: the assumed activity is added to the base, not multiplied by pct", async () => {
    const s = await summary("assume");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: null, assumedKcal: 300, countedKcal: 150 });
    expect(s.targets).toMatchObject({ assumedKcal: 300, exerciseKcal: 150 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 300 + 150);
  });

  test("broken readings (9000 kcal from the watch, 0 active on 15 000 steps) fall back to the assumption", async () => {
    const s = await summary("broken");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: null, assumedKcal: 150, countedKcal: 0 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 150);
  });

  test("Health Connect / Apple Health all-day energy counts like the watch's, its workouts are inside it", async () => {
    const s = await summary("hc");
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: 450, allDaySource: "health_connect", deviceWorkoutKcal: 120, activeKcal: 450 });
  });

  test("the cap holds", async () => {
    const s = await summary("newbie");
    expect(s.exerciseCredit).toMatchObject({ activeKcal: 5000, countedKcal: 1000, capped: true });
  });

  test("gain mode: the same rule raises the budget", async () => {
    const s = await summary("gain");
    expect(s.targets!.gain).not.toBeNull();
    expect(s.exerciseCredit!.countedKcal).toBe(300);
    expect(s.targets!.eatKcal).toBe(s.targets!.tdee + s.targets!.gain!.surplusKcal + 300);
  });

  test("Hamil: activity raises the target and the base is the unchanged AKG target", async () => {
    const s = await summary("mom");
    expect(s.targets!.maternal).not.toBeNull();
    expect(s.targets!.exerciseKcal).toBe(300);
    expect(s.targets!.eatKcal).toBe(s.targets!.maternal!.baseKcal + s.targets!.maternal!.addKcal + 300);
  });
});

describe("day.summary notice gating", () => {
  test("an account made before the change sees the notice, until the dismissal is stored", async () => {
    expect((await summary("manual")).addBackNotice).toBe(true);
    expect((await summary("closed")).addBackNotice).toBe(false);
  });

  test("the first notice's dismissal does not hide the new one, and removed settings are ignored", async () => {
    const s = await summary("old1");
    expect(s.addBackNotice).toBe(true);
    expect(s.exerciseCredit).toMatchObject({ pct: 75, cap: 1000 });
  });

  test("an account made after the change never sees it", async () => {
    expect((await summary("newbie")).addBackNotice).toBe(false);
  });
});

describe("getDailyTotals uses the same rule (Strava rows excluded)", () => {
  test("remaining includes the activity and reports it", async () => {
    await client.execute(
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES ('f1', 'manual', '${today}', 'sarapan', 'x', 500), ('f2', 'off', '${today}', 'sarapan', 'x', 500), ('f3', 'watch', '${today}', 'sarapan', 'x', 500), ('f4', 'assume', '${today}', 'sarapan', 'x', 500)`,
    );
    const manual = await getDailyTotals(db, "manual", today, today);
    const off = await getDailyTotals(db, "off", today, today);
    const watch = await getDailyTotals(db, "watch", today, today);
    const assume = await getDailyTotals(db, "assume", today, today);
    // manual: 200 manual (Strava's 100 never reaches the MCP) * 0.75
    expect(manual.days[0]).toMatchObject({ exerciseKcal: 200, activeKcal: 200, exerciseAddedKcal: 150, assumedKcal: 0 });
    expect(manual.days[0]!.remainingKcal).toBe(manual.targets!.eatKcal + 150 - 500);
    expect(off.days[0]).toMatchObject({ exerciseAddedKcal: 0 });
    expect(off.days[0]!.remainingKcal).toBe(off.targets!.eatKcal - 500);
    expect(watch.days[0]).toMatchObject({ activeKcal: 800, activeSource: "joyofit", exerciseAddedKcal: 800 });
    expect(assume.days[0]).toMatchObject({ assumedKcal: 300, exerciseAddedKcal: 150 });
    expect(assume.days[0]!.remainingKcal).toBe(assume.targets!.eatKcal + 300 + 150 - 500);
    expect(manual.exerciseAddBack.pct).toBe(75);
    expect(off.exerciseAddBack.enabled).toBe(false);
  });
});

describe("fitness.upsertScores activeKcal", () => {
  test("a day's total only grows and a missing value keeps the stored one", async () => {
    const as2 = as("none");
    const push = (activeKcal?: number) =>
      call(fitnessRouter.upsertScores, { days: [{ date: today, ...(activeKcal === undefined ? { strain: 5 } : { activeKcal }) }] } as never, as2);
    const read = async () =>
      Number((await client.execute({ sql: `SELECT active_kcal AS k FROM fitness_score WHERE user_id = 'none' AND date = ?`, args: [today] })).rows[0]?.k);
    await push(500);
    expect(await read()).toBe(500);
    await push(300);
    expect(await read()).toBe(500);
    await push();
    expect(await read()).toBe(500);
    await push(650);
    expect(await read()).toBe(650);
  });
});
