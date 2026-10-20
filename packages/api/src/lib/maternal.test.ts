import { describe, expect, test } from "bun:test";

import { DEFAULT_CALIBRATION_PREFS } from "./calibration-store";

import { MATERNAL_ACTIVITY_FACTOR, bmrMifflin, computeTargets, shiftDate } from "./engine";
import type { ProfileInput } from "./engine";
import { caffeineMgFor } from "./intake";
import {
  AKG_LACTATION_KCAL,
  AKG_PREGNANCY_KCAL,
  CAFFEINE_LIMIT_MG,
  IOM_SINGLETON_KG,
  IOM_TWINS_KG,
  NO_MATERNAL,
  babyAgeMonths,
  bmiCategory,
  birthDateFromAgeMonths,
  caffeineOfDay,
  computeMaternalTargets,
  dueDateFromLmp,
  foodFlagsFor,
  gainBand,
  gainStatus,
  gestationalAge,
  lmpFromDueDate,
  maternalFromRow,
  maternalNoteFor,
  maternalNutrient,
  maternalToRow,
  resolveMaternalInput,
  weightGainChart,
  weightGainPlan,
} from "./maternal";
import type { MaternalState } from "./maternal";
import { buildPlan } from "./plan";
import type { ProfileRow } from "./plan";

const TODAY = "2026-10-18";

const profile: ProfileInput = {
  birthYear: 2000, // 26 on TODAY
  gender: "female",
  heightCm: 160,
  weightKg: 62, // current weight, above the pre-pregnancy 55
  targetWeightKg: 50, // an old weight-loss target must never matter in these modes
  targetDate: "2026-12-18",
  activityLevel: "light",
};

const pregnantAt = (days: number, extra: Partial<MaternalState> = {}): MaternalState => ({
  ...NO_MATERNAL,
  mode: "pregnant",
  pregnancyLmp: shiftDate(TODAY, -days),
  pregnancyDateKind: "hpht",
  prePregnancyWeightKg: 55,
  ...extra,
});

const breastfeeding = (months: number, extra: Partial<MaternalState> = {}): MaternalState => ({
  ...NO_MATERNAL,
  mode: "breastfeeding",
  feedingType: "exclusive",
  babyBirthDate: birthDateFromAgeMonths(months, TODAY),
  prePregnancyWeightKg: 55,
  ...extra,
});

describe("gestational age from HPHT / HPL", () => {
  test("weeks and days since HPHT", () => {
    const g = gestationalAge("2026-08-30", TODAY);
    expect(g).toMatchObject({ days: 49, weeks: 7, dayOfWeek: 0, trimester: 1 });
    expect(g?.dueDate).toBe("2027-06-06");
  });

  test("HPL is HPHT + 280 days and back", () => {
    expect(dueDateFromLmp("2026-08-30")).toBe("2027-06-06");
    expect(lmpFromDueDate("2027-06-06")).toBe("2026-08-30");
    const viaHpl = resolveMaternalInput(
      {
        mode: "pregnant",
        dateKind: "hpl",
        date: "2027-06-06",
        prePregnancyWeightKg: 55,
        twins: false,
      },
      TODAY,
    );
    expect(viaHpl.ok && viaHpl.state.pregnancyLmp).toBe("2026-08-30");
    expect(viaHpl.ok && viaHpl.state.pregnancyDateKind).toBe("hpl");
    const viaHpht = resolveMaternalInput(
      {
        mode: "pregnant",
        dateKind: "hpht",
        date: "2026-08-30",
        prePregnancyWeightKg: 55,
        twins: false,
      },
      TODAY,
    );
    expect(viaHpht.ok && viaHpht.state.pregnancyLmp).toBe("2026-08-30");
  });

  test("trimester boundaries: 13w6d is T1, 14w0d is T2, 27w6d is T2, 28w0d is T3", () => {
    const at = (days: number) => gestationalAge(shiftDate(TODAY, -days), TODAY);
    expect(at(0)?.trimester).toBe(1);
    expect(at(97)).toMatchObject({ weeks: 13, dayOfWeek: 6, trimester: 1 });
    expect(at(98)).toMatchObject({ weeks: 14, dayOfWeek: 0, trimester: 2 });
    expect(at(195)).toMatchObject({ weeks: 27, dayOfWeek: 6, trimester: 2 });
    expect(at(196)).toMatchObject({ weeks: 28, dayOfWeek: 0, trimester: 3 });
    expect(at(280)).toMatchObject({ weeks: 40, trimester: 3, daysToDue: 0, overdue: false });
  });

  test("the same HPHT advances every day without any stored week", () => {
    const lmp = "2026-07-12"; // 98 days before TODAY
    expect(gestationalAge(lmp, TODAY)?.trimester).toBe(2);
    expect(gestationalAge(lmp, shiftDate(TODAY, -1))).toMatchObject({ weeks: 13, trimester: 1 });
    expect(gestationalAge(lmp, shiftDate(TODAY, 1))).toMatchObject({ weeks: 14, dayOfWeek: 1 });
  });

  test("an HPHT after today is not a state; 42+ weeks back is overdue", () => {
    expect(gestationalAge(shiftDate(TODAY, 1), TODAY)).toBeNull();
    expect(gestationalAge(shiftDate(TODAY, -294), TODAY)?.overdue).toBe(false);
    expect(gestationalAge(shiftDate(TODAY, -295), TODAY)?.overdue).toBe(true);
  });

  test("input dates are validated: future HPHT and older than 42 weeks are refused", () => {
    const base = { mode: "pregnant" as const, prePregnancyWeightKg: 55, twins: false };
    expect(
      resolveMaternalInput({ ...base, dateKind: "hpht", date: shiftDate(TODAY, 1) }, TODAY),
    ).toEqual({ ok: false, error: "pregnancyDateFuture" });
    expect(
      resolveMaternalInput({ ...base, dateKind: "hpht", date: shiftDate(TODAY, -295) }, TODAY),
    ).toEqual({ ok: false, error: "pregnancyDateTooOld" });
    // an HPL 10 days ago is a baby 10 days overdue: still accepted (HPHT 290 days back)
    expect(
      resolveMaternalInput({ ...base, dateKind: "hpl", date: shiftDate(TODAY, -10) }, TODAY).ok,
    ).toBe(true);
    // HPL today = HPHT 280 days back = week 40
    const hplToday = resolveMaternalInput({ ...base, dateKind: "hpl", date: TODAY }, TODAY);
    expect(hplToday.ok && gestationalAge(hplToday.state.pregnancyLmp!, TODAY)?.weeks).toBe(40);
  });
});

describe("baby age", () => {
  test("months advance with the birth date, not with the entry", () => {
    const born = birthDateFromAgeMonths(5, TODAY);
    expect(babyAgeMonths(born, TODAY)).toBe(5);
    // a typed age stays that age today for every month count, 0 through 24
    for (let m = 0; m <= 24; m += 1) {
      expect(babyAgeMonths(birthDateFromAgeMonths(m, TODAY), TODAY)).toBe(m);
    }
    expect(babyAgeMonths(born, shiftDate(TODAY, 40))).toBe(6);
  });
});

describe("energy: maintenance on the pre-pregnancy basis + AKG 2019 addition", () => {
  // 55 kg, 160 cm, 26 y: BMR 1259, x1.35 = 1699.65 -> 1700
  const base = 1700;

  test("AKG figures as published (Permenkes 28/2019, Tabel 1)", () => {
    expect(AKG_PREGNANCY_KCAL).toEqual({ 1: 180, 2: 300, 3: 300 });
    expect(AKG_LACTATION_KCAL).toEqual({ first: 330, second: 400 });
  });

  test("pregnancy: +180 in T1, +300 in T2 and T3", () => {
    expect(computeMaternalTargets(profile, pregnantAt(30), { today: TODAY }).eatKcal).toBe(base + 180);
    expect(computeMaternalTargets(profile, pregnantAt(98), { today: TODAY }).eatKcal).toBe(base + 300);
    expect(computeMaternalTargets(profile, pregnantAt(196), { today: TODAY }).eatKcal).toBe(base + 300);
  });

  test("the maternal target keeps the old multipliers for the migrated levels (1.25 / 1.35 / 1.45), whatever the standard factors say", () => {
    // pre-pregnancy 55 kg, 160 cm, age 26 at TODAY: the same basis as `base`
    const bmr = bmrMifflin(55, 160, 26, "female");
    const levels = [
      ["sedentary", 1.25],
      ["light", 1.35],
      ["moderate", 1.45],
      ["active", 1.55],
      ["very_active", 1.65],
    ] as const;
    for (const [level, factor] of levels) {
      const t = computeMaternalTargets({ ...profile, activityLevel: level }, pregnantAt(100), { today: TODAY });
      expect(t.factor).toBe(factor);
      expect(t.tdee).toBe(Math.round((bmr * factor) / 5) * 5);
      expect(MATERNAL_ACTIVITY_FACTOR[level]).toBe(factor);
      expect(t.eatKcal).toBe(t.tdee + 300);
    }
  });

  test("the basis is the pre-pregnancy weight, not today's, and the old target is ignored", () => {
    const t = computeMaternalTargets(profile, pregnantAt(100), { today: TODAY, weightNow: 70 });
    expect(t.tdee).toBe(base);
    expect(t.bmr).toBe(1259);
    expect(t.maternal?.baseKcal).toBe(base);
    expect(t.maternal?.addKcal).toBe(300);
    expect(t.eatKcal).toBe(t.maternal!.baseKcal + t.maternal!.addKcal);
  });

  test("no deficit, no burn target, no weight-loss notes", () => {
    const t = computeMaternalTargets(profile, pregnantAt(100), { today: TODAY });
    expect(t.deficitKcal).toBe(0);
    expect(t.rawDeficitKcal).toBe(0);
    expect(t.burnKcal).toBe(0);
    expect(t.notes).toEqual(["MATERNAL"]);
    // the normal plan for the same profile does cut
    expect(computeTargets(profile, { today: TODAY, weightNow: 62 }).deficitKcal).toBeGreaterThan(0);
  });

  test("breastfeeding: +330 for the first six months, +400 after", () => {
    expect(computeMaternalTargets(profile, breastfeeding(0), { today: TODAY }).eatKcal).toBe(base + 330);
    expect(computeMaternalTargets(profile, breastfeeding(5), { today: TODAY }).eatKcal).toBe(base + 330);
    expect(computeMaternalTargets(profile, breastfeeding(6), { today: TODAY }).eatKcal).toBe(base + 400);
    expect(computeMaternalTargets(profile, breastfeeding(11), { today: TODAY }).eatKcal).toBe(base + 400);
  });

  test("partial breastfeeding gets the full AKG addition and is flagged as an estimate", () => {
    const partial = computeMaternalTargets(profile, breastfeeding(2, { feedingType: "partial" }), { today: TODAY });
    const exclusive = computeMaternalTargets(profile, breastfeeding(2), { today: TODAY });
    expect(partial.maternal?.addKcal).toBe(330);
    expect(partial.eatKcal).toBe(base + 330);
    expect(partial.eatKcal).toBe(exclusive.eatKcal);
    expect(partial.maternal?.flags).toContain("PARTIAL_ESTIMATE");
    expect(exclusive.maternal?.flags).not.toContain("PARTIAL_ESTIMATE");
    const second = computeMaternalTargets(profile, breastfeeding(8, { feedingType: "partial" }), { today: TODAY });
    expect(second.maternal?.addKcal).toBe(400);
  });

  test("breastfeeding without a pre-pregnancy weight uses today's weight", () => {
    const t = computeMaternalTargets(profile, breastfeeding(2, { prePregnancyWeightKg: null }), {
      today: TODAY,
      weightNow: 62,
    });
    // today's 62 kg: BMR 1329.. x 1.35 = 1794.. -> round to 5
    expect(t.tdee).toBe(1795);
  });

  test("twins keep the singleton AKG addition and are flagged, never invented", () => {
    const single = computeMaternalTargets(profile, pregnantAt(100), { today: TODAY });
    const twins = computeMaternalTargets(profile, pregnantAt(100, { twins: true }), { today: TODAY });
    expect(twins.eatKcal).toBe(single.eatKcal);
    expect(twins.maternal?.flags).toContain("TWINS_ENERGY");
    expect(single.maternal?.flags).not.toContain("TWINS_ENERGY");
  });

  test("flags: overdue HPHT, baby older than AKG covers, known conditions", () => {
    expect(computeMaternalTargets(profile, pregnantAt(300), { today: TODAY }).maternal?.flags).toContain("OVERDUE");
    expect(computeMaternalTargets(profile, breastfeeding(12), { today: TODAY }).maternal?.flags).toContain("BABY_OVER_12");
    const consult = computeMaternalTargets(profile, pregnantAt(100, { conditions: ["anemia"] }), { today: TODAY });
    expect(consult.maternal?.flags).toContain("CONSULT");
    expect(consult.maternal?.conditions).toEqual(["anemia"]);
  });

  test("a trimester change moves the target the same day", () => {
    const lmp = shiftDate(TODAY, -98);
    const state = { ...pregnantAt(0), pregnancyLmp: lmp };
    const yesterday = computeMaternalTargets(profile, state, { today: shiftDate(TODAY, -1) });
    const today = computeMaternalTargets(profile, state, { today: TODAY });
    expect(yesterday.maternal?.stage).toBe("t1");
    expect(today.maternal?.stage).toBe("t2");
    expect(today.eatKcal - yesterday.eatKcal).toBe(120);
  });
});

describe("nutrients (AKG 2019 for a 26-year-old woman, plus the stage's addition)", () => {
  const nutrients = (state: MaternalState) =>
    computeMaternalTargets(profile, state, { today: TODAY });
  const target = (state: MaternalState, key: Parameters<typeof maternalNutrient>[1]) =>
    maternalNutrient(nutrients(state), key)?.target;

  test("protein: 60 g + 1 / 10 / 30 g by trimester", () => {
    expect(target(pregnantAt(30), "protein")).toBe(61);
    expect(target(pregnantAt(120), "protein")).toBe(70);
    expect(target(pregnantAt(220), "protein")).toBe(90);
  });

  test("protein while breastfeeding: +20 g first six months, +15 g second (AKG 2019)", () => {
    expect(target(breastfeeding(2), "protein")).toBe(80);
    expect(target(breastfeeding(8), "protein")).toBe(75);
  });

  test("iron +0 in T1 and +9 mg in T2/T3, none while breastfeeding", () => {
    expect(target(pregnantAt(30), "iron")).toBe(18);
    expect(target(pregnantAt(120), "iron")).toBe(27);
    expect(target(pregnantAt(220), "iron")).toBe(27);
    expect(target(breastfeeding(2), "iron")).toBe(18);
  });

  test("folate, calcium, iodine, vitamin A, water, fibre, DHA", () => {
    const p = pregnantAt(120);
    expect(target(p, "folate")).toBe(600);
    expect(target(p, "calcium")).toBe(1200);
    expect(target(p, "iodine")).toBe(220);
    expect(target(p, "vitaminA")).toBe(900);
    expect(target(p, "water")).toBe(2650);
    expect(target(p, "fiber")).toBe(36);
    expect(target(p, "dha")).toBe(200);
    const b = breastfeeding(2);
    expect(target(b, "folate")).toBe(500);
    expect(target(b, "calcium")).toBe(1200);
    expect(target(b, "iodine")).toBe(290);
    expect(target(b, "vitaminA")).toBe(950);
    expect(target(b, "water")).toBe(3150);
    expect(target(breastfeeding(8), "water")).toBe(3000);
  });

  test("only what the food data carries is tracked; the rest is 'perhatikan'", () => {
    const list = nutrients(pregnantAt(120)).maternal!.nutrients;
    const tracked = list.filter((n) => n.tracked).map((n) => n.key);
    expect(tracked.toSorted()).toEqual(["fiber", "protein", "water"]);
    const guidance = list.filter((n) => !n.tracked).map((n) => n.key);
    expect(guidance.toSorted()).toEqual(["calcium", "dha", "folate", "iodine", "iron", "vitaminA"]);
  });

  test("teenage bands use their own AKG row", () => {
    const teen = computeMaternalTargets(
      { ...profile, birthYear: 2010 }, // 16
      pregnantAt(120),
      { today: TODAY },
    );
    expect(maternalNutrient(teen, "iron")?.target).toBe(24); // 15 + 9
    expect(maternalNutrient(teen, "calcium")?.target).toBe(1400); // 1200 + 200
    expect(maternalNutrient(teen, "protein")?.target).toBe(75); // 65 + 10
  });
});

describe("pre-pregnancy BMI bands and IOM 2009 totals", () => {
  test("WHO cut-offs", () => {
    expect(bmiCategory(18.4)).toBe("under");
    expect(bmiCategory(18.5)).toBe("normal");
    expect(bmiCategory(24.9)).toBe("normal");
    expect(bmiCategory(25)).toBe("over");
    expect(bmiCategory(29.9)).toBe("over");
    expect(bmiCategory(30)).toBe("obese");
  });

  test("IOM totals as published", () => {
    expect(IOM_SINGLETON_KG).toEqual({
      under: { minKg: 12.5, maxKg: 18 },
      normal: { minKg: 11.5, maxKg: 16 },
      over: { minKg: 7, maxKg: 11.5 },
      obese: { minKg: 5, maxKg: 9 },
    });
    expect(IOM_TWINS_KG.normal).toEqual({ minKg: 16.8, maxKg: 24.5 });
    expect(IOM_TWINS_KG.over).toEqual({ minKg: 14.1, maxKg: 22.7 });
    expect(IOM_TWINS_KG.obese).toEqual({ minKg: 11.3, maxKg: 19.1 });
  });

  test("plan by weight at 160 cm", () => {
    const at = (kg: number, twins = false) => weightGainPlan(kg, 160, twins);
    expect(at(45)).toMatchObject({ category: "under", totalMinKg: 12.5, totalMaxKg: 18 });
    expect(at(55)).toMatchObject({ category: "normal", totalMinKg: 11.5, totalMaxKg: 16, bmi: 21.5 });
    expect(at(70)).toMatchObject({ category: "over", totalMinKg: 7, totalMaxKg: 11.5 });
    expect(at(85)).toMatchObject({ category: "obese", totalMinKg: 5, totalMaxKg: 9 });
  });

  test("twins have their own ranges; underweight twins borrow the normal range and say so", () => {
    expect(weightGainPlan(55, 160, true)).toMatchObject({ totalMinKg: 16.8, totalMaxKg: 24.5, borrowedRange: false, weeklyRateKg: null });
    expect(weightGainPlan(70, 160, true)).toMatchObject({ totalMinKg: 14.1, totalMaxKg: 22.7 });
    expect(weightGainPlan(85, 160, true)).toMatchObject({ totalMinKg: 11.3, totalMaxKg: 19.1 });
    expect(weightGainPlan(45, 160, true)).toMatchObject({ totalMinKg: 16.8, totalMaxKg: 24.5, borrowedRange: true });
    const flagged = computeMaternalTargets(profile, pregnantAt(100, { twins: true, prePregnancyWeightKg: 45 }), {
      today: TODAY,
    });
    expect(flagged.maternal?.flags).toContain("TWINS_UNDERWEIGHT");
  });

  test("singleton keeps the IOM weekly rate for weeks 14+", () => {
    expect(weightGainPlan(55, 160, false).weeklyRateKg).toEqual({ minKg: 0.35, maxKg: 0.5 });
    expect(weightGainPlan(85, 160, false).weeklyRateKg).toEqual({ minKg: 0.17, maxKg: 0.27 });
  });
});

describe("weekly gain band", () => {
  const normal = weightGainPlan(55, 160, false);

  test("starts at 0, is 0.5-2 kg at the end of the first trimester, lands on the IOM total at week 40", () => {
    expect(gainBand(0, normal)).toEqual({ minKg: 0, maxKg: 0 });
    expect(gainBand(13, normal)).toEqual({ minKg: 0.5, maxKg: 2 });
    expect(gainBand(40, normal)).toEqual({ minKg: 11.5, maxKg: 16 });
    expect(gainBand(55, normal)).toEqual({ minKg: 11.5, maxKg: 16 });
  });

  test("grows monotonically and the band never inverts", () => {
    let prev = gainBand(0, normal);
    for (let week = 1; week <= 40; week += 1) {
      const band = gainBand(week, normal);
      expect(band.minKg).toBeGreaterThanOrEqual(prev.minKg);
      expect(band.maxKg).toBeGreaterThanOrEqual(prev.maxKg);
      expect(band.maxKg).toBeGreaterThanOrEqual(band.minKg);
      prev = band;
    }
  });

  test("status leaves a 0.5 kg tolerance for scale noise", () => {
    const band = gainBand(26, normal);
    expect(gainStatus(band.minKg - 0.4, band)).toBe("within");
    expect(gainStatus(band.minKg - 0.6, band)).toBe("below");
    expect(gainStatus(band.maxKg + 0.4, band)).toBe("within");
    expect(gainStatus(band.maxKg + 0.6, band)).toBe("above");
  });

  test("chart: gain is measured from the pre-pregnancy weight, per week since HPHT", () => {
    const lmp = shiftDate(TODAY, -140); // week 20
    const chart = weightGainChart({
      lmp,
      prePregnancyWeightKg: 55,
      heightCm: 160,
      twins: false,
      today: TODAY,
      weighIns: [
        { date: shiftDate(lmp, -30), weightKg: 54 }, // before the pregnancy: not a point
        { date: shiftDate(lmp, 70), weightKg: 59 }, // week 10
        { date: TODAY, weightKg: 63.5 }, // week 20
      ],
    });
    expect(chart.band).toHaveLength(41);
    expect(chart.points).toEqual([
      { date: shiftDate(lmp, 70), week: 10, weightKg: 59, gainKg: 4 },
      { date: TODAY, week: 20, weightKg: 63.5, gainKg: 8.5 },
    ]);
    expect(chart.current).toMatchObject({ week: 20, gainKg: 8.5, status: "above" });
    expect(chart.current!.bandMaxKg).toBe(gainBand(20, chart.plan).maxKg);
    expect(chart.plan.category).toBe("normal");
  });

  test("chart without weigh-ins has a band and no current", () => {
    const chart = weightGainChart({
      lmp: shiftDate(TODAY, -30),
      prePregnancyWeightKg: 55,
      heightCm: 160,
      twins: false,
      today: TODAY,
      weighIns: [],
    });
    expect(chart.points).toEqual([]);
    expect(chart.current).toBeNull();
  });
});

describe("mode switches through the plan", () => {
  const row = (maternal: MaternalState): ProfileRow =>
    ({
      userId: "u1",
      birthYear: 2000,
      gender: "female",
      heightCm: 160,
      startWeightKg: 62,
      targetWeightKg: 50,
      targetDate: "2027-06-01",
      activityLevel: "light",
      ...maternalToRow(maternal),
    }) as unknown as ProfileRow;
  const history = {
    latestWeightKg: 62,
    weighIns: [],
    intake: [],
    exercise: [],
    prefs: DEFAULT_CALIBRATION_PREFS,
  };

  test("normal -> pregnant -> breastfeeding -> normal", () => {
    const normal = buildPlan(row(NO_MATERNAL), history, TODAY);
    expect(normal.targets.maternal).toBeNull();
    expect(normal.maternal).toBeNull();
    expect(normal.targets.deficitKcal).toBeGreaterThan(0);

    const pregnant = buildPlan(row(pregnantAt(120)), history, TODAY);
    expect(pregnant.targets.maternal?.mode).toBe("pregnant");
    expect(pregnant.targets.deficitKcal).toBe(0);
    expect(pregnant.targets.eatKcal).toBe(2000);
    expect(pregnant.trend).toBeNull();

    const nursing = buildPlan(row(breastfeeding(1)), history, TODAY);
    expect(nursing.targets.maternal?.mode).toBe("breastfeeding");
    expect(nursing.targets.eatKcal).toBe(2030);

    // back to normal at maintenance (what the router stores: target = today's weight)
    const back = buildPlan(
      { ...row(NO_MATERNAL), targetWeightKg: 62 } as ProfileRow,
      history,
      TODAY,
    );
    expect(back.targets.maternal).toBeNull();
    expect(back.targets.notes).toContain("MAINTENANCE");
    expect(back.targets.deficitKcal).toBe(0);
  });

  test("row <-> state round trip, and unknown stored values degrade to none", () => {
    const state = pregnantAt(120, { twins: true, conditions: ["hypertension", "anemia"] });
    expect(maternalFromRow(maternalToRow(state))).toEqual(state);
    expect(maternalFromRow({ ...maternalToRow(state), maternalMode: "weird" as never })).toEqual(NO_MATERNAL);
    expect(
      maternalFromRow({ ...maternalToRow(state), maternalConditions: ["anemia", "x"] }).conditions,
    ).toEqual(["anemia"]);
  });

  test("breastfeeding input becomes a birth date that keeps ageing", () => {
    const result = resolveMaternalInput(
      { mode: "breastfeeding", feeding: "exclusive", babyAgeMonths: 3 },
      TODAY,
    );
    expect(result.ok && babyAgeMonths(result.state.babyBirthDate!, TODAY)).toBe(3);
    expect(result.ok && result.state.prePregnancyWeightKg).toBeNull();
    expect(resolveMaternalInput({ mode: "none" }, TODAY)).toEqual({ ok: true, state: NO_MATERNAL });
  });
});

describe("food safety flags", () => {
  const keys = (name: string, mode: "pregnant" | "breastfeeding" | "none" = "pregnant") =>
    foodFlagsFor(name, mode).map((f) => f.key);

  test("alcohol", () => {
    expect(keys("Bir Bintang")).toContain("alcohol");
    expect(keys("Red wine")).toContain("alcohol");
    expect(keys("Tape ketan")).toContain("alcohol");
    expect(keys("Bir pletok")).not.toContain("alcohol");
  });

  test("raw and undercooked eggs, meat, fish", () => {
    expect(keys("Telur setengah matang")).toContain("rawEgg");
    expect(keys("Telur mata sapi")).toContain("rawEgg");
    expect(keys("Steak sapi rare")).toContain("rawMeat");
    expect(keys("Beef carpaccio")).toContain("rawMeat");
    expect(keys("Sushi salmon")).toContain("rawFish");
    expect(keys("Sashimi")).toContain("rawFish");
    expect(keys("Telur dadar")).toEqual([]);
    expect(keys("Steak sapi well done")).toEqual([]);
  });

  test("high-mercury fish, with the false positives we know of", () => {
    expect(keys("Steak ikan hiu")).toContain("mercuryFish");
    expect(keys("Swordfish")).toContain("mercuryFish");
    expect(keys("Tuna steak")).toContain("mercuryFish");
    expect(keys("Tuna kaleng")).not.toContain("mercuryFish");
    expect(keys("Ikan kakap bakar")).toEqual([]);
    expect(keys("Jamur tiram goreng")).not.toContain("rawFish");
    expect(keys("Tumis kangkung saus tiram")).not.toContain("rawFish");
  });

  test("unpasteurized milk and soft cheese", () => {
    expect(keys("Susu mentah")).toContain("unpasteurized");
    expect(keys("Keju brie")).toContain("unpasteurized");
    expect(keys("Keju brie pasteurized")).not.toContain("unpasteurized");
    expect(keys("Susu UHT")).toEqual([]);
  });

  test("jamu and herbal", () => {
    expect(keys("Jamu kunyit asam")).toContain("herbal");
    expect(keys("Beras kencur")).toContain("herbal");
    expect(keys("Wedang uwuh")).toContain("herbal");
  });

  test("breastfeeding gets alcohol, caffeine and herbal only; none gets nothing", () => {
    expect(keys("Bir", "breastfeeding")).toContain("alcohol");
    expect(keys("Kopi susu", "breastfeeding")).toContain("caffeine");
    expect(keys("Jamu pelancar ASI", "breastfeeding")).toContain("herbal");
    expect(keys("Sushi salmon", "breastfeeding")).toEqual([]);
    expect(keys("Telur setengah matang", "breastfeeding")).toEqual([]);
    expect(keys("Bir", "none")).toEqual([]);
  });

  test("caffeine estimates and the 200 mg day", () => {
    expect(CAFFEINE_LIMIT_MG).toBe(200);
    expect(caffeineMgFor("Americano")).toBe(95);
    expect(caffeineMgFor("Kopi susu gula aren")).toBe(80);
    expect(caffeineMgFor("Es teh manis")).toBe(40);
    expect(caffeineMgFor("Energy drink")).toBe(80);
    expect(caffeineMgFor("Decaf latte")).toBeNull();
    expect(caffeineMgFor("Nasi goreng")).toBeNull();
    expect(foodFlagsFor("Americano", "pregnant")).toEqual([{ key: "caffeine", caffeineMg: 95 }]);
    expect(caffeineOfDay(["Americano", "Kopi susu", "Nasi goreng"])).toEqual({
      mg: 175,
      limitMg: 200,
      over: false,
    });
    expect(caffeineOfDay(["Americano", "Kopi susu", "Es teh manis"]).over).toBe(true);
  });
});

describe("AI prompt context", () => {
  test("names the mode and trimester, forbids deficit coaching, asks for doneness in the name", () => {
    const note = maternalNoteFor(pregnantAt(120), TODAY);
    expect(note).toContain("hamil (trimester 2)");
    expect(note).toContain("mengurangi kalori");
    expect(note).toContain("setengah matang");
    expect(maternalNoteFor(breastfeeding(2), TODAY)).toContain("menyusui");
    expect(maternalNoteFor(NO_MATERNAL, TODAY)).toBeNull();
  });
});
