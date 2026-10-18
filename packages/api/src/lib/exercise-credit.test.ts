import { describe, expect, test } from "bun:test";

import { computeTargets, remainingKcal } from "./engine";
import type { ProfileInput } from "./engine";
import {
  ADD_BACK_NOTICE_BEFORE_MS,
  DEFAULT_ADD_BACK_SETTINGS,
  STEP_KCAL_PER_KG,
  addBackSettings,
  dayBudgetKcal,
  exerciseCredit,
  showAddBackNotice,
} from "./exercise-credit";
import type { AddBackSettings } from "./exercise-credit";
import { computeMaternalTargets } from "./maternal";
import type { MaternalState } from "./maternal";

const TODAY = "2026-10-18";
const settings = (patch: Partial<AddBackSettings> = {}): AddBackSettings => ({ ...DEFAULT_ADD_BACK_SETTINGS, ...patch });
const credit = (patch: Partial<AddBackSettings>, rows: { kcal: number; source?: string; type?: string; durationMin?: number }[], steps: number | null = null, weightKg = 70) =>
  exerciseCredit({ settings: settings(patch), rows, steps, weightKg });

describe("exerciseCredit: workouts", () => {
  test("defaults count 75% of the recorded exercise", () => {
    const c = credit({}, [{ kcal: 300 }, { kcal: 200, source: "joyofit" }]);
    expect(c.workoutKcal).toBe(500);
    expect(c.countedKcal).toBe(375);
    expect(c.capped).toBe(false);
  });

  test("every recorded source counts; rest rows never do", () => {
    const rows = ["manual", "joyofit", "health_connect", "apple_health", "strava"].map((source) => ({ kcal: 100, source }));
    expect(credit({}, [...rows, { kcal: 900, source: "rest" }]).workoutKcal).toBe(500);
  });

  test("the share is the pct setting, 50 to 100", () => {
    const rows = [{ kcal: 400 }];
    expect(credit({ pct: 50 }, rows).countedKcal).toBe(200);
    expect(credit({ pct: 100 }, rows).countedKcal).toBe(400);
    expect(credit({ pct: 85 }, rows).countedKcal).toBe(340);
  });

  test("nothing recorded adds nothing", () => {
    expect(credit({}, []).countedKcal).toBe(0);
  });

  test("off: nothing is added, the recorded total is still reported", () => {
    const c = credit({ enabled: false }, [{ kcal: 600 }]);
    expect(c.countedKcal).toBe(0);
    expect(c.workoutKcal).toBe(600);
    expect(c.capped).toBe(false);
  });

  test("steps are ignored on the workouts source", () => {
    const c = credit({}, [{ kcal: 100 }], 20000);
    expect(c.stepKcal).toBe(0);
    expect(c.countedKcal).toBe(75);
  });
});

describe("exerciseCredit: the cap", () => {
  const big = [{ kcal: 2000 }];

  test("the default cap is 1000 kcal", () => {
    const c = credit({}, big);
    expect(c.countedKcal).toBe(1000);
    expect(c.capped).toBe(true);
  });

  test("500 and 1500 cut at their value", () => {
    expect(credit({ cap: 500 }, big).countedKcal).toBe(500);
    expect(credit({ cap: 1500 }, big).countedKcal).toBe(1500);
  });

  test("none lets the full share through", () => {
    const c = credit({ cap: "none" }, [{ kcal: 3000 }]);
    expect(c.countedKcal).toBe(2250);
    expect(c.capped).toBe(false);
  });

  test("exactly at the cap is not capped", () => {
    expect(credit({ pct: 100 }, [{ kcal: 1000 }]).capped).toBe(false);
  });
});

describe("exerciseCredit: steps", () => {
  const steps = { source: "workouts+steps" as const };

  test("only steps above the threshold count, at 0.0005 kcal per kg per step", () => {
    const c = credit(steps, [], 9000, 80);
    expect(c.countedSteps).toBe(4000);
    expect(c.stepKcal).toBe(Math.round(4000 * STEP_KCAL_PER_KG * 80));
    expect(c.countedKcal).toBe(Math.round(c.stepKcal * 0.75));
  });

  test("under the threshold adds nothing", () => {
    const c = credit(steps, [], 4999);
    expect(c.countedSteps).toBe(0);
    expect(c.countedKcal).toBe(0);
  });

  test("the threshold is a setting, 3000 to 10000", () => {
    expect(credit({ ...steps, stepThreshold: 3000 }, [], 8000).countedSteps).toBe(5000);
    expect(credit({ ...steps, stepThreshold: 10000 }, [], 8000).countedSteps).toBe(0);
  });

  test("steps add to the workouts, then the share applies to both", () => {
    const c = credit(steps, [{ kcal: 200 }], 10000, 70);
    // 5000 steps * 0.0005 * 70 = 175
    expect(c.stepKcal).toBe(175);
    expect(c.countedKcal).toBe(Math.round((200 + 175) * 0.75));
  });

  test("steps inside a recorded walk or run are not counted twice", () => {
    // 60 min of brisk walking is about 6900 steps already inside the 10000
    const c = credit(steps, [{ kcal: 250, type: "jalan_cepat", durationMin: 60 }], 10000, 70);
    expect(c.countedSteps).toBe(Math.max(0, 10000 - 60 * 115 - 5000));
    // a run of 30 min: 4800 steps
    expect(credit(steps, [{ kcal: 300, type: "lari", durationMin: 30 }], 12000).countedSteps).toBe(12000 - 4800 - 5000);
  });

  test("a workout of another type, or without a duration, subtracts no steps", () => {
    expect(credit(steps, [{ kcal: 400, type: "sepeda", durationMin: 60 }], 9000).countedSteps).toBe(4000);
    expect(credit(steps, [{ kcal: 100, type: "jalan" }], 9000).countedSteps).toBe(4000);
    expect(credit(steps, [{ kcal: 100 }], 9000).countedSteps).toBe(4000);
  });

  test("no step data (no source synced) adds nothing and does not fail", () => {
    const c = credit(steps, [{ kcal: 100 }], null);
    expect(c.stepKcal).toBe(0);
    expect(c.countedKcal).toBe(75);
  });

  test("the cap holds over workouts and steps together", () => {
    expect(credit({ ...steps, cap: 500 }, [{ kcal: 800 }], 40000, 90).countedKcal).toBe(500);
  });
});

describe("addBackSettings", () => {
  test("nothing stored means the defaults", () => {
    expect(addBackSettings({})).toEqual({ enabled: true, pct: 75, source: "workouts", stepThreshold: 5000, cap: 1000 });
  });

  test("stored values override, each on its own", () => {
    expect(
      addBackSettings({
        "exercise.addBack.enabled": false,
        "exercise.addBack.pct": 90,
        "exercise.addBack.cap": "none",
      }),
    ).toEqual({ enabled: false, pct: 90, source: "workouts", stepThreshold: 5000, cap: "none" });
  });

  test("a malformed value falls back to its default, the rest stand", () => {
    expect(
      addBackSettings({
        "exercise.addBack.enabled": "no",
        "exercise.addBack.pct": 33,
        "exercise.addBack.source": "workouts+steps",
        "exercise.addBack.stepThreshold": 4321,
      }),
    ).toEqual({ ...DEFAULT_ADD_BACK_SETTINGS, source: "workouts+steps" });
  });
});

const LOSE: ProfileInput = {
  birthYear: 1996,
  gender: "male",
  heightCm: 170,
  weightKg: 130,
  targetWeightKg: 120,
  targetDate: "2027-01-16", // 90 days
  activityLevel: "mid",
};

describe("the budget in each mode", () => {
  const rows = [{ kcal: 400 }];

  test("loss: Sisa = base - eaten + counted exercise; the base has no planned Bakar in it", () => {
    const t = computeTargets(LOSE, { today: TODAY });
    // sedentary tdee 2217.5 * 1.2 = 2661, whole 856 deficit from food
    expect(t.eatKcal).toBe(1805);
    const c = credit({}, rows);
    expect(c.countedKcal).toBe(300);
    const budget = dayBudgetKcal(t.eatKcal, c);
    expect(budget).toBe(2105);
    expect(remainingKcal(budget, 1000)).toEqual({ kcal: 1105, over: false });
    expect(remainingKcal(budget, 2200)).toEqual({ kcal: 95, over: true });
  });

  test("loss: the floor stays under the base, exercise is added on top of it", () => {
    const t = computeTargets({ ...LOSE, weightKg: 80, targetWeightKg: 70 }, { today: TODAY });
    expect(t.eatKcal).toBe(1500);
    expect(t.notes).toContain("PLAN_CLAMPED");
    expect(dayBudgetKcal(t.eatKcal, credit({}, rows))).toBe(1800);
  });

  test("setting off: the budget is the base, as before", () => {
    const t = computeTargets(LOSE, { today: TODAY });
    expect(dayBudgetKcal(t.eatKcal, credit({ enabled: false }, rows))).toBe(t.eatKcal);
  });

  test("gain: the extra burn raises how much is still to eat", () => {
    const lean: ProfileInput = { ...LOSE, weightKg: 60, targetWeightKg: 66, goal: "gain", targetDate: "2027-04-16" };
    const t = computeTargets(lean, { today: TODAY });
    expect(t.gain).not.toBeNull();
    expect(t.eatKcal).toBe(t.tdee + t.gain!.surplusKcal);
    const budget = dayBudgetKcal(t.eatKcal, credit({}, rows));
    expect(budget).toBe(t.eatKcal + 300);
    expect(remainingKcal(budget, t.eatKcal).kcal).toBe(300);
  });

  test("maternal: exercise only ever raises the target, never lowers it", () => {
    const state: MaternalState = {
      mode: "pregnant",
      pregnancyLmp: "2026-06-01",
      pregnancyDateKind: "hpht",
      prePregnancyWeightKg: 60,
      twins: false,
      feedingType: null,
      babyBirthDate: null,
      conditions: [],
    };
    const t = computeMaternalTargets({ ...LOSE, gender: "female", weightKg: 62 }, state, { today: TODAY, weightNow: 62 });
    expect(t.deficitKcal).toBe(0);
    expect(dayBudgetKcal(t.eatKcal, credit({}, []))).toBe(t.eatKcal);
    expect(dayBudgetKcal(t.eatKcal, credit({}, rows))).toBe(t.eatKcal + 300);
    expect(dayBudgetKcal(t.eatKcal, credit({ enabled: false }, rows))).toBe(t.eatKcal);
  });

  test("the maternal base keeps the old activity multiplier: no lower than before the change", () => {
    const state: MaternalState = {
      mode: "breastfeeding",
      pregnancyLmp: null,
      pregnancyDateKind: null,
      prePregnancyWeightKg: null,
      twins: false,
      feedingType: "exclusive",
      babyBirthDate: "2026-08-01",
      conditions: [],
    };
    const profile = { ...LOSE, gender: "female" as const, weightKg: 60, activityLevel: "high" as const };
    const t = computeMaternalTargets(profile, state, { today: TODAY, weightNow: 60 });
    const bmr = 10 * 60 + 6.25 * 170 - 5 * 30 - 161;
    expect(t.maternal!.baseKcal).toBe(Math.round((bmr * 1.45) / 5) * 5);
    expect(t.maternal!.baseKcal).toBeGreaterThan(bmr * 1.2);
  });
});

describe("the one-time notice", () => {
  const before = ADD_BACK_NOTICE_BEFORE_MS - 1000;
  const after = ADD_BACK_NOTICE_BEFORE_MS + 1000;

  test("shows to an account made before the change, until it is closed", () => {
    expect(showAddBackNotice({ accountCreatedAtMs: before, dismissed: false })).toBe(true);
    expect(showAddBackNotice({ accountCreatedAtMs: before, dismissed: true })).toBe(false);
  });

  test("never shows to an account made after the change", () => {
    expect(showAddBackNotice({ accountCreatedAtMs: after, dismissed: false })).toBe(false);
  });

  test("an unknown creation time does not show it", () => {
    expect(showAddBackNotice({ accountCreatedAtMs: Number.NaN, dismissed: false })).toBe(false);
  });
});
