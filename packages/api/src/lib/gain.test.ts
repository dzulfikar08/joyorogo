import { describe, expect, test } from "bun:test";

import {
  checkTargetDate,
  computeTargets,
  gainStreak,
  needsBreakdown,
  shiftDate,
  weightTrend,
} from "./engine";
import type { ProfileInput } from "./engine";
import {
  CONSULT_BMI,
  GAIN_PROMPT_NOTE,
  MAX_SURPLUS_KCAL,
  MIN_SURPLUS_KCAL,
  PACE_PCT,
  PROTEIN_G_PER_KG,
  REACHED_MARGIN_KCAL,
  clampSurplus,
  gainDayHit,
  gainEatTone,
  gainNumbers,
  gainRemaining,
  goalOf,
  goalTargetError,
  isRapidLoss,
  paceBand,
  paceBandKgPerWeek,
  planGoal,
  rawSurplusKcal,
  resolveGoal,
  suggestGainTarget,
  suggestedDays,
} from "./gain";
import { gainMealIdeas } from "./ideas";
import { buildPlan, proteinGoalG } from "./plan";
import type { ProfileRow } from "./plan";
import { buildWeekRecap, dayStatus } from "./recap";

const TODAY = "2026-10-18";

// Male, 170 cm, 60 kg: BMI 20.8, BMR = 10*60 + 6.25*170 - 5*30 + 5 = 1517.5 (no movement assumed)
const lean: ProfileInput = {
  birthYear: 1996, // 30 on TODAY
  gender: "male",
  heightCm: 170,
  weightKg: 60,
  targetWeightKg: 66,
  targetDate: shiftDate(TODAY, 180),
  activityLevel: "mid",
  goal: "gain",
};

describe("goalOf", () => {
  test("a target above the weight is a gain, below is a loss, level is maintain", () => {
    expect(goalOf(60, 66)).toBe("gain");
    expect(goalOf(80, 70)).toBe("lose");
    expect(goalOf(70, 70)).toBe("maintain");
  });

  test("a target within the scale's noise above the weight is not a gain", () => {
    expect(goalOf(70, 70.05)).toBe("maintain");
    expect(goalOf(70, 70.1)).toBe("gain");
  });
});

describe("resolveGoal", () => {
  const base = { stored: "lose", weightNowKg: 69.5, currentTargetKg: 70, nextTargetKg: 70 } as const;

  test("an explicit choice wins", () => {
    expect(resolveGoal({ ...base, explicit: "maintain" })).toBe("maintain");
  });

  test("a date-only edit keeps the stored goal: a reached loss target never turns into a gain", () => {
    expect(resolveGoal(base)).toBe("lose");
  });

  test("a changed target is re-derived from the weight", () => {
    expect(resolveGoal({ ...base, nextTargetKg: 74 })).toBe("gain");
    expect(resolveGoal({ ...base, stored: "gain", nextTargetKg: 60 })).toBe("lose");
  });
});

describe("goalTargetError", () => {
  test("gain needs a target above the weight, lose one below it", () => {
    expect(goalTargetError("gain", 60, 60)).toBe("goalGainTarget");
    expect(goalTargetError("gain", 60, 66)).toBeNull();
    expect(goalTargetError("lose", 60, 66)).toBe("goalLoseTarget");
    expect(goalTargetError("lose", 70, 65)).toBeNull();
    expect(goalTargetError("maintain", 60, 66)).toBeNull();
  });
});

describe("planGoal: Hamil and Menyusui take precedence", () => {
  test("a maternal mode hides any goal", () => {
    expect(planGoal({ maternalMode: "pregnant", goal: "gain" })).toBe("maternal");
    expect(planGoal({ maternalMode: "breastfeeding", goal: "gain" })).toBe("maternal");
    expect(planGoal({ maternalMode: "none", goal: "gain" })).toBe("gain");
  });

  const row = (over: Partial<ProfileRow>): ProfileRow =>
    ({
      userId: "u1",
      birthYear: 1996,
      gender: "female",
      heightCm: 165,
      startWeightKg: 50,
      targetWeightKg: 56,
      targetDate: shiftDate(TODAY, 180),
      activityLevel: "mid",
      goal: "gain",
      goalStartKg: 50,
      ...NO_MATERNAL_ROW,
      ...over,
    }) as ProfileRow;
  const NO_MATERNAL_ROW = {
    maternalMode: "none",
    pregnancyLmp: null,
    pregnancyDateKind: null,
    prePregnancyWeightKg: null,
    pregnancyTwins: false,
    breastfeedingType: null,
    babyBirthDate: null,
    maternalConditions: null,
  };
  const history = { latestWeightKg: 50, weighIns: [], intake: [], exercise: [] };

  test("buildPlan: gain row gives a surplus plan", () => {
    const plan = buildPlan(row({}), history, TODAY);
    expect(plan.targets.gain).not.toBeNull();
    expect(plan.maternal).toBeNull();
  });

  test("buildPlan: the same row with a pregnancy gets the AKG plan and no gain", () => {
    const plan = buildPlan(
      row({
        maternalMode: "pregnant",
        pregnancyLmp: shiftDate(TODAY, -100),
        pregnancyDateKind: "hpht",
        prePregnancyWeightKg: 50,
      }),
      history,
      TODAY,
    );
    expect(plan.targets.gain).toBeNull();
    expect(plan.targets.maternal).not.toBeNull();
    expect(plan.targets.notes).toEqual(["MATERNAL"]);
  });

  test("buildPlan: a loss row (the default) never becomes a gain after overshooting its target", () => {
    const plan = buildPlan(row({ goal: "lose", startWeightKg: 80, targetWeightKg: 70 }), {
      ...history,
      latestWeightKg: 69,
    }, TODAY);
    expect(plan.targets.gain).toBeNull();
    expect(plan.targets.notes).toContain("MAINTENANCE");
  });
});

describe("pace to surplus", () => {
  test("surplus = gap x 7700 / days, rounded to 5", () => {
    // 6 kg over 180 days: 6 * 7700 / 180 = 256.7 -> 255
    expect(rawSurplusKcal(6, 180)).toBeCloseTo(256.67, 1);
    expect(clampSurplus(rawSurplusKcal(6, 180))).toBe(255);
  });

  test("clamped to +200..+700 kcal", () => {
    expect(clampSurplus(50)).toBe(MIN_SURPLUS_KCAL);
    expect(clampSurplus(199)).toBe(200);
    expect(clampSurplus(700)).toBe(700);
    expect(clampSurplus(2500)).toBe(MAX_SURPLUS_KCAL);
  });

  test("a day is never zero days", () => {
    expect(rawSurplusKcal(1, 0)).toBe(7700);
  });
});

describe("paceBand", () => {
  test("lean to 0.5% a week, brisk to 1%, fast past 1%", () => {
    expect(paceBand(PACE_PCT.leanMin, false)).toBe("lean");
    expect(paceBand(0.5, false)).toBe("lean");
    expect(paceBand(0.7, false)).toBe("brisk");
    expect(paceBand(1, false)).toBe("brisk");
    expect(paceBand(1.01, false)).toBe("fast");
  });

  test("underweight bodies have no brisk band under 1%", () => {
    expect(paceBand(0.9, true)).toBe("lean");
    expect(paceBand(1.2, true)).toBe("fast");
  });

  test("chart band is 0.25-0.5% of weight, 0.5-1% when underweight", () => {
    expect(paceBandKgPerWeek(60, 170)).toEqual({ minKg: 0.15, maxKg: 0.3 });
    expect(paceBandKgPerWeek(50, 170)).toEqual({ minKg: 0.25, maxKg: 0.5 });
  });
});

describe("computeTargets in gain mode", () => {
  test("target = TDEE + surplus, the TDEE rounded to 5 so the sum is exact", () => {
    const t = computeTargets(lean, { today: TODAY });
    expect(t.gain).not.toBeNull();
    expect(t.notes).toContain("GAIN");
    expect(t.notes).not.toContain("MAINTENANCE");
    // BMR 1517.5 -> 1520; 6 kg in 180 days -> +255
    expect(t.tdee).toBe(1520);
    expect(t.gain!.surplusKcal).toBe(255);
    expect(t.eatKcal).toBe(t.tdee + t.gain!.surplusKcal);
    expect(t.deficitKcal).toBe(0);
    expect(t.rawDeficitKcal).toBe(0);
  });

  test("a hurried date clamps at +700 and the raw ask stays visible", () => {
    const t = computeTargets({ ...lean, targetDate: shiftDate(TODAY, 30) }, { today: TODAY });
    expect(t.gain!.rawSurplusKcal).toBe(1540);
    expect(t.gain!.surplusKcal).toBe(700);
    expect(t.eatKcal).toBe(t.tdee + 700);
  });

  test("a far date clamps at +200: the plan holds the floor and finishes earlier", () => {
    const t = computeTargets({ ...lean, targetWeightKg: 61, targetDate: shiftDate(TODAY, 700) }, { today: TODAY });
    expect(t.gain!.rawSurplusKcal).toBe(11);
    expect(t.gain!.surplusKcal).toBe(200);
    expect(t.gain!.daysToTarget).toBe(39);
    expect(t.gain!.reachDate).toBe(shiftDate(TODAY, 39));
  });

  test("the pace shown is what the applied surplus delivers", () => {
    const t = computeTargets(lean, { today: TODAY });
    // 255 kcal/day = 0.23 kg/week = 0.39% of 60 kg
    expect(t.gain!.paceKgPerWeek).toBe(0.23);
    expect(t.gain!.pacePct).toBe(0.39);
    expect(t.gain!.band).toBe("lean");
    expect(t.gain!.gapKg).toBe(6);
  });

  test("protein 1.6-2.2 g/kg with the target at 1.8, not scaled past the healthy range", () => {
    const t = computeTargets(lean, { today: TODAY });
    expect(t.gain!.protein).toEqual({
      minG: Math.round(PROTEIN_G_PER_KG.min * 60),
      targetG: Math.round(PROTEIN_G_PER_KG.target * 60),
      maxG: Math.round(PROTEIN_G_PER_KG.max * 60),
    });
    // idealMax at 170 cm is 72: a 90 kg body is scaled as 72 kg
    const heavy = computeTargets({ ...lean, weightKg: 90, targetWeightKg: 95 }, { today: TODAY });
    expect(heavy.gain!.protein.targetG).toBe(Math.round(1.8 * 72));
  });

  test("the plan's protein goal is the gain target, training day or not", () => {
    const t = computeTargets(lean, { today: TODAY });
    expect(proteinGoalG({ targets: t, weightNowKg: 60 }, 170, true)).toBe(108);
    expect(proteinGoalG({ targets: t, weightNowKg: 60 }, 170, false)).toBe(108);
  });

  test("reaching the target weight holds: no surplus, no gain info", () => {
    const t = computeTargets(lean, { today: TODAY, weightNow: 66 });
    expect(t.gain).toBeNull();
    expect(t.notes).toContain("MAINTENANCE");
    expect(t.eatKcal).toBe(Math.round(t.tdee / 5) * 5);
  });

  test("measured TDEE moves the base within 15%, the surplus sits on top", () => {
    const t = computeTargets(lean, { today: TODAY, adaptiveTdee: 5000 });
    expect(t.notes).toContain("ADAPTIVE");
    expect(t.tdee).toBe(Math.round((1517.5 * 1.15) / 5) * 5);
    expect(t.eatKcal).toBe(t.tdee + t.gain!.surplusKcal);
  });

  test("a gain goal with a target at or below the weight is just maintenance", () => {
    const t = computeTargets({ ...lean, targetWeightKg: 60 }, { today: TODAY });
    expect(t.gain).toBeNull();
    expect(t.notes).toContain("MAINTENANCE");
  });

  test("no goal given keeps the plan exactly as it was", () => {
    const { goal: _goal, ...legacy } = lean;
    const t = computeTargets({ ...legacy, weightKg: 80, targetWeightKg: 70 }, { today: TODAY });
    expect(t.gain).toBeNull();
    expect(t.deficitKcal).toBeGreaterThan(0);
    const below = computeTargets({ ...legacy, targetWeightKg: 66 }, { today: TODAY });
    expect(below.gain).toBeNull();
    expect(below.notes).toContain("MAINTENANCE");
  });

  test("a hold goal never cuts, even above the stored target", () => {
    const t = computeTargets({ ...lean, goal: "maintain", weightKg: 75, targetWeightKg: 70 }, { today: TODAY });
    expect(t.gain).toBeNull();
    expect(t.deficitKcal).toBe(0);
    expect(t.notes).toContain("MAINTENANCE");
  });

  test("needsBreakdown carries the surplus and no cut", () => {
    const needs = needsBreakdown(computeTargets(lean, { today: TODAY }));
    expect(needs.surplusKcal).toBe(255);
    expect(needs.cutKcal).toBe(0);
    expect(needs.maintenance).toBe(false);
    expect(needs.tdeeKcal + needs.surplusKcal).toBe(needs.targetKcal);
  });
});

describe("safety flags", () => {
  test("BMI under 17 gets the see-a-doctor flag", () => {
    // 48 kg at 170 cm is BMI 16.6
    const t = computeTargets({ ...lean, weightKg: 48, targetWeightKg: 56 }, { today: TODAY });
    expect(t.gain!.bmi).toBeLessThan(CONSULT_BMI);
    expect(t.gain!.flags).toContain("BMI_LOW");
  });

  test("BMI 17 and over does not", () => {
    const t = computeTargets({ ...lean, weightKg: 50, targetWeightKg: 56 }, { today: TODAY });
    expect(t.gain!.flags).not.toContain("BMI_LOW");
  });

  test("a target above BMI 25 is noted, never blocked", () => {
    // 170 cm: 25 BMI is 72.25 kg
    const t = computeTargets({ ...lean, weightKg: 68, targetWeightKg: 75 }, { today: TODAY });
    expect(t.gain!.flags).toContain("TARGET_ABOVE_HEALTHY");
    expect(t.eatKcal).toBeGreaterThan(t.tdee);
    const ok = computeTargets({ ...lean, targetWeightKg: 70 }, { today: TODAY });
    expect(ok.gain!.flags).not.toContain("TARGET_ABOVE_HEALTHY");
  });

  test("a trend falling 0.5% of body weight a week is rapid loss", () => {
    expect(isRapidLoss(-0.3, 60)).toBe(true);
    expect(isRapidLoss(-0.29, 60)).toBe(false);
    expect(isRapidLoss(0.4, 60)).toBe(false);
    expect(isRapidLoss(null, 60)).toBe(false);
  });

  test("the plan adds RAPID_LOSS from the trend while gaining", () => {
    const weighIns = Array.from({ length: 20 }, (_, i) => ({
      date: shiftDate(TODAY, i - 19),
      weightKg: 60 - 0.07 * i,
    }));
    const plan = buildPlan(
      {
        userId: "u1",
        birthYear: 1996,
        gender: "male",
        heightCm: 170,
        startWeightKg: 60,
        targetWeightKg: 66,
        targetDate: shiftDate(TODAY, 180),
        activityLevel: "mid",
        goal: "gain",
        goalStartKg: 60,
        maternalMode: "none",
      } as ProfileRow,
      { latestWeightKg: weighIns.at(-1)!.weightKg, weighIns, intake: [], exercise: [] },
      TODAY,
    );
    expect(plan.targets.gain!.flags).toContain("RAPID_LOSS");
  });
});

describe("checkTargetDate in reverse", () => {
  const base = { weightNowKg: 60, targetWeightKg: 66, today: TODAY, heightCm: 170 };

  test("a pace inside the window is gainOk and matches computeTargets", () => {
    const targetDate = shiftDate(TODAY, 180);
    const check = checkTargetDate({ ...base, targetDate });
    expect(check).toMatchObject({ status: "gainOk", days: 180, surplusKcal: 255, band: "lean" });
    expect(computeTargets({ ...lean, targetDate }, { today: TODAY }).gain!.surplusKcal).toBe(255);
  });

  test("past 1% of body weight a week is gainFast and offers a later date", () => {
    // 6 kg in 28 days = 1.5 kg/week = 2.5% of 60 kg
    const check = checkTargetDate({ ...base, targetDate: shiftDate(TODAY, 28) });
    if (check.status !== "gainFast") throw new Error(`expected gainFast, got ${check.status}`);
    expect(check.pacePct).toBe(2.5);
    expect(check.surplusKcal).toBe(700);
    // 0.5% of 60 kg = 0.3 kg/week -> 6 kg takes 140 days
    expect(check.feasibleDays).toBe(140);
    expect(check.feasibleDays).toBe(suggestedDays(6, 60, false));
  });

  test("the suggested later date lands inside the lean band and the surplus window", () => {
    const fast = checkTargetDate({ ...base, targetDate: shiftDate(TODAY, 28) });
    if (fast.status !== "gainFast") throw new Error("unreachable");
    const later = checkTargetDate({ ...base, targetDate: shiftDate(TODAY, fast.feasibleDays) });
    expect(later.status).toBe("gainOk");
    if (later.status === "gainOk") expect(later.band).toBe("lean");
  });

  test("more than +700 kcal is fast even when under 1% a week (a heavy body)", () => {
    // 100 kg gaining 7 kg in 60 days: 898 kcal/day, 0.82% a week
    const check = checkTargetDate({
      weightNowKg: 100,
      targetWeightKg: 107,
      targetDate: shiftDate(TODAY, 60),
      today: TODAY,
    });
    expect(check.status).toBe("gainFast");
    if (check.status === "gainFast") {
      expect(check.pacePct).toBeLessThan(1);
      expect(check.feasibleDays).toBe(Math.ceil((7 / ((0.5 / 100) * 100)) * 7));
    }
  });

  test("0.5-1% a week is ok with the brisk band; underweight people have none", () => {
    // 60 kg: 0.45 kg/week is 0.75%
    const days = Math.round(6 / (0.45 / 7));
    const brisk = checkTargetDate({ ...base, targetDate: shiftDate(TODAY, days) });
    expect(brisk).toMatchObject({ status: "gainOk", band: "brisk" });
    const under = checkTargetDate({
      weightNowKg: 48,
      targetWeightKg: 54,
      targetDate: shiftDate(TODAY, Math.round(6 / (0.36 / 7))),
      today: TODAY,
      heightCm: 170,
    });
    expect(under).toMatchObject({ status: "gainOk", band: "lean" });
  });

  test("under +200 kcal is gainSlow and offers the days the floor needs", () => {
    const check = checkTargetDate({ ...base, targetWeightKg: 61, targetDate: shiftDate(TODAY, 700) });
    if (check.status !== "gainSlow") throw new Error(`expected gainSlow, got ${check.status}`);
    expect(check.surplusKcal).toBe(200);
    expect(check.feasibleDays).toBe(39);
  });

  test("the rest of the verdicts are the loss ones", () => {
    expect(checkTargetDate({ ...base, targetDate: TODAY }).status).toBe("past");
    expect(checkTargetDate({ ...base, targetDate: "2032-12-01" }).status).toBe("tooFar");
    expect(checkTargetDate({ ...base, targetDate: "besok" }).status).toBe("invalid");
    expect(
      checkTargetDate({ ...base, weightNowKg: 80, targetWeightKg: 70, targetDate: shiftDate(TODAY, 90) }).status,
    ).toBe("ok");
  });

  test("an explicit maintain or a stored loss goal sees no gain", () => {
    const targetDate = shiftDate(TODAY, 180);
    expect(checkTargetDate({ ...base, targetDate, goal: "maintain" }).status).toBe("maintenance");
    expect(checkTargetDate({ ...base, targetDate, goal: "lose" }).status).toBe("maintenance");
  });
});

describe("the Sisa flip", () => {
  test("under the target it is what is still to eat", () => {
    expect(gainRemaining(2480, 1000)).toEqual({ state: "short", kcal: 1480 });
    expect(gainRemaining(2480, 2479)).toEqual({ state: "short", kcal: 1 });
  });

  test("at the target it is reached, and stays reached up to the margin", () => {
    expect(gainRemaining(2480, 2480)).toEqual({ state: "reached", kcal: 0 });
    expect(gainRemaining(2480, 2480 + REACHED_MARGIN_KCAL)).toEqual({ state: "reached", kcal: 0 });
  });

  test("past the margin it is over, with the amount above the target", () => {
    expect(gainRemaining(2480, 2480 + REACHED_MARGIN_KCAL + 1)).toEqual({
      state: "over",
      kcal: REACHED_MARGIN_KCAL + 1,
    });
  });

  test("the ring is never red: it is amber only past the margin", () => {
    expect(gainEatTone(500, 2480)).toBe("ok");
    expect(gainEatTone(2480, 2480)).toBe("ok");
    expect(gainEatTone(2480 + REACHED_MARGIN_KCAL, 2480)).toBe("ok");
    expect(gainEatTone(2480 + REACHED_MARGIN_KCAL + 1, 2480)).toBe("near");
    expect(gainEatTone(100, 0)).toBe("ok");
  });
});

describe("the streak rule: days at 90% of the target", () => {
  const target = 2000;
  const day = (offset: number, kcal: number) => ({ date: shiftDate(TODAY, offset), kcal });

  test("exactly 90% counts, just under does not", () => {
    expect(gainDayHit(1800, target)).toBe(true);
    expect(gainDayHit(1799, target)).toBe(false);
    expect(gainDayHit(5000, target)).toBe(true);
    expect(gainDayHit(500, 0)).toBe(false);
  });

  test("counts consecutive hitting days ending today", () => {
    expect(gainStreak([day(0, 2000), day(-1, 1850), day(-2, 2300)], target, TODAY)).toBe(3);
  });

  test("today not there yet keeps the streak through yesterday", () => {
    expect(gainStreak([day(0, 600), day(-1, 1900), day(-2, 1900)], target, TODAY)).toBe(2);
  });

  test("a day under 90% breaks it, a day with any log but too little does not count", () => {
    expect(gainStreak([day(0, 2000), day(-1, 1700), day(-2, 2000)], target, TODAY)).toBe(1);
    expect(gainStreak([day(0, 1000)], target, TODAY)).toBe(0);
  });
});

describe("recap in gain mode", () => {
  const weekStart = "2026-10-12";
  const days = [0, 1, 2, 3, 4, 5].map((i) => ({
    date: shiftDate(weekStart, i),
    kcal: i < 4 ? 2500 : 1200,
    protein: 90,
  }));

  test("a day is on target from 90%, never over; below 90% is under", () => {
    expect(dayStatus(2000, 2000, true)).toBe("on_target");
    expect(dayStatus(1800, 2000, true)).toBe("on_target");
    expect(dayStatus(3500, 2000, true)).toBe("on_target");
    expect(dayStatus(1700, 2000, true)).toBe("under");
    expect(dayStatus(0, 2000, true)).toBe("empty");
    expect(dayStatus(3500, 2000)).toBe("over");
  });

  test("the week counts hitting days and carries the gain flag and the gain streak", () => {
    const recap = buildWeekRecap({
      weekStart,
      today: "2026-10-19",
      targetKcal: 2400,
      proteinTargetG: 110,
      food: days,
      exercise: [],
      trendPoints: [],
      loggedDates: [],
      gain: { streakDays: 4 },
    });
    expect(recap.gain).toBe(true);
    expect(recap.daysOnTarget).toBe(4);
    expect(recap.streakDays).toBe(4);
    expect(recap.days[0]!.status).toBe("on_target");
    expect(recap.days[5]!.status).toBe("under");
  });

  test("without a gain plan the week reads as before", () => {
    const recap = buildWeekRecap({
      weekStart,
      today: "2026-10-19",
      targetKcal: 2400,
      proteinTargetG: 110,
      food: days,
      exercise: [],
      trendPoints: [],
      loggedDates: [],
    });
    expect(recap.gain).toBe(false);
  });
});

describe("weight trend toward a higher target", () => {
  const series = (n: number, at: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ date: shiftDate(TODAY, i - (n - 1)), weightKg: at(i) }));

  test("a steady gain projects the date it reaches the target", () => {
    const trend = weightTrend(series(28, (i) => 60 + 0.05 * i), 66, TODAY)!;
    expect(trend.weeklyRateKg).toBeCloseTo(0.35, 2);
    expect(trend.projectedDate).not.toBeNull();
  });

  test("a gain trend toward a lower target does not project", () => {
    expect(weightTrend(series(20, (i) => 80 + 0.05 * i), 70, TODAY)!.projectedDate).toBeNull();
  });
});

describe("meal ideas for a gain", () => {
  test("calorie-dense ideas for a big gap, biggest first", () => {
    const ideas = gainMealIdeas(1000, "makan_malam", 3, "id");
    expect(ideas.length).toBe(3);
    expect(ideas[0]!.kcal).toBeGreaterThanOrEqual(ideas[1]!.kcal);
    expect(ideas.every((idea) => idea.kcal >= 350)).toBe(true);
  });

  test("a small gap is answered with a snack, not a plate", () => {
    const ideas = gainMealIdeas(250, "makan_malam", 3, "id");
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.every((idea) => idea.kcal <= 250 + REACHED_MARGIN_KCAL)).toBe(true);
  });

  test("nothing left to eat, no idea", () => {
    expect(gainMealIdeas(60, "snack", 3, "id")).toEqual([]);
  });

  test("names come in both languages", () => {
    expect(gainMealIdeas(900, "makan_siang", 1, "id")[0]!.name).toContain("Nasi");
    expect(gainMealIdeas(900, "makan_siang", 1, "en")[0]!.name).toContain("rice");
  });
});

describe("suggested target", () => {
  test("underweight heads for the healthy range, others for about 3 kg", () => {
    expect(suggestGainTarget(48, 170, 53, 72)).toBe(53);
    expect(suggestGainTarget(60, 170, 53, 72)).toBe(63);
    // never past the healthy range when inside it
    expect(suggestGainTarget(71, 170, 53, 72)).toBe(72);
  });
});

describe("the AI note", () => {
  test("never coaches toward a deficit and leaves the estimate alone", () => {
    expect(GAIN_PROMPT_NOTE).toContain("naik berat badan");
    expect(GAIN_PROMPT_NOTE).toContain("Jangan pernah menyarankan mengurangi");
    expect(GAIN_PROMPT_NOTE.toLowerCase()).not.toContain("estimasi");
  });
});

describe("gainNumbers", () => {
  test("reports BMI of the weight and the target", () => {
    const n = gainNumbers({ weightNowKg: 60, targetKg: 66, heightCm: 170, days: 180, idealMaxKg: 72 });
    expect(n.bmi).toBe(20.8);
    expect(n.targetBmi).toBe(22.8);
  });
});
