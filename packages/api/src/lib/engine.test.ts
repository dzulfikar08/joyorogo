import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_LABELS,
  MEAL_LABELS,
  adaptiveTdee,
  bmrMifflin,
  checkTargetDate,
  computeBurn,
  computeDeficit,
  computeTargets,
  daysBetween,
  eatTone,
  effectiveRamadan,
  idealWeightRange,
  isRamadanDate,
  jakartaToday,
  needsBreakdown,
  proteinTargetG,
  ramadanSplit,
  remainingKcal,
  shiftDate,
  slotsFor,
  streakFromDates,
  suggestMealForDish,
  suggestMealNow,
  weightTrend,
} from "./engine";

const TODAY = "2026-09-13";

const baseProfile = {
  birthYear: 1996, // age 30 at TODAY
  gender: "male" as const,
  heightCm: 170,
  weightKg: 90,
  targetWeightKg: 70,
  targetDate: "2026-12-12", // 90 days out
  activityLevel: "low" as const,
};

describe("bmrMifflin", () => {
  test("known male value", () => {
    expect(bmrMifflin(70, 170, 30, "male")).toBe(1617.5);
  });

  test("female offset", () => {
    expect(bmrMifflin(60, 160, 28, "female")).toBe(1299);
  });
});

describe("jakartaToday", () => {
  test("17:30 UTC is already the next WIB day", () => {
    expect(jakartaToday(new Date("2026-09-13T17:30:00Z"))).toBe("2026-09-14");
  });

  test("16:59 UTC is still the same WIB day", () => {
    expect(jakartaToday(new Date("2026-09-13T16:59:59Z"))).toBe("2026-09-13");
  });
});

describe("streakFromDates", () => {
  test("no logs, no streak", () => {
    expect(streakFromDates([], TODAY)).toBe(0);
  });

  test("counts back from a logged today", () => {
    expect(streakFromDates(["2026-09-13", "2026-09-12", "2026-09-11"], TODAY)).toBe(3);
  });

  test("today not logged yet still keeps the streak via yesterday", () => {
    expect(streakFromDates(["2026-09-12", "2026-09-11"], TODAY)).toBe(2);
  });

  test("a gap breaks the streak", () => {
    expect(streakFromDates(["2026-09-13", "2026-09-11", "2026-09-10"], TODAY)).toBe(1);
  });

  test("input order does not matter", () => {
    expect(streakFromDates(["2026-09-11", "2026-09-13", "2026-09-12"], TODAY)).toBe(3);
  });
});

describe("daysBetween", () => {
  test("counts calendar days", () => {
    expect(daysBetween("2026-09-13", "2026-12-12")).toBe(90);
    expect(daysBetween("2026-09-13", "2026-09-13")).toBe(0);
  });
});

describe("idealWeightRange", () => {
  test("BMI 18.5-24.9 bounds for 170 cm", () => {
    expect(idealWeightRange(170)).toEqual({ minKg: 53, maxKg: 72 });
  });
});

describe("computeTargets", () => {
  test("aggressive plan is clamped: deficit capped", () => {
    const t = computeTargets(baseProfile, { today: TODAY });
    // bmr 1817.5 (at 90kg), tdee 2271.875, needed deficit 1711 -> 1000
    expect(t.bmr).toBe(1818);
    expect(t.rawDeficitKcal).toBe(1711);
    expect(t.deficitKcal).toBe(1000);
    // burn = round5(3.3*90) = 295
    expect(t.burnKcal).toBe(295);
    // eat = round5(2271.875 - 705) = 1565
    expect(t.eatKcal).toBe(1565);
    expect(t.notes).toContain("PLAN_CLAMPED");
    expect(t.notes).not.toContain("BELOW_HEALTHY_RANGE");
    expect(t.sleepHours).toBe(8);
  });

  test("below-healthy-range target is flagged, not blocked", () => {
    const t = computeTargets({ ...baseProfile, targetWeightKg: 45 }, { today: TODAY });
    expect(t.notes).toContain("BELOW_HEALTHY_RANGE");
  });

  test("at or below target weight switches to maintenance", () => {
    const t = computeTargets(
      { ...baseProfile, weightKg: 68, targetWeightKg: 70 },
      { today: TODAY },
    );
    expect(t.deficitKcal).toBe(0);
    expect(t.notes).toContain("MAINTENANCE");
    // eat = round5(tdee) with no deficit
    expect(t.eatKcal).toBe(t.tdee - (t.tdee % 5) || t.tdee);
  });

  test("female eat never drops below 1200", () => {
    const t = computeTargets(
      {
        birthYear: 2000, // age 26
        gender: "female",
        heightCm: 150,
        weightKg: 45,
        targetWeightKg: 42,
        targetDate: "2026-09-20", // 7 days: needed ~3300 -> capped
        activityLevel: "low",
      },
      { today: TODAY },
    );
    expect(t.eatKcal).toBe(1200);
    expect(t.notes).toContain("PLAN_CLAMPED");
  });

  test("burn target stays inside 200..400", () => {
    const small = computeTargets({ ...baseProfile, weightKg: 50 }, { today: TODAY });
    expect(small.burnKcal).toBe(200);
    const large = computeTargets({ ...baseProfile, weightKg: 130 }, { today: TODAY });
    expect(large.burnKcal).toBe(400);
  });

  test("uses latest known weight when provided", () => {
    const t = computeTargets(baseProfile, { today: TODAY, weightNow: 80 });
    // bmr at 80kg = 1717.5, tdee 2146.875
    expect(t.bmr).toBe(1718);
    expect(t.burnKcal).toBe(265); // round5(3.3*80) = 264 -> 265
    // needed deficit (80-70)*7700/90 = 856, inside clamp window
    expect(t.deficitKcal).toBe(856);
    expect(t.notes).not.toContain("PLAN_CLAMPED");
    expect(t.eatKcal).toBe(1555);
  });

  test("past target date clamps to 1-day plan, not a crash", () => {
    const t = computeTargets({ ...baseProfile, targetDate: "2026-09-01" }, { today: TODAY });
    expect(t.deficitKcal).toBe(1000);
    expect(t.notes).toContain("PLAN_CLAMPED");
  });
});

describe("labels", () => {
  test("meal and activity labels are Bahasa Indonesia", () => {
    expect(MEAL_LABELS.makan_siang).toBe("Makan Siang");
    expect(ACTIVITY_LABELS.low).toBe("Jarang gerak");
  });
});

describe("computeBurn", () => {
  // bmr 1817.5 at 90 kg, low multiplier 1.25
  const NOON_WIB = new Date("2026-09-13T05:00:00Z"); // half the WIB day elapsed
  const logs = [
    { kcal: 200, source: "manual" },
    { kcal: 95, source: "strava" },
    { kcal: 50, source: "rest" },
  ];

  test("prorates BMR x activity by elapsed WIB day and adds exercise", () => {
    const burn = computeBurn({ profile: baseProfile, exerciseLogs: logs, now: NOON_WIB });
    // 1817.5 * 1.25 * 0.5
    expect(burn.bmrKcal).toBe(1817.5);
    expect(burn.activityKcal).toBeCloseTo(1135.9375);
    expect(burn.exerciseKcal).toBe(295);
    expect(burn.burnKcal).toBeCloseTo(1430.9375);
  });

  test("rest rows never count toward exercise burn", () => {
    const burn = computeBurn({
      profile: baseProfile,
      exerciseLogs: [{ kcal: 50, source: "rest" }],
      now: NOON_WIB,
    });
    expect(burn.exerciseKcal).toBe(0);
  });

  test("weightNowKg overrides profile weight for BMR", () => {
    const burn = computeBurn({
      profile: baseProfile,
      weightNowKg: 80,
      exerciseLogs: [],
      now: NOON_WIB,
    });
    // 1717.5 * 1.25 * 0.5
    expect(burn.activityKcal).toBeCloseTo(1073.4375);
  });

  test("midnight WIB has no activity burn yet", () => {
    const burn = computeBurn({
      profile: baseProfile,
      exerciseLogs: [{ kcal: 100 }],
      now: new Date("2026-09-12T17:00:00Z"), // 00:00 WIB
    });
    expect(burn.activityKcal).toBe(0);
    expect(burn.burnKcal).toBe(100);
  });

  test("dayFraction 1 counts a full day (past summaries)", () => {
    const burn = computeBurn({
      profile: baseProfile,
      exerciseLogs: [],
      dayFraction: 1,
      now: NOON_WIB,
    });
    expect(burn.activityKcal).toBeCloseTo(2271.875);
    expect(burn.burnKcal).toBeCloseTo(2271.875);
  });
});

describe("computeDeficit (legacy day.summary field)", () => {
  const NOON_WIB = new Date("2026-09-13T05:00:00Z");

  test("burn minus eaten, gap from the eat budget", () => {
    const burn = computeBurn({
      profile: baseProfile,
      exerciseLogs: [
        { kcal: 200, source: "manual" },
        { kcal: 95, source: "strava" },
      ],
      now: NOON_WIB,
    });
    const d = computeDeficit(1200, burn, 1565);
    expect(d.deficitKcal).toBe(231);
    expect(d.targetGap).toBe(1796);
  });

  test("a negative figure means more eaten than burned", () => {
    const burn = computeBurn({ profile: baseProfile, exerciseLogs: [], now: NOON_WIB });
    expect(computeDeficit(2000, burn, 1565).deficitKcal).toBe(-864);
  });
});

describe("Ramadan schedule (US-022)", () => {
  test("isRamadanDate detects Ramadan 1447 H via Umm al-Qura", () => {
    // Ramadan 1447 H ≈ 19 Feb – 20 Mar 2026.
    expect(isRamadanDate(new Date("2026-03-01T12:00:00Z"))).toBe(true);
    expect(isRamadanDate(new Date("2026-04-05T12:00:00Z"))).toBe(false);
  });

  test("effectiveRamadan honors manual overrides", () => {
    expect(effectiveRamadan("on", new Date("2026-04-05T12:00:00Z"))).toBe(true);
    expect(effectiveRamadan("off", new Date("2026-03-01T12:00:00Z"))).toBe(false);
    expect(effectiveRamadan("auto", new Date("2026-03-01T12:00:00Z"))).toBe(true);
    expect(effectiveRamadan(undefined, new Date("2026-04-05T12:00:00Z"))).toBe(false);
  });

  test("budget split covers the eating window and sums to 1", () => {
    const split = ramadanSplit();
    expect(split.sahur + split.berbuka + split.snack).toBe(1);
    expect(split.makan_siang).toBe(0);
    expect(slotsFor(true)).toEqual(["berbuka", "snack", "sahur"]);
    expect(slotsFor(false)).toEqual(["sarapan", "makan_siang", "makan_malam", "snack"]);
  });

  test("suggestMealNow routes to eating-window slots in Ramadan", () => {
    const at = (h: number) => new Date(`2026-03-01T${String(h).padStart(2, "0")}:00:00+07:00`);
    expect(suggestMealNow(at(4), true)).toBe("sahur");
    expect(suggestMealNow(at(12), true)).toBe("berbuka"); // fasting hours → upcoming meal
    expect(suggestMealNow(at(19), true)).toBe("berbuka");
    expect(suggestMealNow(at(23), true)).toBe("snack");
    expect(suggestMealNow(at(12), false)).toBe("makan_siang");
  });

  test("suggestMealForDish: heavy dish never defaults to snack outside Ramadan", () => {
    const at = (h: string) => new Date(`2026-10-15T${h}:00+07:00`);
    // 16:19 WIB (prod nasi kuning case) sits in the snack gap.
    expect(suggestMealNow(at("16:19"), false)).toBe("snack");
    expect(suggestMealForDish(at("16:19"), false, true)).toBe("makan_malam");
    expect(suggestMealForDish(at("16:19"), false, false)).toBe("snack");
    expect(suggestMealForDish(at("19:00"), false, true)).toBe("makan_malam");
    expect(suggestMealForDish(at("12:00"), false, true)).toBe("makan_siang");
    expect(suggestMealForDish(at("23:00"), true, true)).toBe("snack");
  });
});

/** One weigh-in per day for `days` days ending the day before `end`. */
function series(end: string, days: number, kgAt: (i: number) => number) {
  return Array.from({ length: days }, (_, i) => ({
    date: shiftDate(end, i - days),
    weightKg: kgAt(i),
  }));
}

describe("weightTrend", () => {
  test("needs two weigh-ins", () => {
    expect(weightTrend([{ date: TODAY, weightKg: 80 }], 70, TODAY)).toBeNull();
  });

  test("steady 0.1 kg/day loss: rate, lagging trend, and projection agree", () => {
    const weighIns = series(TODAY, 28, (i) => 90 - 0.1 * i);
    const trend = weightTrend(weighIns, 80, TODAY)!;
    expect(trend.weeklyRateKg).toBeCloseTo(-0.7, 2);
    // EMA lags a falling scale, so the trend sits above the last reading.
    expect(trend.weightKg).toBeGreaterThan(weighIns.at(-1)!.weightKg);
    const daysOut = daysBetween(TODAY, trend.projectedDate!);
    // ceil adds ≤1 day; weightKg is rounded to 0.1 kg (≤0.5 day at 0.1 kg/day)
    expect(Math.abs(daysOut - (trend.weightKg - 80) / 0.1)).toBeLessThanOrEqual(1.5);
  });

  test("±1 kg daily water noise on a flat weight is not a trend", () => {
    const trend = weightTrend(
      series(TODAY, 28, (i) => (i % 2 === 0 ? 81 : 79)),
      70,
      TODAY,
    )!;
    expect(Math.abs(trend.weeklyRateKg!)).toBeLessThan(0.1);
    expect(Math.abs(trend.weightKg - 80)).toBeLessThan(0.6);
  });

  test("gaining or already at target never projects a date", () => {
    expect(
      weightTrend(
        series(TODAY, 20, (i) => 80 + 0.05 * i),
        70,
        TODAY,
      )!.projectedDate,
    ).toBeNull();
    expect(
      weightTrend(
        series(TODAY, 20, (i) => 69 - 0.05 * i),
        70,
        TODAY,
      )!.projectedDate,
    ).toBeNull();
  });

  test("rate waits for 10 days of span", () => {
    expect(
      weightTrend(
        series(TODAY, 7, (i) => 80 - 0.2 * i),
        70,
        TODAY,
      )!.weeklyRateKg,
    ).toBeNull();
  });
});

describe("adaptiveTdee", () => {
  const intake = (kcal: number, days = 28) =>
    Array.from({ length: days }, (_, i) => ({ date: shiftDate(TODAY, -1 - i), kcal }));
  const losing = series(TODAY, 28, (i) => 85 - 0.05 * i);

  test("energy balance: intake plus the energy the weight slope released", () => {
    // 2000 kcal/day while losing 0.05 kg/day → 2000 + 0.05 * 7700 = 2385
    expect(
      adaptiveTdee({
        date: TODAY,
        weighIns: losing,
        intake: intake(2000),
        exercise: [],
        minDayKcal: 900,
      }),
    ).toBe(2385);
  });

  test("logged exercise is carved out so Burn does not double count", () => {
    const exercise = intake(280);
    expect(
      adaptiveTdee({
        date: TODAY,
        weighIns: losing,
        intake: intake(2000),
        exercise,
        minDayKcal: 900,
      }),
    ).toBe(2385 - 280);
  });

  test("half-logged days are ignored, not read as fasting", () => {
    // every 4th day only breakfast got logged
    const withForgotten = intake(2000).map((d, i) => (i % 4 === 0 ? { ...d, kcal: 300 } : d));
    expect(
      adaptiveTdee({
        date: TODAY,
        weighIns: losing,
        intake: withForgotten,
        exercise: [],
        minDayKcal: 900,
      }),
    ).toBe(2385);
  });

  test("today's partial intake never enters the window", () => {
    const withToday = [...intake(2000), { date: TODAY, kcal: 150 }];
    expect(
      adaptiveTdee({
        date: TODAY,
        weighIns: losing,
        intake: withToday,
        exercise: [],
        minDayKcal: 900,
      }),
    ).toBe(2385);
  });

  test("too little data stays on the formula", () => {
    expect(
      adaptiveTdee({
        date: TODAY,
        weighIns: losing,
        intake: intake(2000, 10),
        exercise: [],
        minDayKcal: 900,
      }),
    ).toBeNull();
    expect(
      adaptiveTdee({
        date: TODAY,
        weighIns: losing.slice(-4),
        intake: intake(2000),
        exercise: [],
        minDayKcal: 900,
      }),
    ).toBeNull();
  });
});

describe("computeTargets with measured TDEE", () => {
  test("measured TDEE moves the plan at most 15% from the formula", () => {
    const t = computeTargets(baseProfile, { today: TODAY, adaptiveTdee: 4000 });
    expect(t.formulaTdee).toBe(2272); // 1817.5 * 1.25
    expect(t.tdee).toBe(Math.round(2271.875 * 1.15));
    expect(t.notes).toContain("ADAPTIVE");
    const low = computeTargets(baseProfile, { today: TODAY, adaptiveTdee: 1000 });
    expect(low.tdee).toBe(Math.round(2271.875 * 0.85));
  });

  test("formula plan carries no ADAPTIVE note and tdee equals formulaTdee", () => {
    const t = computeTargets(baseProfile, { today: TODAY });
    expect(t.notes).not.toContain("ADAPTIVE");
    expect(t.tdee).toBe(t.formulaTdee);
  });
});

describe("proteinTargetG", () => {
  test("scales with weight up to the top of the healthy range", () => {
    expect(proteinTargetG(60, 170)).toBe(90);
    // 170 cm healthy max is 72 kg: 130 kg asks for 108 g, not 195 g
    expect(proteinTargetG(130, 170)).toBe(108);
  });
});

describe("eatTone", () => {
  test("amber from exactly 90%, red only past 100%", () => {
    expect(eatTone(1799, 2000)).toBe("ok");
    expect(eatTone(1800, 2000)).toBe("near");
    expect(eatTone(2000, 2000)).toBe("near");
    expect(eatTone(2001, 2000)).toBe("over");
  });
  test("no target yet stays neutral", () => {
    expect(eatTone(500, 0)).toBe("ok");
  });
});

describe("checkTargetDate", () => {
  const base = { weightNowKg: 80, targetWeightKg: 70, today: TODAY };

  test("future dates only: today, the past and non-dates are refused", () => {
    expect(checkTargetDate({ ...base, targetDate: TODAY }).status).toBe("past");
    expect(checkTargetDate({ ...base, targetDate: "2026-09-01" }).status).toBe("past");
    expect(checkTargetDate({ ...base, targetDate: "2026-02-30" }).status).toBe("invalid");
    expect(checkTargetDate({ ...base, targetDate: "besok" }).status).toBe("invalid");
    expect(checkTargetDate({ ...base, targetDate: "2026-09-14" }).status).toBe("fast");
  });

  test("a date beyond five years is refused", () => {
    expect(checkTargetDate({ ...base, targetDate: "2032-01-01" }).status).toBe("tooFar");
  });

  test("a pace inside 250-1000 kcal/day is ok and matches computeTargets", () => {
    const check = checkTargetDate({ ...base, targetDate: "2026-12-12" }); // 90 days
    expect(check).toMatchObject({ status: "ok", days: 90, rawDeficitKcal: 856, deficitKcal: 856 });
    const targets = computeTargets({ ...baseProfile, weightKg: 80 }, { today: TODAY });
    expect(targets.deficitKcal).toBe(856);
  });

  test("more than 1000 kcal/day is fast and offers the realistic length", () => {
    const check = checkTargetDate({ ...base, targetDate: "2026-10-13" }); // 30 days
    expect(check).toMatchObject({ status: "fast", rawDeficitKcal: 2567, deficitKcal: 1000 });
    if (check.status !== "fast") throw new Error("unreachable");
    expect(check.feasibleDays).toBe(77); // 10 kg * 7700 / 1000
  });

  test("under 250 kcal/day is slow: the plan holds the floor and finishes earlier", () => {
    const check = checkTargetDate({ ...base, targetDate: "2029-09-13" }); // 1096 days
    if (check.status !== "slow") throw new Error(`expected slow, got ${check.status}`);
    expect(check.rawDeficitKcal).toBe(70);
    expect(check.deficitKcal).toBe(250);
    expect(check.feasibleDays).toBe(308);
  });

  test("already at the goal weight: the date changes nothing", () => {
    expect(checkTargetDate({ ...base, weightNowKg: 70, targetDate: "2026-12-12" }).status).toBe(
      "maintenance",
    );
  });

  test("moving the date moves the daily target inside the safe window", () => {
    const at = (targetDate: string) =>
      computeTargets({ ...baseProfile, weightKg: 80, targetDate }, { today: TODAY });
    expect(at("2026-11-12").eatKcal).toBeLessThan(at("2027-01-12").eatKcal);
    expect(at("2026-11-12").deficitKcal).toBeGreaterThan(at("2027-01-12").deficitKcal);
  });
});

describe("remainingKcal", () => {
  test("remaining is target minus eaten, never reduced or topped up by exercise", () => {
    expect(remainingKcal(2000, 800)).toEqual({ kcal: 1200, over: false });
    expect(remainingKcal(2000, 2000)).toEqual({ kcal: 0, over: false });
  });

  test("past the target the number stays positive and flags over", () => {
    expect(remainingKcal(2000, 2350)).toEqual({ kcal: 350, over: true });
  });
});

describe("needsBreakdown", () => {
  test("BMR + activity = TDEE, TDEE - food cut = target; the rest of the deficit is planned burn", () => {
    const targets = computeTargets({ ...baseProfile, weightKg: 80 }, { today: TODAY });
    const needs = needsBreakdown(targets);
    expect(needs.bmrKcal + needs.activityKcal).toBe(needs.tdeeKcal);
    expect(needs.cutKcal).toBeGreaterThan(0);
    expect(needs.tdeeKcal - needs.cutKcal - needs.targetKcal).toBeLessThanOrEqual(2);
    expect(needs.plannedBurnKcal + needs.cutKcal).toBeCloseTo(needs.deficitKcal, -1);
    expect(needs.maintenance).toBe(false);
  });

  test("holding weight has no cut", () => {
    const targets = computeTargets({ ...baseProfile, weightKg: 70 }, { today: TODAY });
    const needs = needsBreakdown(targets);
    expect(needs.maintenance).toBe(true);
    expect(needs.cutKcal).toBe(0);
    expect(needs.deficitKcal).toBe(0);
  });

  test("a measured TDEE is flagged so the sheet can say it is not the textbook number", () => {
    const targets = computeTargets(baseProfile, { today: TODAY, adaptiveTdee: 2600 });
    const needs = needsBreakdown(targets);
    expect(needs.adaptive).toBe(true);
    expect(needs.tdeeKcal).toBe(targets.tdee);
    expect(needs.formulaTdeeKcal).toBe(targets.formulaTdee);
  });
});

describe("datePace: the verdict on a stored target", () => {
  const owner = {
    ...baseProfile,
    weightKg: 107.6,
    targetWeightKg: 65,
    targetDate: "2026-12-13", // 56 days from 2026-10-18
  };
  const today = "2026-10-18";

  test("an unreachable stored date is flagged with the date the clamped pace reaches", () => {
    const t = computeTargets(owner, { today });
    expect(t.notes).toContain("PLAN_CLAMPED");
    expect(t.deficitKcal).toBe(1000);
    expect(t.datePace).toEqual({
      direction: "lose",
      targetWeightKg: 65,
      kg: 42.6,
      feasibleDays: 329, // 42.6 kg * 7700 / 1000, rounded up
      reachDate: shiftDate(today, 329),
    });
  });

  test("the offered date clears the verdict once it is stored", () => {
    const first = computeTargets(owner, { today });
    const moved = computeTargets({ ...owner, targetDate: first.datePace!.reachDate }, { today });
    expect(moved.datePace).toBeNull();
    expect(moved.notes).not.toContain("PLAN_CLAMPED");
  });

  test("a reachable date, a slow date and a held weight carry no notice", () => {
    expect(computeTargets({ ...baseProfile, weightKg: 80 }, { today: TODAY }).datePace).toBeNull();
    expect(
      computeTargets({ ...baseProfile, weightKg: 80, targetDate: "2029-09-13" }, { today: TODAY }).datePace,
    ).toBeNull();
    expect(computeTargets({ ...owner, goal: "maintain" }, { today }).datePace).toBeNull();
    expect(computeTargets({ ...owner, targetWeightKg: 110 }, { today }).datePace).toBeNull();
  });

  test("a reversed verdict for gain: too hurried a gain offers the lean-pace date", () => {
    const t = computeTargets(
      {
        birthYear: 1996,
        gender: "male",
        heightCm: 170,
        weightKg: 60,
        targetWeightKg: 66,
        targetDate: shiftDate(today, 28),
        activityLevel: "mid",
        goal: "gain",
      },
      { today },
    );
    expect(t.datePace).toEqual({
      direction: "gain",
      targetWeightKg: 66,
      kg: 6,
      feasibleDays: 140,
      reachDate: shiftDate(today, 140),
    });
  });

  test("a stored date whose pace is past the five-year window stays savable", () => {
    const t = computeTargets(
      { ...owner, weightKg: 400, targetWeightKg: 25, targetDate: shiftDate(today, 30) },
      { today },
    );
    expect(t.datePace!.feasibleDays).toBe(1826);
    expect(t.datePace!.reachDate).toBe(shiftDate(today, 1826));
  });
});
