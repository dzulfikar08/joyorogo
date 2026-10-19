import { describe, expect, test } from "bun:test";

import {
  CALIBRATION_MIN_SPAN_DAYS,
  STEPS_MIN_DAYS,
  activityOptions,
  calibrationRecommendation,
  levelFromFactor,
  levelFromSteps,
  stepsRecommendation,
} from "./activity-guide";
import { ACTIVITY_FACTOR, ACTIVITY_LEVELS, computeTargets, shiftDate } from "./engine";
import type { ActivityLevel, DayKcal, ProfileInput, WeighIn } from "./engine";
import { NO_MATERNAL } from "./maternal";
import type { MaternalState } from "./maternal";

const TODAY = "2026-10-19";

describe("levelFromSteps: the Tudor-Locke & Bassett 2004 step index", () => {
  test("the boundaries", () => {
    const cases: [number, ActivityLevel][] = [
      [0, "sedentary"],
      [4999, "sedentary"],
      [5000, "light"],
      [7499, "light"],
      [7500, "moderate"],
      [9999, "moderate"],
      [10000, "active"],
      [12499, "active"],
      [12500, "very_active"],
      [30000, "very_active"],
    ];
    for (const [steps, level] of cases) expect(levelFromSteps(steps)).toBe(level);
  });
});

describe("stepsRecommendation", () => {
  const day = (offset: number, steps: number | null) => ({ date: shiftDate(TODAY, -offset), steps });

  test("needs 5 days with steps in the last 14", () => {
    expect(STEPS_MIN_DAYS).toBe(5);
    const four = [1, 2, 3, 4].map((i) => day(i, 9000));
    expect(stepsRecommendation(four, TODAY)).toBeNull();
    const five = [1, 2, 3, 4, 5].map((i) => day(i, 9000));
    expect(stepsRecommendation(five, TODAY)).toEqual({ level: "moderate", avgSteps: 9000, days: 5 });
  });

  test("averages the days that have steps; empty and zero days are not data", () => {
    const rows = [day(1, 3000), day(2, 4000), day(3, 5000), day(4, 4000), day(5, 4000), day(6, 0), day(7, null)];
    expect(stepsRecommendation(rows, TODAY)).toEqual({ level: "sedentary", avgSteps: 4000, days: 5 });
  });

  test("today (partial) and days older than 14 do not count", () => {
    const rows = [day(0, 20000), day(15, 20000), day(20, 20000), day(1, 8000), day(2, 8000), day(3, 8000), day(4, 8000), day(5, 8000)];
    expect(stepsRecommendation(rows, TODAY)).toEqual({ level: "moderate", avgSteps: 8000, days: 5 });
    expect(stepsRecommendation([day(0, 8000), day(15, 8000), day(16, 8000), day(17, 8000), day(18, 8000)], TODAY)).toBeNull();
  });

  test("the day 14 days ago is the oldest one counted", () => {
    const rows = [14, 13, 12, 11, 10].map((i) => day(i, 11000));
    expect(stepsRecommendation(rows, TODAY)).toMatchObject({ level: "active", days: 5 });
  });

  test("no rows: no recommendation (no data, nothing to ask a permission for)", () => {
    expect(stepsRecommendation([], TODAY)).toBeNull();
  });
});

describe("levelFromFactor: the nearest level", () => {
  test("each factor maps to its own level; between two it takes the closer one", () => {
    for (const level of ACTIVITY_LEVELS) expect(levelFromFactor(ACTIVITY_FACTOR[level])).toBe(level);
    expect(levelFromFactor(1.28)).toBe("sedentary");
    expect(levelFromFactor(1.3)).toBe("light");
    expect(levelFromFactor(1.46)).toBe("light");
    expect(levelFromFactor(1.47)).toBe("moderate");
    expect(levelFromFactor(0.9)).toBe("sedentary");
    expect(levelFromFactor(2.6)).toBe("very_active");
  });
});

describe("calibrationRecommendation: gating and the implied factor", () => {
  const BMR = 2000;
  const dayAt = (i: number) => shiftDate(TODAY, -i);
  // `days` of intake ending yesterday; weigh-ins every 3 days from yesterday back, spanning 3 x floor(spanDays / 3) days
  // (constant weight, slope 0)
  const intake = (kcal: number, days: number): DayKcal[] => Array.from({ length: days }, (_, i) => ({ date: dayAt(i + 1), kcal }));
  const weighIns = (spanDays: number): WeighIn[] =>
    Array.from({ length: Math.floor(spanDays / 3) + 1 }, (_, i) => ({ date: dayAt(1 + i * 3), weightKg: 100 })).sort((a, b) => a.date.localeCompare(b.date));
  const run = (over: Partial<Parameters<typeof calibrationRecommendation>[0]> = {}) =>
    calibrationRecommendation({
      date: TODAY,
      weighIns: weighIns(27),
      intake: intake(3000, 28),
      exercise: [],
      bmrKcal: BMR,
      currentLevel: "sedentary",
      ...over,
    });

  test("steady weight: measured TDEE = what was eaten; implied factor = measured / BMR", () => {
    const r = run();
    expect(r).toMatchObject({ impliedFactor: 1.5, measuredKcal: 3000, formulaKcal: 2400, level: "moderate", loggedDays: 28, windowDays: 28 });
  });

  test("the average logged workout kcal a day comes out of the measured total", () => {
    const exercise: DayKcal[] = Array.from({ length: 28 }, (_, i) => ({ date: dayAt(i + 1), kcal: 280 }));
    const r = run({ exercise });
    // (3000 - 280) / 2000 = 1.36 -> light (1.375), not moderate
    expect(r).toMatchObject({ impliedFactor: 1.36, measuredKcal: 2720, avgWorkoutKcal: 280, level: "light" });
  });

  test("weight falling on the same intake means a higher expenditure", () => {
    // 0.5 kg / week = 550 kcal/day more burned than eaten
    const falling: WeighIn[] = Array.from({ length: 10 }, (_, i) => ({ date: dayAt(28 - i * 3), weightKg: 100 - (i * 3 * 0.5) / 7 }));
    const r = run({ weighIns: falling, intake: intake(2000, 28) });
    expect(r!.measuredKcal).toBeGreaterThan(2400);
    expect(r!.measuredKcal).toBeLessThan(2700);
  });

  test("needs 70% of the 28 days logged (20 days): 19 is not enough", () => {
    expect(run({ intake: intake(3000, 19) })).toBeNull();
    expect(run({ intake: intake(3000, 20) })).not.toBeNull();
  });

  test("a day logged under 800 kcal is not a logged day", () => {
    const thin = [...intake(3000, 19), { date: dayAt(20), kcal: 500 }];
    expect(run({ intake: thin })).toBeNull();
  });

  test("the weigh-ins must span 21 days", () => {
    expect(CALIBRATION_MIN_SPAN_DAYS).toBe(21);
    expect(run({ weighIns: weighIns(18) })).toBeNull();
    expect(run({ weighIns: weighIns(21) })).not.toBeNull();
  });

  test("too few weigh-ins (adaptiveTdee's own gate) gives nothing", () => {
    const few: WeighIn[] = [dayAt(27), dayAt(15), dayAt(3)].map((date) => ({ date, weightKg: 100 }));
    expect(run({ weighIns: few })).toBeNull();
  });

  test("no BMR, no recommendation", () => {
    expect(run({ bmrKcal: 0 })).toBeNull();
  });

  test("today is not part of the window", () => {
    const withToday = [...intake(3000, 28), { date: TODAY, kcal: 100 }];
    expect(run({ intake: withToday })).toMatchObject({ measuredKcal: 3000 });
  });
});

describe("activityOptions: what each level makes of this person's target", () => {
  const owner: ProfileInput = {
    birthYear: 2000,
    gender: "male",
    heightCm: 171.5,
    weightKg: 107.7,
    targetWeightKg: 78,
    targetDate: "2027-06-04",
    activityLevel: "sedentary",
  };

  test("five options, each the plan computeTargets gives for that level", () => {
    const options = activityOptions(owner, null, 107.7, TODAY);
    expect(options.map((o) => o.level)).toEqual([...ACTIVITY_LEVELS]);
    for (const option of options) {
      const t = computeTargets({ ...owner, activityLevel: option.level }, { today: TODAY, weightNow: 107.7 });
      expect(option).toMatchObject({ factor: ACTIVITY_FACTOR[option.level], tdeeKcal: t.tdee, targetKcal: t.eatKcal, includedKcal: t.includedKcal });
    }
  });

  test("the minimum eating floor is flagged: the lowest level cannot go under it", () => {
    const options = activityOptions(owner, null, 107.7, TODAY);
    expect(options.find((o) => o.level === "sedentary")).toMatchObject({ targetKcal: 1500, floored: true });
    expect(options.find((o) => o.level === "moderate")).toMatchObject({ floored: false });
  });

  test("Hamil / Menyusui options use the maternal factors", () => {
    const state: MaternalState = { ...NO_MATERNAL, mode: "pregnant", pregnancyLmp: shiftDate(TODAY, -100), pregnancyDateKind: "hpht", prePregnancyWeightKg: 55 };
    const options = activityOptions({ ...owner, gender: "female", heightCm: 160 }, state, 62, TODAY);
    expect(options.map((o) => o.factor)).toEqual([1.25, 1.35, 1.45, 1.55, 1.65]);
    expect(options.every((o) => !o.floored)).toBe(true);
  });
});
