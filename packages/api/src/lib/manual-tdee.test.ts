import { describe, expect, test } from "bun:test";

import { DEFAULT_CALIBRATION_PREFS } from "./calibration-store";
import { bmrMifflin, computeTargets, shiftDate } from "./engine";
import type { DayKcal, WeighIn } from "./engine";
import { MANUAL_TDEE_MAX_KCAL, MANUAL_TDEE_MIN_KCAL, manualTdeeWarning } from "./manual-tdee";
import { NO_MATERNAL, maternalToRow } from "./maternal";
import { buildPlan } from "./plan";
import type { ProfileRow } from "./plan";
import { manualTdeeKcalSchema } from "./schemas";

// 2026-10-19 is a Monday; Wed 21 sits inside that week.
const MON = "2026-10-19";
const WED = "2026-10-21";

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
    manualTdeeKcal: null,
    manualTdeeSetAt: null,
    manualTdeeDismissedOn: null,
    ...maternalToRow(NO_MATERNAL),
    ...over,
  }) as ProfileRow;

const weighIns = (date: string): WeighIn[] =>
  Array.from({ length: 21 }, (_, i) => ({ date: shiftDate(date, -1 - i * 3), weightKg: 90 })).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
const intake = (date: string, kcalOn: (day: string) => number): DayKcal[] =>
  Array.from({ length: 41 }, (_, i) => ({ date: shiftDate(date, -1 - i), kcal: kcalOn(shiftDate(date, -1 - i)) }));
const history = (kcal: number | ((day: string) => number), over: Partial<Parameters<typeof buildPlan>[1]> = {}) => ({
  latestWeightKg: 90,
  weighIns: weighIns(WED),
  intake: intake(WED, typeof kcal === "number" ? () => kcal : kcal),
  exercise: [] as DayKcal[],
  prefs: DEFAULT_CALIBRATION_PREFS,
  ...over,
});
const none = { intake: [] as DayKcal[], weighIns: [] as WeighIn[] };

const BMR = bmrMifflin(90, 175, 2026 - 1990, "male");
const FORMULA_TDEE = Math.round(BMR * 1.375);

describe("the typed TDEE is the base of the plan", () => {
  test("goal pace, rounding and the info block ride on top of it", () => {
    const computed = buildPlan(row(), history(2800, none), WED);
    const plan = buildPlan(row({ manualTdeeKcal: 2250 }), history(2800, none), WED);
    expect(plan.targets.tdee).toBe(2250);
    expect(plan.targets.formulaTdee).toBe(2250);
    // the same deficit as the computed plan, on a different base
    expect(plan.targets.deficitKcal).toBe(computed.targets.deficitKcal);
    expect(plan.targets.eatKcal).toBe(Math.round((2250 - plan.targets.deficitKcal) / 5) * 5);
    expect(plan.targets.manualTdee).toMatchObject({
      kcal: 2250,
      computedKcal: FORMULA_TDEE,
      bmrKcal: Math.round(BMR),
      diffKcal: 2250 - FORMULA_TDEE,
      warning: null,
      suggestion: null,
    });
    expect(plan.targets.includedKcal).toBeLessThan(computed.targets.includedKcal);
  });

  test("not set: the computed plan, info present with kcal null", () => {
    const plan = buildPlan(row(), history(2800, none), WED);
    expect(plan.targets.tdee).toBe(FORMULA_TDEE);
    expect(plan.targets.manualTdee).toMatchObject({ kcal: null, diffKcal: null, computedKcal: FORMULA_TDEE });
  });

  test("the minimum-intake floor still holds on a low typed TDEE", () => {
    const plan = buildPlan(row({ manualTdeeKcal: 1300 }), history(2800, none), WED);
    expect(plan.targets.eatKcal).toBeGreaterThanOrEqual(1500);
    expect(plan.targets.notes).toContain("PLAN_CLAMPED");
  });

  test("gain: the surplus goes on top of the typed TDEE", () => {
    const base = row({ goal: "gain", startWeightKg: 60, targetWeightKg: 66, targetDate: shiftDate(MON, 200) });
    const h = history(2800, { ...none, latestWeightKg: 60 });
    const computed = buildPlan(base, h, WED);
    const manual = buildPlan({ ...base, manualTdeeKcal: 2600 }, h, WED);
    expect(manual.targets.gain).not.toBeNull();
    expect(manual.targets.eatKcal).toBe(2600 + manual.targets.gain!.surplusKcal);
    expect(manual.targets.gain!.surplusKcal).toBe(computed.targets.gain!.surplusKcal);
  });

  test("maternal: the AKG addition goes on top of the typed TDEE", () => {
    const maternal = maternalToRow({
      ...NO_MATERNAL,
      mode: "pregnant",
      pregnancyLmp: shiftDate(MON, -150),
    } as never);
    const base = row({ gender: "female", ...maternal });
    const computed = buildPlan(base, history(2000, none), WED);
    const manual = buildPlan({ ...base, manualTdeeKcal: 2100 }, history(2000, none), WED);
    expect(manual.targets.maternal!.baseKcal).toBe(2100);
    expect(manual.targets.eatKcal).toBe(2100 + manual.targets.maternal!.addKcal);
    expect(manual.targets.maternal!.addKcal).toBe(computed.targets.maternal!.addKcal);
    expect(manual.targets.manualTdee?.kcal).toBe(2100);
    expect(manual.targets.manualTdee?.suggestion).toBeNull();
  });

  test("computeTargets takes it straight (the engine seam)", () => {
    const profile = { birthYear: 1990, gender: "male" as const, heightCm: 175, weightKg: 90, targetWeightKg: 90, targetDate: "2027-01-01", activityLevel: "light" as const };
    expect(computeTargets(profile, { today: WED, tdeeKcal: 2250 }).eatKcal).toBe(2250);
  });
});

describe("warnings never block", () => {
  test("below the BMR, and above 1.5 x the computed TDEE", () => {
    expect(manualTdeeWarning(1700, 1850, 2550)).toBe("BELOW_BMR");
    expect(manualTdeeWarning(3900, 1850, 2550)).toBe("ABOVE_RANGE");
    expect(manualTdeeWarning(2250, 1850, 2550)).toBeNull();
    const plan = buildPlan(row({ manualTdeeKcal: 1500 }), history(2800, none), WED);
    expect(plan.targets.manualTdee?.warning).toBe("BELOW_BMR");
    expect(plan.targets.tdee).toBe(1500);
  });
});

describe("router validation", () => {
  test("whole kcal between 1000 and 6000", () => {
    expect(manualTdeeKcalSchema.safeParse(MANUAL_TDEE_MIN_KCAL).success).toBe(true);
    expect(manualTdeeKcalSchema.safeParse(MANUAL_TDEE_MAX_KCAL).success).toBe(true);
    expect(manualTdeeKcalSchema.safeParse(999).success).toBe(false);
    expect(manualTdeeKcalSchema.safeParse(6001).success).toBe(false);
    expect(manualTdeeKcalSchema.safeParse(2250.5).success).toBe(false);
    expect(manualTdeeKcalSchema.safeParse("2250").success).toBe(false);
  });
});

describe("calibration only suggests", () => {
  // Weight flat, so the measured TDEE is the average logged intake: `kcalOn` is the measurement of each week.
  const typed = (manual: number, kcal: number | ((day: string) => number), over: Partial<Parameters<typeof buildPlan>[1]> = {}, rowOver: Partial<ProfileRow> = {}) =>
    buildPlan(row({ manualTdeeKcal: manual, ...rowOver }), history(kcal, over), WED);

  test("never changes the number: tdee stays typed, status manual, nothing used", () => {
    const plan = typed(2250, 3000);
    expect(plan.targets.tdee).toBe(2250);
    expect(plan.targets.calibration).toMatchObject({ status: "manual", usedKcal: null, measuredKcal: 3000 });
  });

  test("2 weeks in a row more than 10% off: suggestion with the observed estimate", () => {
    const plan = typed(2250, 3000);
    expect(plan.targets.manualTdee?.suggestion).toEqual({ kcal: 3000, weeks: 2 });
    expect(plan.targets.tdee).toBe(2250);
  });

  test("below the typed number counts too", () => {
    expect(typed(3000, 2400).targets.manualTdee?.suggestion).toEqual({ kcal: 2400, weeks: 2 });
  });

  test("within 10%: no suggestion", () => {
    expect(typed(2250, 2400).targets.manualTdee?.suggestion).toBeNull();
  });

  test("only the latest week off: no suggestion yet", () => {
    // the last 7 days before the Monday are heavy: that Monday's window averages ~2810 (25% over 2250), the Monday
    // before's still 2250
    const lastWeekHeavy = (day: string) => (day >= shiftDate(MON, -7) ? 4500 : 2250);
    const plan = typed(2250, lastWeekHeavy);
    expect(plan.targets.calibration?.measuredKcal).toBeGreaterThan(2250 * 1.1);
    expect(plan.targets.manualTdee?.suggestion).toBeNull();
  });

  test("the week after the second heavy week it does suggest, with the latest measurement", () => {
    const twoWeeksHeavy = (day: string) => (day >= shiftDate(MON, -14) ? 4500 : 2250);
    // Monday's window: 14 of 28 days heavy -> 3375 (+50%); the Monday before: 7 of 28 -> 2812 (+25%)
    expect(typed(2250, twoWeeksHeavy).targets.manualTdee?.suggestion).toEqual({
      kcal: Math.round((14 * 2250 + 14 * 4500) / 28),
      weeks: 2,
    });
  });

  test("calibration switched off: no suggestion", () => {
    const plan = typed(2250, 3000, { prefs: { enabled: false, seenKcal: null } });
    expect(plan.targets.manualTdee?.suggestion).toBeNull();
    expect(plan.targets.calibration?.status).toBe("manual");
  });

  test("Biarkan holds it back 28 days, then it may return", () => {
    expect(typed(2250, 3000, {}, { manualTdeeDismissedOn: shiftDate(WED, -3) }).targets.manualTdee?.suggestion).toBeNull();
    expect(typed(2250, 3000, {}, { manualTdeeDismissedOn: shiftDate(WED, -27) }).targets.manualTdee?.suggestion).toBeNull();
    expect(typed(2250, 3000, {}, { manualTdeeDismissedOn: shiftDate(WED, -28) }).targets.manualTdee?.suggestion).toEqual({
      kcal: 3000,
      weeks: 2,
    });
  });

  test("not enough data: no suggestion", () => {
    expect(typed(2250, 3000, { ...none }).targets.manualTdee?.suggestion).toBeNull();
  });
});
