import { describe, expect, test } from "bun:test";

import { shiftDate } from "./engine";
import { consentOnWeek, day, ownerWeek, quietWeek, recapOf, sleepFinding, TODAY, WEEK } from "./recap-fixtures";
import type { WeekSpec } from "./recap-fixtures";
import {
  FACT_CODES,
  FACT_VARIANTS,
  T,
  buildFacts,
  neededKgPerWeek,
  reflectionFacts,
  selectFacts,
  selectionSignature,
  sleepFactorOfSignature,
} from "./recap-facts";
import type { Fact, ReflectionInput, WorkoutInput } from "./recap-facts";
import type { SleepFinding } from "./sleep-insights-types";

const find = (input: ReflectionInput, code: Fact["code"]) => buildFacts(input).filter((f) => f.code === code);
const variantOf = (input: ReflectionInput, code: Fact["code"]) => {
  const found = find(input, code);
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0]?.variant ?? null;
};
const uniform = (kcal: number, extra: Partial<WeekSpec> = {}): Partial<ReflectionInput> => ({
  recap: recapOf({ eaten: Array(7).fill(kcal), protein: Array(7).fill(100), ...extra }),
});

describe("every code and variant is declared", () => {
  test("FACT_VARIANTS covers each code", () => {
    expect(Object.keys(FACT_VARIANTS).toSorted()).toEqual([...FACT_CODES].toSorted());
  });
  test("the owner's week only emits declared variants", () => {
    for (const fact of buildFacts(ownerWeek())) expect(FACT_VARIANTS[fact.code]).toContain(fact.variant);
  });
});

describe("LOG_STREAK / LOG_GAPS", () => {
  test("a streak of 3 is a win, 2 days is not", () => {
    expect(variantOf(quietWeek({}, { streakDays: 3 }), "LOG_STREAK")).toBe("streak");
    // Seven logged days but a streak of 2: the logged-most-days win instead.
    expect(variantOf(quietWeek({}, { streakDays: 2 }), "LOG_STREAK")).toBe("logged");
  });

  test("a gain plan words the streak as reaching the target", () => {
    expect(variantOf(quietWeek({ mode: "gain" }, { streakDays: 4 }), "LOG_STREAK")).toBe("streak_gain");
  });

  test("Hamil / Menyusui never gets a streak", () => {
    expect(variantOf(quietWeek({ mode: "maternal" }, { streakDays: 6 }), "LOG_STREAK")).toBe("logged");
  });

  test("two logged days is the smallest win; one is none", () => {
    const two = quietWeek({}, { eaten: [1500, 1500, 0, 0, 0, 0, 0], streakDays: 0 });
    expect(variantOf(two, "LOG_STREAK")).toBe("some");
    expect(variantOf(quietWeek({}, { eaten: [1500, 0, 0, 0, 0, 0, 0], streakDays: 0 }), "LOG_STREAK")).toBeNull();
  });

  test("a week logged on half the days or fewer has gaps; 4 of 7 does not", () => {
    expect(variantOf(quietWeek({}, { eaten: [1500, 1500, 1500, 0, 0, 0, 0] }), "LOG_GAPS")).toBe("gaps");
    expect(find(quietWeek({}, { eaten: [1500, 1500, 1500, 1500, 0, 0, 0] }), "LOG_GAPS")).toHaveLength(0);
  });

  test("a running week is only judged on days that are over", () => {
    const running = quietWeek({ today: day(3) }, { today: day(3), eaten: [1500, 1500, 0, 0, 0, 0, 0] });
    // 3 judged days, 2 logged: under the 4-day minimum, so no gaps call.
    expect(find(running, "LOG_GAPS")).toHaveLength(0);
  });
});

describe("neededKgPerWeek", () => {
  const person = { gender: "male", heightCm: 175, ageYears: 38, weightKg: 80, targetKg: 75, targetDate: "2027-03-01" };
  test("kg to go over the weeks left", () => {
    expect(neededKgPerWeek("lose", person, TODAY)).toBe(0.26);
  });
  test("a past or next-week date counts as one week", () => {
    expect(neededKgPerWeek("lose", { ...person, targetDate: "2026-10-01" }, TODAY)).toBe(5);
    expect(neededKgPerWeek("lose", { ...person, targetDate: shiftDate(TODAY, 3) }, TODAY)).toBe(5);
  });
  test("none without a target, on the wrong side of it, or while maintaining / maternal", () => {
    expect(neededKgPerWeek("lose", { ...person, targetKg: null }, TODAY)).toBeNull();
    expect(neededKgPerWeek("lose", { ...person, targetKg: 80.05 }, TODAY)).toBeNull();
    expect(neededKgPerWeek("lose", { ...person, targetKg: 85 }, TODAY)).toBeNull();
    expect(neededKgPerWeek("maintain", person, TODAY)).toBeNull();
    expect(neededKgPerWeek("maternal", person, TODAY)).toBeNull();
  });
  test("gain counts upward", () => {
    expect(neededKgPerWeek("gain", { ...person, weightKg: 60, targetKg: 65 }, TODAY)).toBe(0.26);
  });
});

describe("WEIGHT_PACE", () => {
  const withRate = (rate: number | null, over: Partial<ReflectionInput> = {}) =>
    quietWeek({ trend: { weeklyRateKg: rate, projectedDate: "2027-02-01" }, ...over });

  test("lose: the on-pace line is 60% of the pace the date needs (0.26 kg/week here)", () => {
    expect(variantOf(withRate(-0.15), "WEIGHT_PACE")).toBe("behind");
    expect(variantOf(withRate(-0.16), "WEIGHT_PACE")).toBe("on_pace");
    expect(variantOf(withRate(-0.5), "WEIGHT_PACE")).toBe("on_pace");
  });

  test("lose: within 0.1 kg/week either way is flat, above is gaining", () => {
    expect(variantOf(withRate(0.1), "WEIGHT_PACE")).toBe("flat");
    expect(variantOf(withRate(-0.1), "WEIGHT_PACE")).toBe("flat");
    expect(variantOf(withRate(0.11), "WEIGHT_PACE")).toBe("gaining");
  });

  test("lose: more than 1 kg/week (or 1% of the weight, whichever is more) is too fast", () => {
    expect(variantOf(withRate(-1), "WEIGHT_PACE")).toBe("on_pace");
    expect(variantOf(withRate(-1.01), "WEIGHT_PACE")).toBe("too_fast");
    const heavy = { person: { gender: "male", heightCm: 175, ageYears: 38, weightKg: 130, targetKg: 90, targetDate: "2027-03-01" } };
    expect(variantOf(withRate(-1.3, heavy), "WEIGHT_PACE")).toBe("on_pace");
    expect(variantOf(withRate(-1.31, heavy), "WEIGHT_PACE")).toBe("too_fast");
  });

  test("the params carry the pace as a positive number, the needed pace and the projection", () => {
    const [pace] = find(withRate(-0.3), "WEIGHT_PACE");
    expect(pace!.params).toEqual({ kgPerWeek: 0.3, neededKgPerWeek: 0.26, projectedDate: "2027-02-01" });
  });

  test("without a 28-day rate a fall of 0.2 kg in the week is a small win", () => {
    const recap = quietWeek().recap;
    const change = (changeKg: number) => withRate(null, { recap: { ...recap, weight: { startKg: 80, endKg: 80 + changeKg, changeKg, weighIns: 3 } } });
    expect(variantOf(change(-0.2), "WEIGHT_PACE")).toBe("week_down");
    expect(variantOf(change(-0.19), "WEIGHT_PACE")).toBeNull();
    expect(variantOf(change(0.5), "WEIGHT_PACE")).toBeNull();
  });

  test("maintain: steady within 0.25 kg/week, drifting beyond", () => {
    const m = (rate: number) => withRate(rate, { mode: "maintain" });
    expect(variantOf(m(0.25), "WEIGHT_PACE")).toBe("steady");
    expect(variantOf(m(-0.25), "WEIGHT_PACE")).toBe("steady");
    expect(variantOf(m(0.26), "WEIGHT_PACE")).toBe("drifting");
    expect(find(m(-0.4), "WEIGHT_PACE")[0]!.params.direction).toBe("down");
  });

  test("gain: 0.1 kg/week up to 0.75 is on pace, slower is stalled, faster says nothing", () => {
    const g = (rate: number) => withRate(rate, { mode: "gain", person: { gender: "male", heightCm: 175, ageYears: 25, weightKg: 60, targetKg: 70, targetDate: "2027-06-01" } });
    expect(variantOf(g(0.09), "WEIGHT_PACE")).toBe("gain_stalled");
    expect(variantOf(g(0.1), "WEIGHT_PACE")).toBe("gain_on_pace");
    expect(variantOf(g(0.75), "WEIGHT_PACE")).toBe("gain_on_pace");
    expect(variantOf(g(0.76), "WEIGHT_PACE")).toBeNull();
  });

  test("Hamil / Menyusui gets no weight pace at all", () => {
    expect(find(withRate(-0.5, { mode: "maternal" }), "WEIGHT_PACE")).toHaveLength(0);
  });
});

describe("WEIGH_INS", () => {
  const weighIns = (n: number) => Array.from({ length: n }, (_, i) => ({ date: day(i), weightKg: 80 }));
  test("4 or more is a win; 3 is nothing; fewer is a nudge on a finished week", () => {
    expect(variantOf(quietWeek({ weighIns: weighIns(4) }), "WEIGH_INS")).toBe("regular");
    expect(variantOf(quietWeek({ weighIns: weighIns(3) }), "WEIGH_INS")).toBeNull();
    expect(variantOf(quietWeek({ weighIns: weighIns(2) }), "WEIGH_INS")).toBe("few");
    expect(variantOf(quietWeek({ weighIns: weighIns(1) }), "WEIGH_INS")).toBe("few");
    expect(variantOf(quietWeek({ weighIns: [] }), "WEIGH_INS")).toBe("none");
  });
  test("a week that has barely started is not nagged", () => {
    const early = quietWeek({ today: day(3), weighIns: [] }, { today: day(3), eaten: [1500, 1500, 1500, 0, 0, 0, 0] });
    expect(find(early, "WEIGH_INS")).toHaveLength(0);
  });
  test("not for Hamil / Menyusui", () => {
    expect(find(quietWeek({ mode: "maternal", weighIns: [] }), "WEIGH_INS")).toHaveLength(0);
  });
});

describe("MEASURE_ANOMALY", () => {
  const waist = (from: number, to: number, gap: number, toDay = 3) => ({
    waist: [
      { date: shiftDate(day(toDay), -gap), waistCm: from },
      { date: day(toDay), waistCm: to },
    ],
  });
  test("5 cm inside 7 days is flagged, 4.9 is not", () => {
    const [hit] = find(quietWeek(waist(100, 95, 7)), "MEASURE_ANOMALY");
    expect(hit).toMatchObject({ variant: "waist", params: { fromCm: 100, toCm: 95, deltaCm: 5, days: 7 } });
    expect(find(quietWeek(waist(100, 95.1, 7)), "MEASURE_ANOMALY")).toHaveLength(0);
  });
  test("the same change over 8 days is a real change", () => {
    expect(find(quietWeek(waist(100, 90, 8)), "MEASURE_ANOMALY")).toHaveLength(0);
  });
  test("a reading outside the week is not judged this week", () => {
    expect(find(quietWeek({ waist: [{ date: shiftDate(WEEK, -6), waistCm: 100 }, { date: shiftDate(WEEK, -2), waistCm: 90 }] }), "MEASURE_ANOMALY")).toHaveLength(0);
  });
  test("weight: 2.5 kg in 2 days is a measuring slip, 2.4 kg or 3 days is not", () => {
    const w = (from: number, to: number, gap: number) =>
      quietWeek({ weightBefore: { date: shiftDate(day(2), -gap), weightKg: from }, weighIns: [{ date: day(2), weightKg: to }] });
    expect(find(w(80, 82.5, 2), "MEASURE_ANOMALY")[0]).toMatchObject({ variant: "weight", params: { deltaKg: 2.5, days: 2 } });
    expect(find(w(80, 82.4, 2), "MEASURE_ANOMALY")).toHaveLength(0);
    expect(find(w(80, 83, 3), "MEASURE_ANOMALY")).toHaveLength(0);
  });
  test("not for Hamil / Menyusui", () => {
    expect(find(quietWeek({ mode: "maternal", ...waist(100, 90, 5) }), "MEASURE_ANOMALY")).toHaveLength(0);
  });
});

describe("INTAKE_AVG_VS_TARGET (target 1500 a day)", () => {
  const v = (kcal: number, over: Partial<ReflectionInput> = {}) => variantOf(quietWeek({ ...uniform(kcal), ...over }), "INTAKE_AVG_VS_TARGET");

  test("lose / maintain: 85% to 105% is on target", () => {
    expect(v(1275)).toBe("on_target");
    expect(v(1274)).toBeNull();
    expect(v(1575)).toBe("on_target");
    expect(v(1576)).toBeNull();
  });
  test("lose / maintain: over from 110%, under below 70%", () => {
    expect(v(1650)).toBeNull();
    expect(v(1651)).toBe("over");
    expect(v(1050)).toBeNull();
    expect(v(1049)).toBe("under");
  });
  test("over is an alert-level watch from 140%", () => {
    expect(find(quietWeek(uniform(2100)), "INTAKE_AVG_VS_TARGET")[0]!.severity).toBe("info");
    expect(find(quietWeek(uniform(2101)), "INTAKE_AVG_VS_TARGET")[0]!.severity).toBe("watch");
  });
  test("gain: 90% to 115% is on target, below is a focus, above says nothing", () => {
    expect(v(1350, { mode: "gain" })).toBe("on_target");
    expect(v(1349, { mode: "gain" })).toBe("under_gain");
    expect(v(1725, { mode: "gain" })).toBe("on_target");
    expect(v(1800, { mode: "gain" })).toBeNull();
  });
  test("Hamil / Menyusui: never told to eat less", () => {
    expect(v(1275, { mode: "maternal" })).toBe("on_target");
    expect(v(1199, { mode: "maternal" })).toBe("under_maternal");
    expect(v(1200, { mode: "maternal" })).toBeNull();
    expect(v(2400, { mode: "maternal" })).toBeNull();
  });
  test("the budget of each day decides, not the base target", () => {
    // Every day's budget is 2000: the same 1650 kcal is under it, so nothing is flagged.
    const recap = { ...recapOf({ eaten: Array(7).fill(1650), target: 1500 }) };
    const budgeted = { ...recap, targetKcal: 2000 };
    expect(variantOf(quietWeek({ recap: budgeted }), "INTAKE_AVG_VS_TARGET")).toBeNull();
    expect(find(quietWeek({ recap: budgeted }), "INTAKE_AVG_VS_TARGET")).toHaveLength(0);
  });
  test("fewer than 3 logged days is too little to judge", () => {
    expect(find(quietWeek({ recap: recapOf({ eaten: [1500, 1500, 0, 0, 0, 0, 0] }) }), "INTAKE_AVG_VS_TARGET")).toHaveLength(0);
  });
  test("params round-trip the numbers the text uses", () => {
    const [over] = find(quietWeek(uniform(1950)), "INTAKE_AVG_VS_TARGET");
    expect(over!.params).toMatchObject({ avgKcal: 1950, targetKcal: 1500, diffKcal: 450, diffPct: 30 });
  });
});

describe("INTAKE_SWING", () => {
  const swing = (eaten: number[]) => variantOf(quietWeek({ recap: recapOf({ eaten }) }), "INTAKE_SWING");
  test("a spread of 1000 kcal swings, 999 does not", () => {
    expect(swing([1500, 2500, 1500, 1500, 1500, 1500, 1500])).toBe("swing");
    expect(swing([1500, 2499, 1500, 1500, 1500, 1500, 1500])).toBeNull();
  });
  test("a coefficient of variation of 0.3 swings even under 1000 kcal", () => {
    expect(swing([800, 1500, 800, 1500, 800, 1500, 800])).toBe("swing");
  });
  test("steady needs 5 judged days within a tight band", () => {
    expect(swing([1500, 1480, 1520, 1500, 1510, 1490, 1500])).toBe("steady");
    expect(swing([1500, 1480, 1520, 1500, 0, 0, 0])).toBeNull();
  });
  test("a day under 40% of its budget is a forgotten log and stays out", () => {
    // 100 kcal on Tuesday would be a 1400 kcal spread; it is skipped.
    expect(swing([1500, 100, 1500, 1500, 1500, 1500, 1500])).toBe("steady");
  });
  test("under 4 usable days says nothing", () => {
    expect(swing([1500, 2800, 1500, 0, 0, 0, 0])).toBeNull();
  });
});

describe("PROTEIN", () => {
  const protein = (avg: number | null, days = 7) =>
    quietWeek({ recap: recapOf({ eaten: Array(7).fill(1500), protein: Array.from({ length: 7 }, (_, i) => (i < days && avg !== null ? avg : null)) }) });
  test("below 70% of the target is low, from 95% it is a win, between is quiet", () => {
    expect(find(protein(76), "PROTEIN_LOW")).toHaveLength(1);
    expect(find(protein(77), "PROTEIN_LOW")).toHaveLength(0);
    expect(find(protein(104), "PROTEIN_OK")).toHaveLength(0);
    expect(find(protein(105), "PROTEIN_OK")).toHaveLength(1);
  });
  test("under 60% ranks higher", () => {
    expect(find(protein(70), "PROTEIN_LOW")[0]!.priority).toBeLessThan(find(protein(60), "PROTEIN_LOW")[0]!.priority);
  });
  test("needs 4 days with protein numbers", () => {
    expect(find(protein(40, 3), "PROTEIN_LOW")).toHaveLength(0);
    expect(find(protein(40, 4), "PROTEIN_LOW")).toHaveLength(1);
    expect(find(protein(110, 3), "PROTEIN_OK")).toHaveLength(0);
  });
  test("it is its own domain and outranks the calorie average, sleep and everything but an alert-level hard session", () => {
    const [low] = find(protein(58), "PROTEIN_LOW");
    expect(low).toMatchObject({ domain: "protein", severity: "watch" });
    const over = find(quietWeek(uniform(1950)), "INTAKE_AVG_VS_TARGET")[0]!;
    expect(low!.priority).toBeGreaterThan(over.priority);
    expect(low!.priority).toBeGreaterThan(find(quietWeek({ sleep: [5, 5, 5].map((hours, i) => ({ date: day(i), hours })) }), "SLEEP_SHORT")[0]!.priority);
  });
  test("params", () => {
    expect(find(protein(58), "PROTEIN_LOW")[0]!.params).toEqual({ avgG: 58, targetG: 110, pct: 53, shortG: 52 });
  });
});

describe("FOOD_PATTERN", () => {
  const items = (names: string[], meal = "makan_siang") => names.map((name, i) => ({ date: day(i % 5), meal: `${meal}${i}`, name, kcal: 300 }));
  test("a pattern from the item names reaches the facts, with our own terms only", () => {
    const [hit] = find(quietWeek({ food: items(["Ayam goreng", "Tahu goreng", "Gorengan", "Pisang goreng"]) }), "FOOD_PATTERN");
    expect(hit).toMatchObject({ variant: "fried", params: { count: 4, days: 4 } });
    expect(String(hit!.params.examples)).not.toContain("Pisang");
  });
  test("items of a day that is not judged yet are ignored", () => {
    const running = quietWeek(
      { today: day(2), food: items(["Ayam goreng", "Tahu goreng", "Gorengan", "Pisang goreng"]) },
      { today: day(2), eaten: [1500, 1500, 1500, 0, 0, 0, 0] },
    );
    expect(find(running, "FOOD_PATTERN")).toHaveLength(0);
  });
  test("Naikin BB only hears about fried food, Hamil / Menyusui not about starch", () => {
    const food = [
      ...items(["Ayam goreng", "Tahu goreng", "Gorengan", "Pisang goreng"]),
      ...items(["Es teh manis", "Donat", "Es krim", "Boba"], "snack"),
      ...["a", "b", "c"].flatMap((m, i) => [
        { date: day(i), meal: `d${m}`, name: "Nasi putih", kcal: 200 },
        { date: day(i), meal: `d${m}`, name: "Mie ayam", kcal: 300 },
      ]),
    ];
    const kinds = (mode: ReflectionInput["mode"]) => find(quietWeek({ mode, food }), "FOOD_PATTERN").map((f) => f.variant).toSorted();
    expect(kinds("lose")).toEqual(["double_carb", "fried", "sweet"]);
    expect(kinds("gain")).toEqual(["fried"]);
    expect(kinds("maternal")).toEqual(["fried", "sweet"]);
  });
  test("under 3 logged days there is nothing to call a pattern", () => {
    const sparse = quietWeek({ recap: recapOf({ eaten: [1500, 1500, 0, 0, 0, 0, 0] }), food: items(["Ayam goreng", "Tahu goreng", "Gorengan", "Pisang goreng"]) });
    expect(find(sparse, "FOOD_PATTERN")).toHaveLength(0);
  });
});

describe("ACTIVE_WEEK", () => {
  const active = (exercise: ReflectionInput["exercise"], mode: ReflectionInput["mode"] = "lose") => find(quietWeek({ exercise, mode }), "ACTIVE_WEEK");
  test("3 sessions, 3 active days or 150 minutes", () => {
    expect(active({ sessions: 3, minutes: 60, activeDays: 2 })).toHaveLength(1);
    expect(active({ sessions: 2, minutes: 60, activeDays: 3 })).toHaveLength(1);
    expect(active({ sessions: 1, minutes: 150, activeDays: 1 })).toHaveLength(1);
    expect(active({ sessions: 2, minutes: 149, activeDays: 2 })).toHaveLength(0);
  });
  test("Hamil / Menyusui gets the gentle wording", () => {
    expect(active({ sessions: 3, minutes: 90, activeDays: 3 }, "maternal")[0]!.variant).toBe("maternal");
  });
});

const zoned = (z45Sec: number, totalSec: number, over: Partial<WorkoutInput> = {}): WorkoutInput => {
  const rest = totalSec - z45Sec;
  return {
    start: 1,
    date: day(2),
    kind: "run",
    durationMin: totalSec / 60,
    distanceKm: 5,
    avgHr: 150,
    maxHr: 170,
    zones: { maxHr: 190, sec: [rest / 3, rest / 3, rest / 3, z45Sec / 2, z45Sec / 2], belowSec: 0 },
    ...over,
  };
};

describe("RUN_INTENSITY", () => {
  const hard = (w: WorkoutInput, over: Partial<ReflectionInput> = {}) => find(quietWeek({ workouts: [w], ...over }), "RUN_INTENSITY");
  test("5 minutes in zones 4-5 and 40% of the session is hard; 299 s or 39% is not", () => {
    expect(hard(zoned(300, 750))).toHaveLength(1);
    expect(hard(zoned(299, 750))).toHaveLength(0);
    expect(hard(zoned(300, 770))).toHaveLength(0);
  });
  test("a sport that is not a run gets generic advice", () => {
    expect(hard(zoned(300, 600))[0]!.variant).toBe("hard_run");
    expect(hard(zoned(300, 600, { kind: "ride" }))[0]!.variant).toBe("hard_other");
  });
  test("a workout without an analysis cannot be judged", () => {
    expect(hard({ ...zoned(300, 600), zones: null })).toHaveLength(0);
  });
  test("a BMI of 30 with an average heart rate of 85% of the zone maximum (or 160 bpm) says to see a doctor", () => {
    const heavy = { person: { gender: "male", heightCm: 100, ageYears: 40, weightKg: 30, targetKg: null, targetDate: null } };
    const bmi = (kg: number, w: WorkoutInput) => hard(w, { person: { ...heavy.person, weightKg: kg } })[0]!.variant;
    expect(bmi(30, zoned(300, 600, { avgHr: 161 }))).toBe("hard_check_doctor");
    expect(bmi(29.9, zoned(300, 600, { avgHr: 161 }))).toBe("hard_run");
    expect(bmi(30, zoned(300, 600, { avgHr: 159 }))).toBe("hard_run");
    // Below 160 bpm in absolute terms, but 87% of a 160 bpm maximum.
    expect(bmi(30, zoned(300, 600, { avgHr: 140, zones: { maxHr: 160, sec: [0, 0, 0, 150, 150], belowSec: 0 } }))).toBe("hard_check_doctor");
  });
  test("the doctor line is an alert; a plain hard session is a watch", () => {
    const [plain] = hard(zoned(300, 600));
    expect(plain!.severity).toBe("watch");
    const [doctor] = hard(zoned(300, 600, { avgHr: 165 }), { person: { gender: "male", heightCm: 170, ageYears: 40, weightKg: 100, targetKg: null, targetDate: null } });
    expect(doctor).toMatchObject({ variant: "hard_check_doctor", severity: "alert" });
    expect(doctor!.priority).toBeGreaterThan(plain!.priority);
  });
  test("Hamil / Menyusui is told to ease off from 3 minutes, never to see how hard they can go", () => {
    const [m] = hard(zoned(180, 400), { mode: "maternal" });
    expect(m).toMatchObject({ variant: "hard_maternal", severity: "alert" });
  });
  test("the worst session carries the numbers", () => {
    const [hit] = hard(zoned(300, 600));
    expect(hit!.params).toMatchObject({ z45Min: 5, zoneFrom: 4, zoneTo: 5, z45SharePct: 50, workouts: 1, avgHrBpm: 150, maxHrBpm: 170 });
  });
  test("easy training is a win from 20 zoned minutes with under 20% in zones 4-5", () => {
    const easy = find(quietWeek({ workouts: [zoned(120, 1500)] }), "RUN_EASY");
    expect(easy).toHaveLength(1);
    expect(find(quietWeek({ workouts: [zoned(120, 1100)] }), "RUN_EASY")).toHaveLength(0);
    expect(find(quietWeek({ workouts: [zoned(400, 1500)] }), "RUN_EASY")).toHaveLength(0);
    expect(find(quietWeek({ workouts: [zoned(120, 1500)], mode: "maternal" }), "RUN_EASY")).toHaveLength(0);
  });
});

describe("LOAD_SPIKE", () => {
  const spike = (ratios: number[], workouts: WorkoutInput[] = []) => find(quietWeek({ loadRatios: ratios, workouts }), "LOAD_SPIKE");
  test("1.5 is a spike, 1.49 is not; 2.5 is an alert", () => {
    expect(spike([1.49])).toHaveLength(0);
    expect(spike([1.5])[0]).toMatchObject({ severity: "watch", params: { loadRatio: 1.5, spikeAt: 1.5 } });
    expect(spike([2.4])[0]!.severity).toBe("watch");
    expect(spike([2.5])[0]!.severity).toBe("alert");
  });
  test("the highest day of the week counts", () => {
    expect(spike([1.1, 4, 1.2])[0]!.params.loadRatio).toBe(4);
  });
  test("a flagged hard session carries the load itself", () => {
    const facts = buildFacts(quietWeek({ loadRatios: [3], workouts: [zoned(300, 600)] }));
    expect(facts.find((f) => f.code === "RUN_INTENSITY")!.params.loadRatio).toBe(3);
  });
});

describe("SLEEP", () => {
  const nights = (hours: number[]) => ({ sleep: hours.map((h, i) => ({ date: day(i), hours: h })) });
  test("an average under 7 h is short, 7 h with 4 nights is a win", () => {
    expect(find(quietWeek(nights([6.9, 6.9, 6.9])), "SLEEP_SHORT")).toHaveLength(1);
    expect(find(quietWeek(nights([7, 7, 7])), "SLEEP_SHORT")).toHaveLength(0);
    expect(find(quietWeek(nights([7, 7, 7])), "SLEEP_OK")).toHaveLength(0);
    expect(find(quietWeek(nights([7, 7, 7, 7])), "SLEEP_OK")).toHaveLength(1);
  });
  test("fewer than 3 nights is not judged", () => {
    expect(find(quietWeek(nights([4, 4])), "SLEEP_SHORT")).toHaveLength(0);
  });
  test("very short sleep ranks above short sleep", () => {
    const rank = (h: number) => find(quietWeek(nights([h, h, h])), "SLEEP_SHORT")[0]!.priority;
    expect(rank(5.4)).toBeGreaterThan(rank(6.4));
    expect(rank(6.4)).toBeGreaterThan(rank(6.9));
  });
  test("params carry min, max, the short nights and the need", () => {
    expect(find(quietWeek(nights([5, 6.4, 5.5, 6, 6.2])), "SLEEP_SHORT")[0]!.params).toEqual({ avgHours: 5.8, minHours: 5, maxHours: 6.4, nights: 5, shortNights: 2, needHours: 8 });
  });
});

describe("SLEEP_FACTOR", () => {
  const factsOf = (findings: readonly SleepFinding[], over: Partial<ReflectionInput> = {}) => find(consentOnWeek(findings, over), "SLEEP_FACTOR");

  test("without findings (free account, switch off) nothing is emitted", () => {
    expect(find(quietWeek({}), "SLEEP_FACTOR")).toHaveLength(0);
    expect(factsOf([])).toHaveLength(0);
    expect(find(quietWeek({ sleepFindings: [] }), "SLEEP_FACTOR")).toHaveLength(0);
  });

  test("each variant carries only the numbers of the finding and the confidence", () => {
    for (const factor of ["caffeine", "regularity", "temperature", "humidity", "dinner", "workout"] as const) {
      const [f] = factsOf([sleepFinding(factor, { exposed: 6, other: 11, confidence: "leaning" })]);
      expect(f).toMatchObject({ variant: factor, role: "focus", domain: "sleep", severity: "info", priority: T.sleepFactorPriority });
      const room = factor === "temperature" || factor === "humidity";
      expect(Object.keys(f!.params).toSorted()).toEqual(room ? ["confidence", "exposed", "minutes", "other", "value"] : ["confidence", "exposed", "minutes", "other"]);
      if (room) expect(f!.params.value).toBe(factor === "temperature" ? 28 : 70);
      expect(f!.params).toMatchObject({ exposed: 6, other: 11, confidence: "leaning" });
    }
  });

  test("the difference is rounded to whole minutes and written without a sign", () => {
    expect(factsOf([sleepFinding("caffeine", { diff: -33.6 })])[0]!.params.minutes).toBe(34);
    expect(factsOf([sleepFinding("dinner", { diff: 17.4 })])[0]!.params.minutes).toBe(17);
  });

  test("a difference that rounds to 0 minutes is not a pattern", () => {
    expect(factsOf([sleepFinding("caffeine", { diff: -0.4 })])).toHaveLength(0);
    expect(factsOf([sleepFinding("caffeine", { diff: -0.5 })])).toHaveLength(1);
  });

  test("only the unfavourable direction of each factor becomes a focus point", () => {
    expect(factsOf([sleepFinding("caffeine", { diff: 20 })])).toHaveLength(0);
    expect(factsOf([sleepFinding("regularity", { diff: 20 })])).toHaveLength(0);
    expect(factsOf([sleepFinding("dinner", { diff: -20 })])).toHaveLength(0);
    expect(factsOf([sleepFinding("temperature", { diff: -20 })])).toHaveLength(0);
    expect(factsOf([sleepFinding("humidity", { diff: -20 })])).toHaveLength(0);
    expect(factsOf([sleepFinding("workout", { diff: -20 })])).toHaveLength(0);
  });

  test("a finding on another outcome than its factor's is ignored", () => {
    expect(factsOf([sleepFinding("caffeine", { outcome: "awake", diff: 20 })])).toHaveLength(0);
    expect(factsOf([sleepFinding("dinner", { outcome: "asleep", diff: -20 })])).toHaveLength(0);
  });

  test("a bedroom finding without its cut-off is not worded", () => {
    expect(factsOf([sleepFinding("temperature", { threshold: null })])).toHaveLength(0);
    expect(factsOf([sleepFinding("humidity", { threshold: null }), sleepFinding("dinner")]).map((f) => f.variant)).toEqual(["dinner"]);
  });

  test("alcohol is never worded, even when a finding slips in", () => {
    const alcohol = { ...sleepFinding("caffeine"), factor: "alcohol", outcome: "hrv", diff: -9 } as unknown as SleepFinding;
    expect(factsOf([alcohol])).toHaveLength(0);
    expect(factsOf([alcohol, sleepFinding("dinner")]).map((f) => f.variant)).toEqual(["dinner"]);
  });

  test("at most one per week: leaning before maybe, then more exposed nights, then caffeine, regularity, temperature, humidity, dinner, workout", () => {
    const all = (over: Partial<Record<"caffeine" | "regularity" | "temperature" | "humidity" | "dinner" | "workout", Partial<SleepFinding>>> = {}) =>
      (["workout", "dinner", "humidity", "temperature", "regularity", "caffeine"] as const).map((factor) => sleepFinding(factor, over[factor]));
    expect(factsOf(all())).toHaveLength(1);
    expect(factsOf(all())[0]!.variant).toBe("caffeine");
    expect(factsOf(all({ dinner: { confidence: "leaning" }, workout: { confidence: "leaning" } }))[0]!.variant).toBe("dinner");
    expect(factsOf(all({ humidity: { confidence: "leaning" }, dinner: { confidence: "leaning" } }))[0]!.variant).toBe("humidity");
    expect(factsOf(all({ humidity: { exposed: 8 }, temperature: { exposed: 8 } }))[0]!.variant).toBe("temperature");
    expect(factsOf(all({ regularity: { exposed: 9 }, workout: { exposed: 9 } }))[0]!.variant).toBe("regularity");
    expect(factsOf(all({ caffeine: { exposed: 4 }, workout: { exposed: 7, confidence: "maybe" } }))[0]!.variant).toBe("workout");
    expect(factsOf(all({ caffeine: { confidence: "maybe", exposed: 20 }, workout: { confidence: "leaning", exposed: 3 } }))[0]!.variant).toBe("workout");
  });

  test("the pattern the previous week showed makes way for another, and comes back when it is the only one", () => {
    const two = [sleepFinding("caffeine"), sleepFinding("dinner")];
    expect(factsOf(two, { previousSleepFactor: "caffeine" })[0]!.variant).toBe("dinner");
    expect(factsOf(two, { previousSleepFactor: "dinner" })[0]!.variant).toBe("caffeine");
    expect(factsOf([sleepFinding("caffeine")], { previousSleepFactor: "caffeine" })[0]!.variant).toBe("caffeine");
    expect(factsOf(two, { previousSleepFactor: null })[0]!.variant).toBe("caffeine");
    // An ineligible finding does not count as "another".
    expect(factsOf([sleepFinding("caffeine"), sleepFinding("dinner", { diff: -5 })], { previousSleepFactor: "caffeine" })[0]!.variant).toBe("caffeine");
  });

  test("a quiet week with a finding selects it as a focus point", () => {
    const sel = reflectionFacts(consentOnWeek());
    expect(sel.focus.map((f) => `${f.code}/${f.variant}`)).toContain("SLEEP_FACTOR/caffeine");
  });

  test("safety ordering stays: an alert-level run still comes first and a full list leaves no room", () => {
    const owner = { ...ownerWeek(), sleepFindings: [sleepFinding("caffeine", { confidence: "leaning" })] };
    const sel = reflectionFacts(owner);
    expect(sel.focus[0]!.code).toBe("RUN_INTENSITY");
    expect(sel.all.filter((f) => f.code === "SLEEP_FACTOR")).toHaveLength(1);
    expect(sel.focus.filter((f) => f.code === "SLEEP_FACTOR")).toHaveLength(0);
    expect(selectionSignature(sel)).toBe(selectionSignature(reflectionFacts(ownerWeek())));
  });

  test("it ranks below other sleep and every other focus point of the same domain pass", () => {
    const short = { sleep: [5, 6, 5.5, 6].map((hours, i) => ({ date: day(i), hours })) };
    const sel = reflectionFacts(consentOnWeek(undefined, short));
    const codes = sel.focus.map((f) => f.code);
    expect(codes.indexOf("SLEEP_SHORT")).toBeLessThan(codes.indexOf("SLEEP_FACTOR"));
  });

  test("at most one SLEEP_FACTOR is ever selected", () => {
    const sel = reflectionFacts(consentOnWeek(["caffeine", "dinner", "workout", "regularity", "temperature", "humidity"].map((f) => sleepFinding(f as "caffeine"))));
    expect([...sel.wins, ...sel.focus].filter((f) => f.code === "SLEEP_FACTOR")).toHaveLength(1);
  });

  test("the signature carries the pattern and changes with it and with the confidence", () => {
    const sig = (f: SleepFinding) => selectionSignature(reflectionFacts(consentOnWeek([f])));
    const base = selectionSignature(reflectionFacts(quietWeek({})));
    expect(sleepFactorOfSignature(base)).toBeNull();
    expect(sleepFactorOfSignature(sig(sleepFinding("caffeine")))).toBe("caffeine");
    expect(sleepFactorOfSignature(sig(sleepFinding("dinner")))).toBe("dinner");
    expect(sig(sleepFinding("caffeine"))).not.toBe(base);
    expect(sig(sleepFinding("caffeine"))).not.toBe(sig(sleepFinding("dinner")));
    expect(sig(sleepFinding("caffeine"))).not.toBe(sig(sleepFinding("caffeine", { confidence: "leaning" })));
    // A change of a few percent keeps the fingerprint.
    expect(sig(sleepFinding("caffeine", { diff: -34 }))).toBe(sig(sleepFinding("caffeine", { diff: -33 })));
  });
});

describe("STEPS", () => {
  const steps = (values: number[]) => ({ steps: values.map((s, i) => ({ date: day(i), steps: s })) });
  test("under 5000 is low, 8000 is good, between is quiet", () => {
    expect(find(quietWeek(steps([4999, 4999, 4999])), "LOW_STEPS")).toHaveLength(1);
    expect(find(quietWeek(steps([5000, 5000, 5000])), "LOW_STEPS")).toHaveLength(0);
    expect(find(quietWeek(steps([7999, 7999, 7999])), "STEPS_GOOD")).toHaveLength(0);
    expect(find(quietWeek(steps([8000, 8000, 8000])), "STEPS_GOOD")).toHaveLength(1);
  });
  test("a day under 500 steps is a watch left at home: it is counted aside, not averaged in", () => {
    const [low] = find(quietWeek(steps([4000, 4000, 4000, 0, 120])), "LOW_STEPS");
    expect(low!.params).toEqual({ avgSteps: 4000, days: 3, thinDays: 2, lowDays: 0 });
  });
  test("3 measured days are needed", () => {
    expect(find(quietWeek(steps([1000, 1000, 0, 0])), "LOW_STEPS")).toHaveLength(0);
  });
  test("not for Hamil / Menyusui", () => {
    expect(find(quietWeek({ mode: "maternal", ...steps([1000, 1000, 1000]) }), "LOW_STEPS")).toHaveLength(0);
  });
});

describe("selection", () => {
  const f = (code: Fact["code"], role: Fact["role"], priority: number, domain: Fact["domain"], variant = "x"): Fact => ({ code, variant, role, severity: "info", priority, domain, params: {} });

  test("at most 3 wins, best first", () => {
    const wins = (["LOG_STREAK", "PROTEIN_OK", "SLEEP_OK", "STEPS_GOOD", "ACTIVE_WEEK"] as const).map((code, i) => f(code, "win", 50 + i, "data"));
    expect(selectFacts(wins).wins.map((x) => x.code)).toEqual(["ACTIVE_WEEK", "STEPS_GOOD", "SLEEP_OK"]);
  });

  test("the best point of each domain comes before a second point of one domain", () => {
    const focus = [f("INTAKE_AVG_VS_TARGET", "focus", 90, "food"), f("PROTEIN_LOW", "focus", 85, "food"), f("RUN_INTENSITY", "focus", 60, "move"), f("SLEEP_SHORT", "focus", 50, "sleep")];
    expect(selectFacts(focus).focus.map((x) => x.code)).toEqual(["INTAKE_AVG_VS_TARGET", "RUN_INTENSITY", "SLEEP_SHORT"]);
  });

  test("with fewer domains a second point of a domain fills the list, never a third", () => {
    const focus = [f("INTAKE_AVG_VS_TARGET", "focus", 90, "food"), f("PROTEIN_LOW", "focus", 85, "food"), f("FOOD_PATTERN", "focus", 80, "food", "fried"), f("RUN_INTENSITY", "focus", 10, "move")];
    expect(selectFacts(focus).focus.map((x) => x.code)).toEqual(["INTAKE_AVG_VS_TARGET", "PROTEIN_LOW", "RUN_INTENSITY"]);
    expect(selectFacts(focus.slice(0, 3)).focus.map((x) => x.code)).toEqual(["INTAKE_AVG_VS_TARGET", "PROTEIN_LOW"]);
  });

  test("equal priorities break the tie the same way every time", () => {
    const a = [f("SLEEP_SHORT", "focus", 70, "sleep"), f("LOW_STEPS", "focus", 70, "move")];
    expect(selectFacts(a).focus.map((x) => x.code)).toEqual(selectFacts([...a].reverse()).focus.map((x) => x.code));
  });

  test("a week with one logged day has no wins and only the logging nudges", () => {
    const sparse = reflectionFacts(quietWeek({}, { eaten: [1500, 0, 0, 0, 0, 0, 0], streakDays: 0 }));
    expect(sparse.wins).toEqual([]);
    expect(sparse.focus.map((x) => x.code)).toEqual(["LOG_GAPS", "WEIGH_INS"]);
  });
});

describe("the owner's week", () => {
  const owner = reflectionFacts(ownerWeek());

  test("wins: the logging streak and the 5 weigh-ins", () => {
    expect(owner.wins.map((x) => `${x.code}/${x.variant}`)).toEqual(["LOG_STREAK/streak", "WEIGH_INS/regular"]);
  });

  test("focus: the hard run with the doctor line first, then protein, then intake (sleep drops)", () => {
    expect(owner.focus.map((x) => `${x.code}/${x.variant}`)).toEqual(["RUN_INTENSITY/hard_check_doctor", "PROTEIN_LOW/low", "INTAKE_AVG_VS_TARGET/over"]);
  });

  test("every number of the story is in the facts", () => {
    const all = owner.all;
    const get = (code: Fact["code"], variant?: string) => all.find((x) => x.code === code && (variant === undefined || x.variant === variant))!.params;
    expect(get("INTAKE_AVG_VS_TARGET")).toMatchObject({ avgKcal: 1950, targetKcal: 1500, diffKcal: 450 });
    expect(get("PROTEIN_LOW")).toMatchObject({ avgG: 58, targetG: 110 });
    expect(get("RUN_INTENSITY")).toMatchObject({ avgHrBpm: 163, maxHrBpm: 177, z45Min: 8, loadRatio: 4, distanceKm: 1 });
    expect(get("MEASURE_ANOMALY", "waist")).toMatchObject({ deltaCm: 10, days: 5 });
    expect(get("WEIGH_INS")).toMatchObject({ count: 5 });
    expect(get("WEIGHT_PACE")).toMatchObject({ kgPerWeek: 0.3, neededKgPerWeek: 1.67 });
    expect(get("SLEEP_SHORT")).toMatchObject({ minHours: 5, maxHours: 6.4 });
    expect(all.map((x) => x.code)).toContain("LOW_STEPS");
    expect(all.map((x) => x.code)).toContain("FOOD_PATTERN");
  });

  test("Hamil / Menyusui on the same week gets no weight, pace, steps or weight-loss pressure", () => {
    const m = reflectionFacts({ ...ownerWeek(), mode: "maternal" });
    const codes = m.all.map((x) => x.code);
    for (const banned of ["WEIGHT_PACE", "WEIGH_INS", "MEASURE_ANOMALY", "LOW_STEPS", "STEPS_GOOD"] as const) expect(codes).not.toContain(banned);
    expect(m.all.find((x) => x.code === "RUN_INTENSITY")!.variant).toBe("hard_maternal");
    expect(m.all.find((x) => x.code === "INTAKE_AVG_VS_TARGET")).toBeUndefined();
    expect(m.all.find((x) => x.code === "LOG_STREAK")!.variant).not.toBe("streak");
  });
});

describe("selectionSignature", () => {
  test("is stable for the same week and for a change of a few percent", () => {
    const a = selectionSignature(reflectionFacts(ownerWeek()));
    expect(selectionSignature(reflectionFacts(ownerWeek()))).toBe(a);
    const nudged = ownerWeek();
    nudged.recap = { ...nudged.recap, avgKcal: 1960 };
    expect(selectionSignature(reflectionFacts(nudged))).toBe(a);
  });
  test("changes when the facts do", () => {
    const a = selectionSignature(reflectionFacts(ownerWeek()));
    const changed = ownerWeek();
    changed.recap = { ...changed.recap, avgKcal: 1500 };
    expect(selectionSignature(reflectionFacts(changed))).not.toBe(a);
    const slept = { ...ownerWeek(), sleep: ownerWeek().sleep.map((s) => ({ ...s, hours: 7.5 })) };
    expect(selectionSignature(reflectionFacts(slept))).not.toBe(a);
  });
});

test("T constants stay in sync with what the docs promise", () => {
  expect(T.maxWins).toBe(3);
  expect(T.maxFocus).toBe(3);
});
