import { describe, expect, test } from "bun:test";

import { computeTargets, remainingKcal } from "./engine";
import type { ProfileInput } from "./engine";
import {
  ALL_DAY_MAX_KCAL,
  DEFAULT_ADD_BACK_SETTINGS,
  addBackSettings,
  allDayActive,
  budgetKcal,
  dayActiveKcal,
  exerciseCredit,
  shiftWorkoutKcal,
} from "./exercise-credit";
import type { AddBackSettings, AllDayReading } from "./exercise-credit";
import { computeMaternalTargets } from "./maternal";
import type { MaternalState } from "./maternal";

const TODAY = "2026-10-18";
const settings = (patch: Partial<AddBackSettings> = {}): AddBackSettings => ({ ...DEFAULT_ADD_BACK_SETTINGS, ...patch });
type Row = { kcal: number; source?: string; externalId?: string };
// `included` is the movement the person's factor already contains; 0 (a bare BMR plan) unless a test is about the factor.
const credit = (
  patch: Partial<AddBackSettings>,
  rows: Row[],
  watch: number | null = null,
  steps: number | null = null,
  extra: AllDayReading[] = [],
  included = 0,
) =>
  exerciseCredit({
    settings: settings(patch),
    rows,
    readings: [{ source: "joyofit", kcal: watch }, ...extra],
    steps,
    includedKcal: included,
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

  test("a broken watch reading means the recorded workouts count", () => {
    const c = credit({}, [{ kcal: 200, source: "joyofit" }], 9000, null, [], 250);
    expect(c.allDayKcal).toBeNull();
    expect(c.activeKcal).toBe(200);
    expect(c.extraKcal).toBe(200);
  });
});

describe("activity only raises the target: what counts is what goes beyond the factor", () => {
  // A person whose factor already contains 400 kcal of movement.
  const INCLUDED = 400;

  test("measured movement below what the factor contains adds nothing (a phone left on a desk logs ~10 kcal)", () => {
    const desk = credit({}, [], null, 40, [{ source: "health_connect", kcal: 10 }], INCLUDED);
    expect(desk.allDayKcal).toBe(10);
    expect(desk.extraKcal).toBe(0);
    expect(desk.countedKcal).toBe(0);
    expect(budgetKcal(1800, desk)).toBe(1800);
    // exactly at the included movement: still nothing
    expect(credit({}, [], 400, null, [], INCLUDED).countedKcal).toBe(0);
  });

  test("only what goes beyond the included movement is counted, pct of it", () => {
    const c = credit({}, [], 900, null, [], INCLUDED);
    expect(c.activeKcal).toBe(900);
    expect(c.includedKcal).toBe(INCLUDED);
    expect(c.extraKcal).toBe(500);
    expect(c.countedKcal).toBe(375);
    expect(budgetKcal(1800, c)).toBe(2175);
  });

  test("a day below the factor never lowers the budget: counted is never negative", () => {
    for (const watch of [1, 100, 399, 400]) {
      const c = credit({}, [], watch, null, [], INCLUDED);
      expect(c.countedKcal).toBe(0);
      expect(budgetKcal(1800, c)).toBeGreaterThanOrEqual(1800);
    }
  });

  test("workouts outside the all-day total still count in full (x pct), even on a low all-day day", () => {
    // all-day 200 (below the factor): nothing from it. A manual 300 and a Strava 100 are on top.
    const c = credit(
      {},
      [{ kcal: 300, source: "manual" }, { kcal: 100, source: "strava" }, { kcal: 150, source: "joyofit", externalId: "watch:1" }],
      200,
      null,
      [],
      INCLUDED,
    );
    expect(c.extraKcal).toBe(400);
    expect(c.countedKcal).toBe(300);
  });

  test("a JoyoFit strength row without the watch's total counts on top of the factor", () => {
    const c = credit({}, [{ kcal: 200, source: "joyofit", externalId: "strength:9" }], null, null, [{ source: "health_connect", kcal: 100 }], INCLUDED);
    expect(c.extraKcal).toBe(200);
    expect(c.countedKcal).toBe(150);
  });

  test("no all-day reading: recorded device workouts count as today (x pct), the factor is not taken off them", () => {
    const c = credit({}, [{ kcal: 300, source: "joyofit", externalId: "watch:1" }, { kcal: 100, source: "health_connect" }], null, null, [], INCLUDED);
    expect(c.allDayKcal).toBeNull();
    expect(c.extraKcal).toBe(400);
    expect(c.countedKcal).toBe(300);
  });

  test("a broken (glitch) reading is ignored: no all-day total, no matter how large the included movement", () => {
    const c = credit({}, [], 9000, null, [], INCLUDED);
    expect(c.allDayKcal).toBeNull();
    expect(c.countedKcal).toBe(0);
  });

  test("applies to phone-only Health data and to watches alike (the source does not change the rule)", () => {
    const phone = credit({}, [], null, 9000, [{ source: "health_connect", kcal: 700 }], INCLUDED);
    const watch = credit({}, [], 700, null, [], INCLUDED);
    expect(phone.countedKcal).toBe(watch.countedKcal);
    expect(phone.allDaySource).toBe("health_connect");
    expect(watch.allDaySource).toBe("joyofit");
  });

  test("the switch off counts nothing, extra is still reported", () => {
    const c = credit({ enabled: false }, [], 900, null, [], INCLUDED);
    expect(c.extraKcal).toBe(500);
    expect(c.countedKcal).toBe(0);
  });

  test("the cap and pct apply to the extra, not to the whole day", () => {
    const c = credit({ cap: 500, pct: 100 }, [], 2000, null, [], INCLUDED);
    expect(c.extraKcal).toBe(1600);
    expect(c.countedKcal).toBe(500);
    expect(c.capped).toBe(true);
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
  test("nothing stored means the defaults: on, 75%, 1000", () => {
    expect(addBackSettings({})).toEqual({ enabled: true, pct: 75, cap: 1000 });
  });

  test("stored values override, each on its own", () => {
    expect(addBackSettings({ "exercise.addBack.enabled": false, "exercise.addBack.pct": 90 })).toEqual({
      enabled: false,
      pct: 90,
      cap: 1000,
    });
  });

  test("a malformed value falls back to its default, the rest stand", () => {
    expect(addBackSettings({ "exercise.addBack.enabled": "no", "exercise.addBack.pct": 33, "exercise.addBack.cap": 1500 })).toEqual({
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

  test("the included movement stays out of the extra after the edit", () => {
    const before = credit({}, [], 700, null, [], 400);
    expect(before.extraKcal).toBe(300);
    const after = shiftWorkoutKcal(before, 200);
    expect(after.extraKcal).toBe(500);
    expect(after.countedKcal).toBe(375);
    // a day below the factor with no workout: the first manual workout is all extra
    const desk = credit({}, [], 10, null, [], 400);
    expect(shiftWorkoutKcal(desk, 200).countedKcal).toBe(150);
  });
});

const LOSE: ProfileInput = {
  birthYear: 1996,
  gender: "male",
  heightCm: 170,
  weightKg: 160,
  targetWeightKg: 150,
  targetDate: "2027-01-16", // 90 days
  activityLevel: "light",
};

describe("the budget in each mode", () => {
  const rows: Row[] = [{ kcal: 400, source: "manual" }];

  test("loss: base = TDEE - deficit; Sisa = base - eaten + counted activity", () => {
    const t = computeTargets(LOSE, { today: TODAY });
    // bmr 2517.5 x 1.375 (light) = 3461.6, the whole 856 deficit from food
    expect(t.tdee).toBe(3462);
    expect(t.eatKcal).toBe(2605);
    const c = credit({}, rows, null, null, [], t.includedKcal);
    const budget = budgetKcal(t.eatKcal, c);
    expect(budget).toBe(2905);
    expect(remainingKcal(budget, 1000)).toEqual({ kcal: 1905, over: false });
    expect(remainingKcal(budget, 3000)).toEqual({ kcal: 95, over: true });
  });

  test("loss: the floor holds the base, activity sits on top of it", () => {
    const t = computeTargets({ ...LOSE, weightKg: 80, targetWeightKg: 70, activityLevel: "sedentary" }, { today: TODAY });
    // 1717.5 x 1.2 = 2061, less 856 is under the male floor
    expect(t.eatKcal).toBe(1500);
    expect(t.notes).toContain("PLAN_CLAMPED");
    expect(budgetKcal(t.eatKcal, credit({}, rows, null, null, [], t.includedKcal))).toBe(1500 + 300);
  });

  test("the female floor is 1200", () => {
    const t = computeTargets({ ...LOSE, gender: "female", heightCm: 150, weightKg: 45, targetWeightKg: 42, targetDate: "2026-11-30" }, { today: TODAY });
    expect(t.eatKcal).toBe(1200);
  });

  test("setting off: the budget is the base", () => {
    const t = computeTargets(LOSE, { today: TODAY });
    expect(budgetKcal(t.eatKcal, credit({ enabled: false }, rows))).toBe(t.eatKcal);
  });

  test("gain: the base is TDEE + surplus and real activity beyond the factor raises how much is still to eat", () => {
    const lean: ProfileInput = { ...LOSE, weightKg: 60, targetWeightKg: 66, goal: "gain", targetDate: "2027-04-16" };
    const t = computeTargets(lean, { today: TODAY });
    expect(t.gain).not.toBeNull();
    expect(t.eatKcal).toBe(t.tdee + t.gain!.surplusKcal);
    expect(t.tdee).toBe(2085);
    expect(budgetKcal(t.eatKcal, credit({}, [], 800, null, [], t.includedKcal))).toBe(
      t.eatKcal + Math.round((800 - t.includedKcal) * 0.75),
    );
    // a quiet day changes nothing
    expect(budgetKcal(t.eatKcal, credit({}, [], 100, null, [], t.includedKcal))).toBe(t.eatKcal);
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
    expect(t.level).toBe("light");
    expect(t.factor).toBe(1.35); // the maternal factor of the level migrated from "mid", not 1.375
    expect(budgetKcal(t.eatKcal, credit({}, [], null, null, [], t.includedKcal))).toBe(t.eatKcal);
    expect(budgetKcal(t.eatKcal, credit({}, rows, null, null, [], t.includedKcal))).toBe(t.eatKcal + 300);
    expect(budgetKcal(t.eatKcal, credit({ enabled: false }, rows, null, null, [], t.includedKcal))).toBe(t.eatKcal);
  });

  test("the maternal base keeps its own multiplier for the migrated level (1.45 for moderate): no lower than before", () => {
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
    const profile = { ...LOSE, gender: "female" as const, weightKg: 60, activityLevel: "moderate" as const };
    const t = computeMaternalTargets(profile, state, { today: TODAY, weightNow: 60 });
    const bmr = 10 * 60 + 6.25 * 170 - 5 * 30 - 161;
    expect(t.maternal!.baseKcal).toBe(Math.round((bmr * 1.45) / 5) * 5);
  });
});

describe("dayActiveKcal: the ring of the exercise screens", () => {
  const rowsKcal = (rows: Row[]) => rows.reduce((sum, row) => sum + row.kcal, 0);

  test("18 Okt (JoyoFit pushed 4 watch workouts and the day's 418 kcal, Apple Health read 13): the ring is the all-day total, not the 269 of the rows", () => {
    const rows = [
      { kcal: 143, source: "joyofit", externalId: "watch:1792283744" },
      { kcal: 17, source: "joyofit", externalId: "watch:1792316333" },
      { kcal: 27, source: "joyofit", externalId: "watch:1792318308" },
      { kcal: 82, source: "joyofit", externalId: "watch:1792318704" },
    ];
    const c = credit({}, rows, 418, 586, [{ source: "apple_health", kcal: 13 }]);
    expect(rowsKcal(rows)).toBe(269);
    expect(c.allDaySource).toBe("joyofit");
    expect(dayActiveKcal(c, rowsKcal(rows))).toBe(418);
    expect(c.countedKcal).toBe(314);
  });

  test("15 Okt: the ring is the 254 measured, not the 1121 of the two imported walks", () => {
    const rows = [{ kcal: 471, source: "apple_health" }, { kcal: 650, source: "apple_health" }];
    const c = credit({}, rows, null, 4972, [{ source: "apple_health", kcal: 254 }]);
    expect(dayActiveKcal(c, rowsKcal(rows))).toBe(254);
  });

  test("a manual row the watch does not know about adds to the ring, like it adds to the budget", () => {
    const rows = [{ kcal: 143, source: "joyofit", externalId: "watch:1" }, { kcal: 100, source: "manual" }];
    expect(dayActiveKcal(credit({}, rows, 418), rowsKcal(rows))).toBe(518);
  });

  test("without the day's credit (loading, no profile) it is the sum of the rows", () => {
    expect(dayActiveKcal(null, 269)).toBe(269);
    expect(dayActiveKcal(undefined, 0)).toBe(0);
  });

  test("nothing recorded and no all-day data: zero", () => {
    expect(dayActiveKcal(credit({}, []), 0)).toBe(0);
  });
});
