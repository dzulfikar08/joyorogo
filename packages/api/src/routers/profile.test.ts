import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { profileRouter } from "./profile";

const { client, db } = await d1TestDb();

const today = jakartaToday();
const lapsedDate = shiftDate(today, -10);

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('cut', 'cut', 'cut@test.id', 'founder'),
    ('lapsed', 'lapsed', 'lapsed@test.id', 'founder'),
    ('steps', 'steps', 'steps@test.id', 'founder'),
    ('fresh', 'fresh', 'fresh@test.id', 'founder'),
    ('cal', 'cal', 'cal@test.id', 'founder');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level) VALUES
    ('cut', 1990, 'male', 170, 160, 150, '${shiftDate(today, 120)}', 'light'),
    ('lapsed', 1990, 'male', 170, 80, 70, '${lapsedDate}', 'light'),
    ('steps', 1990, 'male', 170, 160, 150, '${shiftDate(today, 120)}', 'light'),
    ('cal', 1990, 'male', 170, 100, 90, '${shiftDate(today, 120)}', 'sedentary');
`);
// 6 days of steps in the last 14 (average 11 000), one old day that must not count
for (const [offset, steps] of [[1, 10000], [2, 12000], [3, 11000], [4, 10000], [5, 12000], [6, 11000], [30, 500]] as const) {
  await client.execute({
    sql: `INSERT INTO daily_activity (id, user_id, date, steps, active_calories, source) VALUES (?, 'steps', ?, ?, 300, 'health_connect')`,
    args: [`da-${offset}`, shiftDate(today, -offset), steps],
  });
}
// 28 days of 3 000 kcal eaten at a steady 100 kg, weighed every 3 days; a 280 kcal manual workout every day and a
// Strava one that must not take part (Strava data never mixes with weight and food analytics)
for (let offset = 1; offset <= 28; offset++) {
  const date = shiftDate(today, -offset);
  await client.execute({ sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES (?, 'cal', ?, 'sarapan', 'x', 3000)`, args: [`cf-${offset}`, date] });
  await client.execute({ sql: `INSERT INTO exercise_log (id, user_id, date, name, kcal, source) VALUES (?, 'cal', ?, 'x', 280, 'manual')`, args: [`ce-${offset}`, date] });
  await client.execute({ sql: `INSERT INTO exercise_log (id, user_id, date, name, kcal, source) VALUES (?, 'cal', ?, 'x', 900, 'strava')`, args: [`cs-${offset}`, date] });
  if (offset % 3 === 1) {
    await client.execute({ sql: `INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES (?, 'cal', ?, 100)`, args: [`cw-${offset}`, date] });
  }
}
// the account of a person who has not onboarded yet has steps too
for (const offset of [1, 2, 3, 4, 5]) {
  await client.execute({
    sql: `INSERT INTO daily_activity (id, user_id, date, steps, active_calories, source) VALUES (?, 'fresh', ?, 3000, 100, 'health_connect')`,
    args: [`fa-${offset}`, shiftDate(today, -offset)],
  });
}

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

describe("profile.updateTargets target date", () => {
  test("a date in the future is saved and the daily target moves with it", async () => {
    const before = await call(profileRouter.myProfile, undefined, as("cut"));
    const out = await call(
      profileRouter.updateTargets,
      { targetWeightKg: 150, targetDate: shiftDate(today, 60) },
      as("cut"),
    );
    const after = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(after.profile?.targetDate).toBe(shiftDate(today, 60));
    // 10 kg in 60 days asks for more than 120 days did, so the plan eats less (or sits on the floor).
    expect(out.targets.eatKcal).toBeLessThanOrEqual(before.targets!.eatKcal);
    expect(out.targets.deficitKcal).toBeGreaterThan(before.targets!.deficitKcal);
  });

  test("today, the past and a non-date are refused and nothing is written", async () => {
    const saved = shiftDate(today, 60);
    for (const targetDate of [today, shiftDate(today, -3), "2026-02-30", shiftDate(today, 4000)]) {
      await expect(
        call(profileRouter.updateTargets, { targetWeightKg: 150, targetDate }, as("cut")),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const row = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(row.profile?.targetDate).toBe(saved);
  });

  test("a weight edit that re-sends a lapsed date still goes through", async () => {
    const out = await call(
      profileRouter.updateTargets,
      { targetWeightKg: 72, targetDate: lapsedDate },
      as("lapsed"),
    );
    expect(out.targets.notes).toContain("PLAN_CLAMPED");
    const row = await call(profileRouter.myProfile, undefined, as("lapsed"));
    expect(row.profile?.targetWeightKg).toBe(72);
  });

  test("a lapsed date can be replaced by a future one", async () => {
    await call(
      profileRouter.updateTargets,
      { targetWeightKg: 72, targetDate: shiftDate(today, 90) },
      as("lapsed"),
    );
    const row = await call(profileRouter.myProfile, undefined, as("lapsed"));
    expect(row.profile?.targetDate).toBe(shiftDate(today, 90));
  });
});

describe("profile.previewTargets", () => {
  test("shows the numbers a date would give without saving it", async () => {
    const stored = (await call(profileRouter.myProfile, undefined, as("cut"))).profile!.targetDate;
    const out = await call(
      profileRouter.previewTargets,
      { targetWeightKg: 150, targetDate: shiftDate(today, 150) },
      as("cut"),
    );
    // stored: 60 days (clamped at 1000/day); 150 days asks for ~513/day.
    expect(out.check.status).toBe("ok");
    expect(out.next.deficitKcal).toBeLessThan(out.current.deficitKcal);
    expect(out.next.eatKcal).toBeGreaterThan(out.current.eatKcal);
    const row = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(row.profile?.targetDate).toBe(stored);
  });
});

describe("profile.activityGuide", () => {
  test("lists what each level makes of this person's target and recommends from steps", async () => {
    const guide = await call(profileRouter.activityGuide, undefined, as("steps"));
    expect(guide.level).toBe("light");
    expect(guide.maternal).toBe(false);
    expect(guide.options.map((o) => o.level)).toEqual(["sedentary", "light", "moderate", "active", "very_active"]);
    expect(guide.options.map((o) => o.factor)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9]);
    const mine = await call(profileRouter.myProfile, undefined, as("steps"));
    expect(guide.options.find((o) => o.level === "light")!.targetKcal).toBe(mine.targets!.eatKcal);
    // 6 days in the last 14 average 11 000 steps (the day 30 days ago is outside the window): "active" by Tudor-Locke & Bassett
    expect(guide.steps).toEqual({ level: "active", avgSteps: 11000, days: 6 });
    // no weigh-in history and no food logs: no calibration
    expect(guide.calibration).toBeNull();
  });

  test("works before onboarding: only the steps recommendation can exist", async () => {
    const guide = await call(profileRouter.activityGuide, undefined, as("fresh"));
    expect(guide).toMatchObject({ level: null, options: [], calibration: null, steps: { level: "sedentary", avgSteps: 3000, days: 5 } });
  });

  test("with the automatic calibration on (the default) the trend suggestion is superseded by it", async () => {
    const guide = await call(profileRouter.activityGuide, undefined, as("cal"));
    expect(guide.calibration).toBeNull();
    // the weekly measurement looks back from the last Monday, so how much of this 28-day seed it sees depends on the weekday
    expect(guide.autoCalibration).toMatchObject({ enabled: true, loggedDays: 28 });
    expect(["active", "waiting"]).toContain(guide.autoCalibration!.status);
  });

  test("recommends from the weight trend once the logs are long and regular enough, while the calibration is off", async () => {
    await client.execute({
      sql: `INSERT INTO sync_record (user_id, ns, kind, id, json, updated_at, deleted_at, rank, server_at) VALUES ('cal', 'rogo', 'pref', 'energy.calibration', ?, 1, NULL, 0, 1)`,
      args: [JSON.stringify({ value: false })],
    });
    const guide = await call(profileRouter.activityGuide, undefined, as("cal"));
    await client.execute(`DELETE FROM sync_record WHERE user_id = 'cal' AND id = 'energy.calibration'`);
    expect(guide.autoCalibration).toMatchObject({ enabled: false, status: "off" });
    // BMR at 100 kg, age 36: 1000 + 1062.5 - 180 + 5 = 1887.5. Steady weight on 3 000 kcal eaten a day = 3 000 burned;
    // the 280 kcal workouts come out: (3000 - 280) / 1888 = 1.44, nearest to light 1.375 (the sedentary formula says 2266)
    expect(guide.calibration).toEqual({
      level: "light",
      impliedFactor: 1.44,
      measuredKcal: 2720,
      formulaKcal: 2266,
      avgWorkoutKcal: 280,
      loggedDays: 28,
      windowDays: 28,
    });
    // it is a recommendation: the stored level is untouched
    expect(guide.level).toBe("sedentary");
  });

  test("an account with no data gets nothing to recommend", async () => {
    const guide = await call(profileRouter.activityGuide, undefined, as("cut"));
    expect(guide.steps).toBeNull();
    expect(guide.calibration).toBeNull();
  });
});

describe("profile.setActivityLevel", () => {
  test("stores the level and the target follows its factor", async () => {
    const before = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(before.targets).toMatchObject({ level: "light", factor: 1.375 });
    const out = await call(profileRouter.setActivityLevel, { level: "very_active" }, as("cut"));
    expect(out.targets).toMatchObject({ level: "very_active", factor: 1.9 });
    expect(out.targets.eatKcal).toBeGreaterThan(before.targets!.eatKcal);
    const after = await call(profileRouter.myProfile, undefined, as("cut"));
    expect(after.profile?.activityLevel).toBe("very_active");
    await call(profileRouter.setActivityLevel, { level: "light" }, as("cut"));
  });

  test("the old three-level names are refused", async () => {
    for (const level of ["low", "mid", "high"]) {
      await expect(call(profileRouter.setActivityLevel, { level } as never, as("cut"))).rejects.toThrow();
    }
  });

  test("a person without a profile gets a not-found, nothing is created", async () => {
    await expect(call(profileRouter.setActivityLevel, { level: "light" }, as("fresh"))).rejects.toThrow();
  });
});

describe("profile.scanAllowance", () => {
  const paywall = { FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" };
  const withEnv = (userId: string, env: Record<string, string>) => ({
    context: { ...as(userId).context, env } as unknown as Context,
  });
  const nowMs = Date.now();

  test("a free account sees its quota and what today's scans left of it", async () => {
    await client.executeMultiple(`
      INSERT INTO "user" (id, name, email, tier) VALUES ('allow-free', 'f', 'allow-free@test.id', 'free');
      INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, created_at) VALUES
        ('au1', 'allow-free', 'm', 'user', 1, ${nowMs}),
        ('au2', 'allow-free', 'm', 'user', 1, ${nowMs}),
        ('au3', 'allow-free', 'm', 'retry', 1, ${nowMs});
    `);
    const out = await call(profileRouter.scanAllowance, undefined, withEnv("allow-free", paywall));
    expect(out).toEqual({ tier: "free", quota: 3, used: 2, left: 1 });
  });

  test("a Pro account has the Pro cap", async () => {
    await client.execute(`INSERT INTO "user" (id, name, email, tier) VALUES ('allow-pro', 'p', 'allow-pro@test.id', 'founder')`);
    const out = await call(profileRouter.scanAllowance, undefined, withEnv("allow-pro", paywall));
    expect(out).toEqual({ tier: "founder", quota: 100, used: 0, left: 100 });
  });

  test("an unlimited account and a server without a paywall report no limit", async () => {
    await client.execute(`INSERT INTO "user" (id, name, email, tier, ai_unlimited) VALUES ('allow-vip', 'v', 'allow-vip@test.id', 'free', 1)`);
    expect(await call(profileRouter.scanAllowance, undefined, withEnv("allow-vip", paywall))).toMatchObject({ quota: null, left: null });
    expect(await call(profileRouter.scanAllowance, undefined, withEnv("allow-free", {}))).toMatchObject({ quota: null, left: null });
  });
});
