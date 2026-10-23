import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday } from "../lib/engine";
import { ENERGY_NOTICE_BEFORE_MS } from "../lib/energy-notice";
import { getDailyTotals } from "../lib/fit-data";
import { dayRouter } from "./day";
import { fitnessRouter } from "./fitness";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";

const { client, db } = await d1TestDb();

const today = jakartaToday();
const old = ENERGY_NOTICE_BEFORE_MS - 86_400_000;
const fresh = ENERGY_NOTICE_BEFORE_MS + 86_400_000;

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES
    ('manual', 'manual', 'manual@test.id', 'free', ${old}),
    ('off', 'off', 'off@test.id', 'free', ${old}),
    ('watch', 'watch', 'watch@test.id', 'free', ${old}),
    ('desk', 'desk', 'desk@test.id', 'free', ${old}),
    ('deskwork', 'deskwork', 'deskwork@test.id', 'free', ${old}),
    ('broken', 'broken', 'broken@test.id', 'free', ${old}),
    ('hc', 'hc', 'hc@test.id', 'free', ${old}),
    ('hc2', 'hc2', 'hc2@test.id', 'free', ${old}),
    ('gain', 'gain', 'gain@test.id', 'free', ${old}),
    ('mom', 'mom', 'mom@test.id', 'free', ${old}),
    ('newbie', 'newbie', 'newbie@test.id', 'free', ${fresh}),
    ('closed', 'closed', 'closed@test.id', 'free', ${old}),
    ('old1', 'old1', 'old1@test.id', 'free', ${old}),
    ('none', 'none', 'none@test.id', 'free', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1990, 'male', 170, 160, 150, '2031-01-01', 'light' FROM "user" WHERE id NOT IN ('gain', 'mom');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, goal, goal_start_kg)
    VALUES ('gain', 1990, 'male', 170, 60, 66, '2031-01-01', 'light', 'gain', 60);
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, maternal_mode, pregnancy_lmp, pregnancy_date_kind, pre_pregnancy_weight_kg)
    VALUES ('mom', 1995, 'female', 160, 60, 60, '2031-01-01', 'moderate', 'pregnant', '2026-05-01', 'hpht', 60);
`);

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
// a phone left on a desk: 40 steps, 10 kcal
await healthStore("desk", 40, 10);
await healthStore("deskwork", 40, 10);
await seedExercise("deskwork", [{ kcal: 200, source: "manual" }]);
await watchActive("broken", 9000);
await healthStore("broken", 15000, 0);
await healthStore("hc", 8000, 450);
await seedExercise("hc", [{ kcal: 120, source: "health_connect" }]);
await healthStore("hc2", 9000, 1200);
await watchActive("gain", 900);
await seedExercise("mom", [{ kcal: 400, source: "manual" }]);
await seedExercise("newbie", [{ kcal: 5000, source: "manual" }]);
await pref("closed", "dismissed.energyModel", true);
// the earlier notices' dismissals and the removed settings of an older build are ignored
await pref("old1", "dismissed.addBackNotice", true);
await pref("old1", "dismissed.addBackNotice2", true);
await pref("old1", "exercise.assumedActive", 300);
await pref("old1", "exercise.addBack.source", "workouts+steps");
await pref("old1", "exercise.addBack.stepThreshold", 3000);

describe("day.summary budget with counted activity above the factor", () => {
  // male 36, 170 cm, 160 kg, level light: bmr 2487.5, tdee 2487.5 x 1.375 = 3420, movement already in the factor 591
  test("nothing recorded: the budget is the plan's base, nothing added", async () => {
    const s = await summary("none");
    expect(s.targets!.exerciseKcal).toBe(0);
    expect(s.exerciseCredit).toMatchObject({ enabled: true, allDayKcal: null, countedKcal: 0, extraKcal: 0, includedKcal: 591 });
    expect(s.targets).toMatchObject({ bmr: 2488, level: "light", factor: 1.375, tdee: 3420, includedKcal: 591 });
    // base = TDEE less the deficit (250: the target date is far away)
    expect(s.targets!.eatKcal).toBe(3170);
  });

  test("a phone left on a desk (10 kcal, 40 steps) does not move the target", async () => {
    const s = await summary("desk");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: 10, activeKcal: 10, extraKcal: 0, countedKcal: 0 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal);
  });

  test("workouts outside the all-day total still count on a desk-phone day", async () => {
    const s = await summary("deskwork");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: 10, otherWorkoutKcal: 200, extraKcal: 200, countedKcal: 150 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 150);
  });

  test("manual and Strava rows count at 75% (rest rows excluded)", async () => {
    const s = await summary("manual");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ otherWorkoutKcal: 300, activeKcal: 300, extraKcal: 300, countedKcal: 225, pct: 75 });
    expect(s.targets!.exerciseKcal).toBe(225);
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 225);
  });

  test("the setting off: the budget is the plan again", async () => {
    const s = await summary("off");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ enabled: false, countedKcal: 0, activeKcal: 400 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal);
  });

  test("watch all-day energy counts only above the factor: watch workouts are inside it, manual rows add on top", async () => {
    const s = await summary("watch");
    const none = await summary("none");
    // all-day 700 - 591 included = 109, + 100 manual = 209, at 100%
    expect(s.exerciseCredit).toMatchObject({
      allDayKcal: 700,
      allDaySource: "joyofit",
      deviceWorkoutKcal: 400,
      otherWorkoutKcal: 100,
      activeKcal: 800,
      extraKcal: 209,
      countedKcal: 209,
    });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal + 209);
  });

  test("broken readings (9000 kcal from the watch, 0 active on 15 000 steps) add nothing", async () => {
    const s = await summary("broken");
    const none = await summary("none");
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: null, countedKcal: 0 });
    expect(s.targets!.eatKcal).toBe(none.targets!.eatKcal);
  });

  test("Health Connect / Apple Health all-day energy counts like the watch's, its workouts are inside it", async () => {
    const low = await summary("hc");
    expect(low.exerciseCredit).toMatchObject({ allDayKcal: 450, allDaySource: "health_connect", deviceWorkoutKcal: 120, activeKcal: 450, extraKcal: 0, countedKcal: 0 });
    const high = await summary("hc2");
    expect(high.exerciseCredit).toMatchObject({ allDayKcal: 1200, activeKcal: 1200, extraKcal: 609, countedKcal: 457 });
  });

  test("the cap holds", async () => {
    const s = await summary("newbie");
    expect(s.exerciseCredit).toMatchObject({ activeKcal: 5000, countedKcal: 1000, capped: true });
  });

  test("gain mode: the same rule raises the budget", async () => {
    const s = await summary("gain");
    const included = s.targets!.includedKcal;
    expect(s.targets!.gain).not.toBeNull();
    expect(included).toBe(353);
    expect(s.exerciseCredit!.countedKcal).toBe(Math.round((900 - included) * 0.75));
    expect(s.targets!.eatKcal).toBe(s.targets!.tdee + s.targets!.gain!.surplusKcal + s.exerciseCredit!.countedKcal);
  });

  test("Hamil: activity raises the target and the base is the unchanged AKG target (moderate keeps 1.45)", async () => {
    const s = await summary("mom");
    expect(s.targets!.maternal).not.toBeNull();
    expect(s.targets!.factor).toBe(1.45);
    expect(s.targets!.exerciseKcal).toBe(300);
    expect(s.targets!.eatKcal).toBe(s.targets!.maternal!.baseKcal + s.targets!.maternal!.addKcal + 300);
  });
});

describe("day.summary energy notice", () => {
  test("an account made before the change sees the notice with old -> new, until the dismissal is stored", async () => {
    const s = await summary("manual");
    // old: BMR less the deficit = round5(2487.5 - 250); new: TDEE less it = round5(3420.3 - 250)
    expect(s.energyNotice).toEqual({ oldKcal: 2240, newKcal: 3170, level: "light", factor: 1.375, bmrKcal: 2488, tdeeKcal: 3420 });
    expect((await summary("closed")).energyNotice).toBeNull();
  });

  test("it shows the base target, not the day's activity", async () => {
    const withActivity = await summary("watch");
    expect(withActivity.energyNotice!.newKcal).toBe(withActivity.targets!.eatKcal - withActivity.targets!.exerciseKcal);
  });

  test("gain: both numbers carry the surplus; Hamil: the target did not change", async () => {
    const gain = (await summary("gain")).energyNotice!;
    expect(gain.newKcal - gain.oldKcal).toBe(2045 - 1490);
    const mom = (await summary("mom")).energyNotice!;
    expect(mom.oldKcal).toBe(mom.newKcal);
  });

  test("the earlier notices' dismissals do not hide it, and removed settings are ignored", async () => {
    const s = await summary("old1");
    expect(s.energyNotice).not.toBeNull();
    expect(s.exerciseCredit).toMatchObject({ pct: 75, cap: 1000 });
  });

  test("an account made after the change never sees it", async () => {
    expect((await summary("newbie")).energyNotice).toBeNull();
  });
});

describe("getDailyTotals uses the same rule (Strava rows excluded)", () => {
  test("remaining includes the activity above the factor and reports it", async () => {
    await client.execute(
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES ('f1', 'manual', '${today}', 'sarapan', 'x', 500), ('f2', 'off', '${today}', 'sarapan', 'x', 500), ('f3', 'watch', '${today}', 'sarapan', 'x', 500), ('f4', 'deskwork', '${today}', 'sarapan', 'x', 500)`,
    );
    const manual = await getDailyTotals(db, "manual", today, today, DEFAULT_DAY_ZONE);
    const off = await getDailyTotals(db, "off", today, today, DEFAULT_DAY_ZONE);
    const watch = await getDailyTotals(db, "watch", today, today, DEFAULT_DAY_ZONE);
    const deskwork = await getDailyTotals(db, "deskwork", today, today, DEFAULT_DAY_ZONE);
    // manual: 200 manual (Strava's 100 never reaches the MCP) * 0.75
    expect(manual.days[0]).toMatchObject({ exerciseKcal: 200, activeKcal: 200, exerciseAddedKcal: 150 });
    expect(manual.days[0]!.remainingKcal).toBe(manual.targets!.eatKcal + 150 - 500);
    expect(off.days[0]).toMatchObject({ exerciseAddedKcal: 0 });
    expect(off.days[0]!.remainingKcal).toBe(off.targets!.eatKcal - 500);
    expect(watch.days[0]).toMatchObject({ activeKcal: 800, activeSource: "joyofit", exerciseAddedKcal: 209 });
    expect(deskwork.days[0]).toMatchObject({ activeSource: "health_connect", exerciseAddedKcal: 150 });
    expect(deskwork.days[0]!.remainingKcal).toBe(deskwork.targets!.eatKcal + 150 - 500);
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
