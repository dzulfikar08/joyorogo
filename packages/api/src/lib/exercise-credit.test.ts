import { describe, expect, test } from "bun:test";

import { computeTargets, remainingKcal } from "./engine";
import type { ProfileInput } from "./engine";
import {
  ADD_BACK_NOTICE_BEFORE_MS,
  ALL_DAY_MAX_KCAL,
  DEFAULT_ADD_BACK_SETTINGS,
  addBackSettings,
  allDayActive,
  budgetKcal,
  exerciseCredit,
  shiftWorkoutKcal,
  showAddBackNotice,
} from "./exercise-credit";
import type { AddBackSettings, AllDayReading } from "./exercise-credit";
import { computeMaternalTargets } from "./maternal";
import type { MaternalState } from "./maternal";

const TODAY = "2026-10-18";
const settings = (patch: Partial<AddBackSettings> = {}): AddBackSettings => ({ ...DEFAULT_ADD_BACK_SETTINGS, ...patch });
type Row = { kcal: number; source?: string; externalId?: string };
const credit = (patch: Partial<AddBackSettings>, rows: Row[], watch: number | null = null, steps: number | null = null, extra: AllDayReading[] = []) =>
  exerciseCredit({
    settings: settings(patch),
    rows,
    readings: [{ source: "joyofit", kcal: watch }, ...extra],
    steps,
  });

describe("the watch's all-day energy against recorded workouts", () => {
  test("all-day energy already contains the watch's workouts: they are not added", () => {
    // 700 kcal all day, of which a 300 kcal watch workout
    const c = credit({}, [{ kcal: 300, source: "joyofit" }], 700);
    expect(c.allDayKcal).toBe(700);
    expect(c.activeKcal).toBe(700);
    expect(c.countedKcal).toBe(525);
  });

  test("a valid all-day total is trusted over bigger workout entries (the 15 Okt case)", () => {
    // Apple Health: all-day 254, two imported walks of 471 and 650 kcal: the walks are not added and do not win
    const c = credit({}, [{ kcal: 471, source: "apple_health" }, { kcal: 650, source: "apple_health" }], null, 4972, [{ source: "apple_health", kcal: 254 }]);
    expect(c.allDayKcal).toBe(254);
    expect(c.deviceWorkoutKcal).toBe(1121);
    expect(c.activeKcal).toBe(254);
    expect(c.countedKcal).toBe(Math.round(254 * 0.75));
  });

  test("bigger watch workouts do not beat the watch's all-day total either", () => {
    const c = credit({}, [{ kcal: 300, source: "joyofit", externalId: "watch:1" }, { kcal: 100, source: "joyofit", externalId: "watch:2" }], 250);
    expect(c.activeKcal).toBe(250);
  });

  test("JoyoFit strength rows are inside the watch's all-day total but add on top of a health-store total", () => {
    const strength = [{ kcal: 200, source: "joyofit", externalId: "strength:9" }];
    expect(credit({}, strength, 700).activeKcal).toBe(700);
    const hc = credit({}, strength, null, null, [{ source: "health_connect", kcal: 500 }]);
    expect(hc.otherWorkoutKcal).toBe(200);
    expect(hc.activeKcal).toBe(700);
  });

  test("the health store's workouts are inside all-day too", () => {
    const c = credit({}, [{ kcal: 200, source: "health_connect" }, { kcal: 100, source: "apple_health" }], 800);
    expect(c.activeKcal).toBe(800);
  });

  test("manual and Strava rows are never inside the all-day total: they add on top", () => {
    const c = credit({}, [{ kcal: 300, source: "joyofit" }, { kcal: 150, source: "manual" }, { kcal: 100, source: "strava" }], 700);
    expect(c.otherWorkoutKcal).toBe(250);
    expect(c.activeKcal).toBe(950);
    expect(c.countedKcal).toBe(Math.round(950 * 0.75));
  });

  test("no all-day data: every recorded workout counts, device and other alike", () => {
    const c = credit({}, [{ kcal: 300, source: "joyofit" }, { kcal: 100, source: "manual" }, { kcal: 50, source: "health_connect" }]);
    expect(c.allDayKcal).toBeNull();
    expect(c.activeKcal).toBe(450);
  });

  test("rest rows are never movement", () => {
    expect(credit({}, [{ kcal: 900, source: "rest" }], 500).activeKcal).toBe(500);
  });

  test("two readings of the same energy are never added: the larger one counts", () => {
    const c = credit({}, [], 600, null, [{ source: "health_connect", kcal: 450 }]);
    expect(c.allDayKcal).toBe(600);
    expect(c.allDaySource).toBe("joyofit");
    const hc = credit({}, [], 300, null, [{ source: "apple_health", kcal: 450 }]);
    expect(hc.allDayKcal).toBe(450);
    expect(hc.allDaySource).toBe("apple_health");
  });
});

describe("allDayActive: broken data is ignored", () => {
  test("empty, null, zero and negative readings are not data", () => {
    expect(allDayActive([{ source: "joyofit", kcal: null }, { source: "health_connect", kcal: 0 }, { source: "apple_health", kcal: -4 }], null)).toBeNull();
  });

  test("above the sane maximum is a glitch", () => {
    expect(allDayActive([{ source: "joyofit", kcal: ALL_DAY_MAX_KCAL + 1 }], null)).toBeNull();
    expect(allDayActive([{ source: "joyofit", kcal: ALL_DAY_MAX_KCAL }], null)).toMatchObject({ kcal: ALL_DAY_MAX_KCAL });
  });

  test("almost no energy on a day with many steps is a broken reading (0 active, 15 000 steps)", () => {
    expect(allDayActive([{ source: "health_connect", kcal: 12 }], 15000)).toBeNull();
    expect(allDayActive([{ source: "health_connect", kcal: 400 }], 15000)).toMatchObject({ kcal: 400 });
  });

  test("a low reading on a day with few steps is fine", () => {
    expect(allDayActive([{ source: "joyofit", kcal: 20 }], 800)).toMatchObject({ kcal: 20 });
  });

  test("a broken reading falls back to the other one", () => {
    expect(allDayActive([{ source: "joyofit", kcal: 9000 }, { source: "health_connect", kcal: 500 }], null)).toMatchObject({ source: "health_connect" });
  });

  test("a broken watch reading means the assumption applies and the workouts count", () => {
    const c = credit({ assumedKcal: 300 }, [{ kcal: 200, source: "joyofit" }], 9000);
    expect(c.allDayKcal).toBeNull();
    expect(c.assumedKcal).toBe(300);
    expect(c.activeKcal).toBe(200);
  });
});

describe("the assumed daily activity", () => {
  test("applies only on a day without all-day data", () => {
    expect(credit({ assumedKcal: 300 }, [], null).assumedKcal).toBe(300);
    expect(credit({ assumedKcal: 300 }, [], 500).assumedKcal).toBe(0);
  });

  test("is not multiplied by pct and not capped by the cap", () => {
    const c = credit({ assumedKcal: 500, pct: 50, cap: 500 }, [{ kcal: 2000, source: "manual" }]);
    expect(c.assumedKcal).toBe(500);
    expect(c.countedKcal).toBe(500);
    expect(budgetKcal(1500, c)).toBe(2500);
  });

  test("still applies when the exercise setting is off (it is part of the base)", () => {
    const c = credit({ enabled: false, assumedKcal: 150 }, [{ kcal: 400, source: "manual" }]);
    expect(c.countedKcal).toBe(0);
    expect(budgetKcal(1500, c)).toBe(1650);
  });

  test("none (the default) adds nothing", () => {
    expect(budgetKcal(1500, credit({}, []))).toBe(1500);
  });
});

describe("counted = min(cap, pct x active)", () => {
  const rows: Row[] = [{ kcal: 400, source: "manual" }];

  test("the default share is 75%", () => {
    expect(credit({}, rows).countedKcal).toBe(300);
  });

  test("pct goes from 50 to 100", () => {
    expect(credit({ pct: 50 }, rows).countedKcal).toBe(200);
    expect(credit({ pct: 100 }, rows).countedKcal).toBe(400);
    expect(credit({ pct: 85 }, rows).countedKcal).toBe(340);
  });

  test("off counts nothing but still reports the activity", () => {
    const c = credit({ enabled: false }, rows);
    expect(c.countedKcal).toBe(0);
    expect(c.activeKcal).toBe(400);
    expect(c.capped).toBe(false);
  });

  test("the default cap is 1000; 500 and 1500 cut at their value; none does not cut", () => {
    const big: Row[] = [{ kcal: 2000, source: "manual" }];
    const def = credit({}, big);
    expect(def.countedKcal).toBe(1000);
    expect(def.capped).toBe(true);
    expect(credit({ cap: 500 }, big).countedKcal).toBe(500);
    expect(credit({ cap: 1500 }, big).countedKcal).toBe(1500);
    const free = credit({ cap: "none" }, [{ kcal: 3000, source: "manual" }]);
    expect(free.countedKcal).toBe(2250);
    expect(free.capped).toBe(false);
  });

  test("exactly at the cap is not capped", () => {
    expect(credit({ pct: 100 }, [{ kcal: 1000, source: "manual" }]).capped).toBe(false);
  });

  test("a big all-day total is capped too", () => {
    const c = credit({}, [], 2500);
    expect(c.countedKcal).toBe(1000);
    expect(c.capped).toBe(true);
  });
});

describe("addBackSettings", () => {
  test("nothing stored means the defaults: on, 75%, 1000, no assumption", () => {
    expect(addBackSettings({})).toEqual({ enabled: true, pct: 75, cap: 1000, assumedKcal: 0 });
  });

  test("stored values override, each on its own", () => {
    expect(addBackSettings({ "exercise.addBack.enabled": false, "exercise.addBack.pct": 90, "exercise.assumedActive": 300 })).toEqual({
      enabled: false,
      pct: 90,
      cap: 1000,
      assumedKcal: 300,
    });
  });

  test("a malformed value falls back to its default, the rest stand", () => {
    expect(addBackSettings({ "exercise.addBack.enabled": "no", "exercise.addBack.pct": 33, "exercise.addBack.cap": 1500, "exercise.assumedActive": 200 })).toEqual({
      ...DEFAULT_ADD_BACK_SETTINGS,
      cap: 1500,
    });
  });
});

describe("shiftWorkoutKcal (the optimistic edit)", () => {
  test("a manual workout adds on top of the all-day total", () => {
    const before = credit({}, [], 700);
    const after = shiftWorkoutKcal(before, 200);
    expect(after.activeKcal).toBe(900);
    expect(after.countedKcal).toBe(675);
    expect(shiftWorkoutKcal(after, -200).countedKcal).toBe(before.countedKcal);
  });
});

const LOSE: ProfileInput = {
  birthYear: 1996,
  gender: "male",
  heightCm: 170,
  weightKg: 160,
  targetWeightKg: 150,
  targetDate: "2027-01-16", // 90 days
  activityLevel: "mid",
};

describe("the budget in each mode", () => {
  const rows: Row[] = [{ kcal: 400, source: "manual" }];

  test("loss: base = BMR - deficit; Sisa = base - eaten + counted activity", () => {
    const t = computeTargets(LOSE, { today: TODAY });
    // bmr 2517.5, the whole 856 deficit from food
    expect(t.eatKcal).toBe(1660);
    const c = credit({}, rows);
    const budget = budgetKcal(t.eatKcal, c);
    expect(budget).toBe(1960);
    expect(remainingKcal(budget, 1000)).toEqual({ kcal: 960, over: false });
    expect(remainingKcal(budget, 2100)).toEqual({ kcal: 140, over: true });
  });

  test("loss: the floor holds the base, activity and the assumption sit on top of it", () => {
    const t = computeTargets({ ...LOSE, weightKg: 80, targetWeightKg: 70 }, { today: TODAY });
    expect(t.eatKcal).toBe(1500);
    expect(t.notes).toContain("PLAN_CLAMPED");
    expect(budgetKcal(t.eatKcal, credit({ assumedKcal: 150 }, rows))).toBe(1500 + 150 + 300);
    expect(t.eatKcal).toBeGreaterThanOrEqual(1500);
  });

  test("the female floor is 1200", () => {
    const t = computeTargets({ ...LOSE, gender: "female", heightCm: 150, weightKg: 45, targetWeightKg: 42, targetDate: "2026-11-30" }, { today: TODAY });
    expect(t.eatKcal).toBe(1200);
  });

  test("setting off: the budget is the base", () => {
    const t = computeTargets(LOSE, { today: TODAY });
    expect(budgetKcal(t.eatKcal, credit({ enabled: false }, rows))).toBe(t.eatKcal);
  });

  test("gain: the base is BMR + surplus and real activity raises how much is still to eat", () => {
    const lean: ProfileInput = { ...LOSE, weightKg: 60, targetWeightKg: 66, goal: "gain", targetDate: "2027-04-16" };
    const t = computeTargets(lean, { today: TODAY });
    expect(t.gain).not.toBeNull();
    expect(t.eatKcal).toBe(t.tdee + t.gain!.surplusKcal);
    expect(t.tdee).toBe(1520);
    expect(budgetKcal(t.eatKcal, credit({}, [], 400))).toBe(t.eatKcal + 300);
  });

  test("maternal: the AKG target is the base, activity only ever raises it", () => {
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
    expect(budgetKcal(t.eatKcal, credit({}, []))).toBe(t.eatKcal);
    expect(budgetKcal(t.eatKcal, credit({}, rows))).toBe(t.eatKcal + 300);
    expect(budgetKcal(t.eatKcal, credit({ enabled: false }, rows))).toBe(t.eatKcal);
    expect(budgetKcal(t.eatKcal, credit({ assumedKcal: 150 }, []))).toBe(t.eatKcal + 150);
  });

  test("the maternal base keeps the profile's activity multiplier: no lower than before", () => {
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
