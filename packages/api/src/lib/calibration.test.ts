import { describe, expect, test } from "bun:test";

import {
  CALIBRATION_MAX_SHIFT,
  CALIBRATION_MIN_LOGGED_DAYS,
  CALIBRATION_NOTICE_MIN_KCAL,
  calibrationNotice,
  resolveCalibration,
} from "./calibration";
import { DEFAULT_CALIBRATION_PREFS, readCalibrationPrefs } from "./calibration-store";
import type { CalibrationPrefs } from "./calibration-store";
import { bmrMifflin, movementInFactorKcal, needsBreakdown, shiftDate } from "./engine";
import type { DayKcal, WeighIn } from "./engine";
import { NO_MATERNAL, maternalToRow } from "./maternal";
import { buildPlan } from "./plan";
import type { ProfileRow } from "./plan";

// 2026-10-19 is a Monday: Wed 21, Sun 25, next Monday 26.
const MON = "2026-10-19";
const WED = "2026-10-21";
const SUN = "2026-10-25";
const NEXT_MON = "2026-10-26";

const row = (over: Partial<ProfileRow> = {}): ProfileRow =>
  ({
    userId: "u1",
    birthYear: 1990,
    gender: "male",
    heightCm: 175,
    startWeightKg: 90,
    targetWeightKg: 80,
    targetDate: shiftDate(MON, 3000),
    activityLevel: "light",
    goal: "lose",
    goalStartKg: null,
    ...maternalToRow(NO_MATERNAL),
    ...over,
  }) as ProfileRow;

// Constant weight, so the slope is 0 and the measured TDEE is the average logged intake (minus logged workouts).
const weighIns = (date: string, spanDays = 60): WeighIn[] =>
  Array.from({ length: Math.floor(spanDays / 3) + 1 }, (_, i) => ({ date: shiftDate(date, -1 - i * 3), weightKg: 90 })).sort(
    (a, b) => a.date.localeCompare(b.date),
  );
const intake = (date: string, kcalOn: (day: string) => number, days = 34): DayKcal[] =>
  Array.from({ length: days }, (_, i) => ({ date: shiftDate(date, -1 - i), kcal: kcalOn(shiftDate(date, -1 - i)) }));

const history = (date: string, kcal: number | ((day: string) => number), over: Partial<Parameters<typeof buildPlan>[1]> = {}) => ({
  latestWeightKg: 90,
  weighIns: weighIns(date),
  intake: intake(date, typeof kcal === "number" ? () => kcal : kcal),
  exercise: [] as DayKcal[],
  prefs: DEFAULT_CALIBRATION_PREFS,
  ...over,
});

const BMR = bmrMifflin(90, 175, 2026 - 1990, "male");
const FORMULA_TDEE = Math.round(BMR * 1.375);

describe("the formula until the data is good", () => {
  test("no history: formula target, calibration collecting with its progress", () => {
    const plan = buildPlan(row(), history(WED, 2800, { intake: [], weighIns: [] }), WED);
    expect(plan.targets.tdee).toBe(FORMULA_TDEE);
    expect(plan.targets.calibration).toMatchObject({
      enabled: true,
      status: "collecting",
      loggedDays: 0,
      loggedDaysNeeded: 20,
      spanDays: 0,
      spanDaysNeeded: 21,
      usedKcal: null,
      measuredKcal: null,
      formulaKcal: FORMULA_TDEE,
    });
  });

  test("19 logged days of 28 is not enough, 20 is", () => {
    const at = (days: number) => buildPlan(row(), history(MON, 2800, { intake: intake(MON, () => 2800, days) }), MON);
    expect(at(CALIBRATION_MIN_LOGGED_DAYS - 1).targets.calibration).toMatchObject({ status: "collecting", loggedDays: 19 });
    expect(at(CALIBRATION_MIN_LOGGED_DAYS).targets.calibration).toMatchObject({ status: "active", loggedDays: 20 });
  });

  test("weigh-ins spanning 18 days are not enough, 21 are", () => {
    const at = (span: number) => buildPlan(row(), history(MON, 2800, { weighIns: weighIns(MON, span) }), MON);
    expect(at(18).targets.calibration?.status).toBe("collecting");
    expect(at(21).targets.calibration?.status).toBe("active");
  });
});

describe("calibrated", () => {
  test("the measured TDEE builds the target: tdee, base and the movement the TDEE holds follow it", () => {
    const formula = buildPlan(row(), history(MON, 2800, { prefs: { enabled: false, seenKcal: null } }), MON).targets;
    const plan = buildPlan(row(), history(MON, 2800), MON);
    const t = plan.targets;
    expect(2800).toBeLessThanOrEqual(FORMULA_TDEE * (1 + CALIBRATION_MAX_SHIFT));
    expect(t.calibration).toMatchObject({ status: "active", measuredKcal: 2800, usedKcal: 2800, clamped: false, formulaKcal: FORMULA_TDEE });
    expect(t.tdee).toBe(2800);
    // loss: base = round5(TDEE - deficit); the deficit (the 250 floor here) and the plan's floor are unchanged
    expect(t.eatKcal).toBe(2550);
    expect(formula.eatKcal).toBe(2250);
    expect(t.eatKcal - formula.eatKcal).toBeGreaterThan(250);
    expect(t.deficitKcal).toBe(formula.deficitKcal);
    // no double counting: the movement the budget already holds is derived from the calibrated TDEE
    expect(t.includedKcal).toBe(Math.round(movementInFactorKcal(2800, BMR)));
    expect(t.includedKcal).toBeGreaterThan(formula.includedKcal);
    expect(t.factor).toBe(1.375);
  });

  test("logged workouts come out of the measurement once (non-Strava rows only, the caller's query)", () => {
    const exercise = intake(MON, () => 280, 28);
    const plan = buildPlan(row(), history(MON, 2800, { exercise }), MON);
    // measured 2800 - 280 a day outside logged workouts
    expect(plan.targets.calibration).toMatchObject({ measuredKcal: 2520, avgWorkoutKcal: 280 });
    expect(plan.targets.tdee).toBe(2520);
  });

  test("clamped at +15% of the formula", () => {
    const plan = buildPlan(row(), history(MON, 4200), MON);
    const cap = Math.round(FORMULA_TDEE * (1 + CALIBRATION_MAX_SHIFT));
    expect(plan.targets.calibration).toMatchObject({ measuredKcal: 4200, usedKcal: cap, clamped: true });
    expect(plan.targets.tdee).toBe(cap);
  });

  test("clamped at -15% of the formula", () => {
    const plan = buildPlan(row(), history(MON, 1500), MON);
    const floor = Math.round(FORMULA_TDEE * (1 - CALIBRATION_MAX_SHIFT));
    expect(plan.targets.calibration).toMatchObject({ measuredKcal: 1500, usedKcal: floor, clamped: true });
    expect(plan.targets.tdee).toBe(floor);
  });

  test("the gain plan builds on the calibrated TDEE too", () => {
    const gain = row({ goal: "gain", startWeightKg: 90, targetWeightKg: 98, goalStartKg: 90 });
    const off = buildPlan(gain, history(MON, 2800, { prefs: { enabled: false, seenKcal: null } }), MON).targets;
    const on = buildPlan(gain, history(MON, 2800), MON).targets;
    expect(off.gain).not.toBeNull();
    expect(on.eatKcal - off.eatKcal).toBeGreaterThan(250);
    expect(on.gain!.surplusKcal).toBe(off.gain!.surplusKcal);
  });

  test("the formula numbers stay on the plan for the notice", () => {
    const plan = buildPlan(row(), history(MON, 2800), MON);
    const formula = buildPlan(row(), history(MON, 2800, { prefs: { enabled: false, seenKcal: null } }), MON);
    expect(plan.formulaEatKcal).toBe(formula.targets.eatKcal);
  });
});

describe("switched off", () => {
  test("the pure level formula, whatever the data says; the measurement is still shown as what it would be", () => {
    const off: CalibrationPrefs = { enabled: false, seenKcal: null };
    const plan = buildPlan(row(), history(MON, 2800, { prefs: off }), MON);
    expect(plan.targets.tdee).toBe(FORMULA_TDEE);
    expect(plan.targets.includedKcal).toBe(Math.round(movementInFactorKcal(BMR * 1.375, BMR)));
    expect(plan.targets.calibration).toMatchObject({ enabled: false, status: "off", usedKcal: null, measuredKcal: 2800, clamped: false });
    const plain = buildPlan(row(), history(MON, 2800, { intake: [], weighIns: [], prefs: off }), MON);
    expect(plan.targets.eatKcal).toBe(plain.targets.eatKcal);
  });

  test("the preference rows: default on, false turns it off, garbage and tombstones are the default", () => {
    const doc = (value: unknown) => JSON.stringify({ value });
    expect(readCalibrationPrefs([])).toEqual({ enabled: true, seenKcal: null });
    expect(readCalibrationPrefs([{ id: "energy.calibration", json: doc(false) }]).enabled).toBe(false);
    expect(readCalibrationPrefs([{ id: "energy.calibration", json: doc("no") }]).enabled).toBe(true);
    expect(readCalibrationPrefs([{ id: "energy.calibration", json: "not json" }]).enabled).toBe(true);
    expect(readCalibrationPrefs([{ id: "energy.calibrationSeen", json: doc(1785) }]).seenKcal).toBe(1785);
    expect(readCalibrationPrefs([{ id: "energy.calibrationSeen", json: doc(12.5) }]).seenKcal).toBeNull();
  });
});

describe("Hamil / Menyusui", () => {
  test("no calibration, however good the data is: the AKG target is untouched", () => {
    const mom = row({
      gender: "female",
      maternalMode: "pregnant",
      pregnancyLmp: shiftDate(MON, -100),
      pregnancyDateKind: "hpht",
      prePregnancyWeightKg: 60,
    });
    const rich = buildPlan(mom, history(MON, 2800), MON);
    const bare = buildPlan(mom, history(MON, 2800, { intake: [], weighIns: [] }), MON);
    expect(rich.calibration).toBeNull();
    expect(rich.targets.calibration ?? null).toBeNull();
    expect(rich.targets).toEqual(bare.targets);
  });
});

describe("held weekly", () => {
  // Days from Monday on are logged at a very different level; the Monday window must not see them.
  const kcalFor = (day: string) => (day >= MON ? 4000 : 2800);
  const at = (date: string, over: Partial<Parameters<typeof buildPlan>[1]> = {}) =>
    buildPlan(row(), history(date, kcalFor, over), date).targets;

  test("Monday to Sunday the same calibrated TDEE and target, whatever is logged in between", () => {
    const monday = at(MON);
    for (const date of ["2026-10-20", WED, "2026-10-22", "2026-10-23", "2026-10-24", SUN]) {
      const t = at(date);
      expect(t.tdee).toBe(monday.tdee);
      expect(t.calibration).toMatchObject({ status: "active", anchorDate: MON, nextDate: NEXT_MON, measuredKcal: 2800 });
      expect(t.eatKcal).toBe(monday.eatKcal);
    }
  });

  test("the next Monday measures again and moves", () => {
    const t = at(NEXT_MON);
    expect(t.calibration).toMatchObject({ anchorDate: NEXT_MON });
    expect(t.tdee).toBeGreaterThan(2800);
  });

  test("data that is good today but was not at the Monday waits for next Monday", () => {
    // 20 logged days before Wednesday, 18 of them before the Monday; weigh-ins spanning 21 days back from Tuesday
    const plan = buildPlan(
      row(),
      history(WED, 2800, { intake: intake(WED, () => 2800, 20), weighIns: weighIns(WED, 21) }),
      WED,
    );
    expect(plan.targets.calibration).toMatchObject({ status: "waiting", loggedDays: 20, usedKcal: null, anchorDate: MON });
    expect(plan.targets.tdee).toBe(FORMULA_TDEE);
    const monday = buildPlan(row(), history(NEXT_MON, 2800, { intake: intake(NEXT_MON, () => 2800, 27), weighIns: weighIns(NEXT_MON, 27) }), NEXT_MON);
    expect(monday.targets.calibration?.status).toBe("active");
  });
});

describe("resolveCalibration on its own", () => {
  test("the guard is relative to the formula passed in", () => {
    const r = resolveCalibration({
      enabled: true,
      date: MON,
      weighIns: weighIns(MON),
      intake: intake(MON, () => 5000),
      exercise: [],
      formulaKcal: 2000,
    });
    expect(r.tdeeKcal).toBe(2300);
    expect(r.info.clamped).toBe(true);
  });
});

describe("the legacy fields old clients read", () => {
  test("formulaTdee equals tdee and assumedKcal is 0, calibrated or not; new fields are additive", () => {
    for (const prefs of [DEFAULT_CALIBRATION_PREFS, { enabled: false, seenKcal: null }]) {
      const t = buildPlan(row(), history(MON, 2800, { prefs }), MON).targets;
      expect(t.formulaTdee).toBe(t.tdee);
      expect(t.assumedKcal).toBe(0);
      expect(t.notes).not.toContain("ADAPTIVE" as never);
      // the sums an old needs sheet does still hold: bmr + (tdee - bmr) = tdee, tdee - cut = base
      const needs = needsBreakdown(t);
      expect(needs.bmrKcal + needs.activityKcal).toBe(needs.tdeeKcal);
      expect(needs.tdeeKcal - needs.cutKcal).toBe(needs.targetKcal);
    }
  });
});

describe("the Beranda notice", () => {
  const active = buildPlan(row(), history(MON, 2800), MON);
  const input = (over: Partial<Parameters<typeof calibrationNotice>[0]> = {}) => ({
    calibration: active.calibration,
    baseKcal: active.targets.eatKcal,
    formulaBaseKcal: active.formulaEatKcal,
    seenKcal: null,
    ...over,
  });

  test("before anything was acknowledged it compares with the formula target the person had", () => {
    expect(calibrationNotice(input())).toEqual({ fromKcal: active.formulaEatKcal, toKcal: active.targets.eatKcal });
  });

  test("an acknowledged figure close to today's (under 50 kcal) says nothing", () => {
    expect(calibrationNotice(input({ seenKcal: active.targets.eatKcal - (CALIBRATION_NOTICE_MIN_KCAL - 5) }))).toBeNull();
    expect(calibrationNotice(input({ seenKcal: active.targets.eatKcal }))).toBeNull();
  });

  test("from 50 kcal it speaks, old to new", () => {
    expect(calibrationNotice(input({ seenKcal: active.targets.eatKcal - CALIBRATION_NOTICE_MIN_KCAL }))).toEqual({
      fromKcal: active.targets.eatKcal - CALIBRATION_NOTICE_MIN_KCAL,
      toKcal: active.targets.eatKcal,
    });
  });

  test("only while calibrated", () => {
    const off = buildPlan(row(), history(MON, 2800, { prefs: { enabled: false, seenKcal: null } }), MON);
    expect(calibrationNotice(input({ calibration: off.calibration }))).toBeNull();
    expect(calibrationNotice(input({ calibration: null }))).toBeNull();
  });
});
