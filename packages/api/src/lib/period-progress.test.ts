import { describe, expect, test } from "bun:test";

import { jakartaToday, shiftDate } from "./engine";
import type { WeighIn } from "./engine";
import { buildPeriodProgress, periodWeight } from "./period-progress";
import type { PeriodInput } from "./period-progress";

const TODAY = "2026-10-21";

/** Daily weigh-ins from `from`, each `step` kg apart, `count` of them. */
function weighIns(from: string, start: number, step: number, count: number): WeighIn[] {
  return Array.from({ length: count }, (_, i) => ({ date: shiftDate(from, i), weightKg: Math.round((start + step * i) * 10) / 10 }));
}

function input(over: Partial<PeriodInput> = {}): PeriodInput {
  return {
    from: "2026-10-01",
    to: TODAY,
    today: TODAY,
    weighIns: [],
    food: [],
    burn: {},
    targetKcal: 2000,
    goalKg: null,
    streakDays: 0,
    gain: false,
    ...over,
  };
}

/** Food + burn rows for every day in [from, to]: eats `eat`, burns `burn`. */
function steady(from: string, to: string, eat: number, burn: number) {
  const food: PeriodInput["food"] = [];
  const burns: PeriodInput["burn"] = {};
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    food.push({ date: d, kcal: eat });
    burns[d] = burn;
  }
  return { food, burn: burns };
}

describe("periodWeight", () => {
  test("trend change runs from the period's start to its end, with the weekly pace", () => {
    const w = periodWeight(weighIns("2026-09-01", 108, -0.1, 51), "2026-10-01", TODAY, 90)!;
    expect(w.direction).toBe("down");
    expect(w.changeKg).toBeLessThan(0);
    expect(w.changePct).toBeLessThan(0);
    expect(w.startKg).toBeGreaterThan(w.endKg);
    // the weigh-in on 30 Sep (one day before the period) anchors the start
    expect(w.startDate).toBe("2026-09-30");
    expect(w.weeklyRateKg).toBeLessThan(0);
    expect(w.toGoalKg).toBeGreaterThan(0);
    expect(w.series.at(-1)?.date).toBe(TODAY);
    expect(w.startsLateDays).toBe(0);
  });

  test("a start older than the anchor window is replaced by the first weigh-in inside the period", () => {
    const w = periodWeight(
      [...weighIns("2026-08-01", 100, 0, 3), ...weighIns("2026-10-10", 98, 0, 12)],
      "2026-10-01",
      TODAY,
      null,
    )!;
    expect(w.startDate).toBe("2026-10-10");
    expect(w.startsLateDays).toBe(9);
    expect(w.projectedDate).toBeNull();
  });

  test("null without a weigh-in in the period or with a single point to compare", () => {
    expect(periodWeight([], "2026-10-01", TODAY, null)).toBeNull();
    expect(periodWeight(weighIns("2026-08-01", 90, 0, 5), "2026-10-01", TODAY, null)).toBeNull();
    expect(periodWeight([{ date: "2026-10-10", weightKg: 90 }], "2026-10-01", TODAY, null)).toBeNull();
  });

  test("two weigh-ins a few days apart give a change but no weekly pace and no projection", () => {
    const w = periodWeight(
      [
        { date: "2026-10-18", weightKg: 90 },
        { date: "2026-10-21", weightKg: 89 },
      ],
      "2026-10-15",
      TODAY,
      80,
    )!;
    expect(w.weeklyRateKg).toBeNull();
    expect(w.projectedDate).toBeNull();
    expect(w.weighIns).toBe(2);
  });

  test("gain is reported as up, never dressed as loss", () => {
    const w = periodWeight(weighIns("2026-10-01", 80, 0.1, 21), "2026-10-01", TODAY, 85)!;
    expect(w.direction).toBe("up");
    expect(w.changeKg).toBeGreaterThan(0);
    expect(w.weeklyRateKg).toBeGreaterThan(0);
    expect(w.projectedDate).not.toBeNull();
  });

  test("a flat period is steady and projects nothing", () => {
    const w = periodWeight(weighIns("2026-10-01", 80, 0, 21), "2026-10-01", TODAY, 70)!;
    expect(w.direction).toBe("steady");
    expect(w.projectedDate).toBeNull();
  });

  test("a goal already passed is reached, with no projection", () => {
    const w = periodWeight(weighIns("2026-10-01", 80, -0.2, 21), "2026-10-01", TODAY, 78)!;
    expect(w.goalReached).toBe(true);
    expect(w.projectedDate).toBeNull();
  });

  test("duplicate dates keep the later reading and weigh-ins after `to` are ignored", () => {
    const w = periodWeight(
      [
        { date: "2026-10-01", weightKg: 90 },
        { date: "2026-10-01", weightKg: 91 },
        { date: "2026-10-10", weightKg: 90 },
        { date: "2026-10-25", weightKg: 70 },
      ],
      "2026-10-01",
      "2026-10-20",
      null,
    )!;
    expect(w.startKg).toBe(91);
    expect(w.endDate).toBe("2026-10-10");
  });

  test("a long history is thinned to the series cap, keeping both ends", () => {
    const w = periodWeight(weighIns("2026-01-01", 100, -0.05, 290), "2026-01-01", "2026-10-17", null)!;
    expect(w.series.length).toBeLessThanOrEqual(60);
    expect(w.series[0]?.date).toBe("2026-01-01");
    expect(w.series.at(-1)?.date).toBe("2026-10-17");
  });
});

describe("buildPeriodProgress: days logged", () => {
  test("counts logged days against finished days, and today only once it has food", () => {
    const logged = steady("2026-10-01", "2026-10-10", 1800, 2300).food;
    const p = buildPeriodProgress(input({ food: logged, burn: {} }));
    expect(p.calendarDays).toBe(21);
    // 20 finished days (1-20 Oct), today has no food yet
    expect(p.judgedDays).toBe(20);
    expect(p.loggedDays).toBe(10);

    const withToday = buildPeriodProgress(input({ food: [...logged, { date: TODAY, kcal: 400 }] }));
    expect(withToday.judgedDays).toBe(21);
    expect(withToday.loggedDays).toBe(11);
    expect(withToday.energy).toBeNull();
  });

  test("a period that ended before today judges its last day too", () => {
    const p = buildPeriodProgress(input({ to: "2026-10-07", food: [{ date: "2026-10-07", kcal: 1500 }] }));
    expect(p.judgedDays).toBe(7);
    expect(p.loggedDays).toBe(1);
    expect(p.intake.bars.at(-1)?.to).toBe("2026-10-07");
  });

  test("days after today are never judged", () => {
    const p = buildPeriodProgress(input({ to: "2026-10-25" }));
    expect(p.judgedDays).toBe(20);
  });
});

describe("buildPeriodProgress: energy", () => {
  test("sums burn minus eaten over logged finished days only and says how many it left out", () => {
    const data = steady("2026-10-01", "2026-10-10", 1800, 2300);
    const p = buildPeriodProgress(input(data));
    expect(p.energy).toMatchObject({
      countedDays: 10,
      partialDays: 0,
      unestimatedDays: 0,
      eatenKcal: 18000,
      burnKcal: 23000,
      balanceKcal: 5000,
      avgBalanceKcal: 500,
      impliedFatKg: 0.6,
    });
    // 10 unlogged finished days are not in the sums
    expect(p.judgedDays - p.loggedDays).toBe(10);
  });

  test("today is never in the sums, even with food and a burn estimate", () => {
    const data = steady("2026-10-01", TODAY, 1800, 2300);
    const p = buildPeriodProgress(input(data));
    expect(p.energy?.countedDays).toBe(20);
    expect(p.energy?.openDayLogged).toBe(true);
  });

  test("a partial log (under half the target) is logged but not counted", () => {
    const data = steady("2026-10-01", "2026-10-05", 1800, 2300);
    data.food.push({ date: "2026-10-06", kcal: 300 });
    data.burn["2026-10-06"] = 2300;
    const p = buildPeriodProgress(input(data));
    expect(p.loggedDays).toBe(6);
    expect(p.energy).toMatchObject({ countedDays: 5, partialDays: 1 });
  });

  test("days without a burn estimate are left out and counted", () => {
    const data = steady("2026-10-01", "2026-10-05", 1800, 2300);
    delete data.burn["2026-10-02"];
    delete data.burn["2026-10-03"];
    const p = buildPeriodProgress(input(data));
    expect(p.energy).toMatchObject({ countedDays: 3, unestimatedDays: 2 });
  });

  test("no burn estimate at all means no energy block", () => {
    const p = buildPeriodProgress(input({ food: steady("2026-10-01", "2026-10-05", 1800, 0).food }));
    expect(p.loggedDays).toBe(5);
    expect(p.energy).toBeNull();
  });

  test("eating above the burn is a negative balance with no implied fat", () => {
    const p = buildPeriodProgress(input(steady("2026-10-01", "2026-10-10", 2600, 2300)));
    expect(p.energy?.balanceKcal).toBe(-3000);
    expect(p.energy?.impliedFatKg).toBeNull();
  });

  test("a gain plan never implies fat", () => {
    const p = buildPeriodProgress(input({ ...steady("2026-10-01", "2026-10-10", 1800, 2300), gain: true }));
    expect(p.energy?.impliedFatKg).toBeNull();
    expect(p.energy?.balanceKcal).toBe(5000);
  });
});

describe("buildPeriodProgress: the deficit never contradicts the trend", () => {
  const deficit = steady("2026-10-01", "2026-10-20", 1500, 2500); // 20 000 kcal ≈ 2,6 kg

  test("trend loss bigger than the implied fat keeps it", () => {
    const p = buildPeriodProgress(input({ ...deficit, weighIns: weighIns("2026-10-01", 90, -0.2, 21) }));
    expect(p.weight?.direction).toBe("down");
    expect(p.energy?.impliedFatKg).toBe(2.6);
  });

  test("implied fat far above the trend loss is dropped, the kcal stay", () => {
    const p = buildPeriodProgress(input({ ...deficit, weighIns: weighIns("2026-10-01", 90, -0.02, 21) }));
    expect(p.energy?.balanceKcal).toBe(20000);
    expect(p.energy?.impliedFatKg).toBeNull();
  });

  test("a rising trend drops it", () => {
    const p = buildPeriodProgress(input({ ...deficit, weighIns: weighIns("2026-10-01", 90, 0.1, 21) }));
    expect(p.weight?.direction).toBe("up");
    expect(p.energy?.impliedFatKg).toBeNull();
  });

  test("without weigh-ins the estimate stands alone", () => {
    const p = buildPeriodProgress(input(deficit));
    expect(p.weight).toBeNull();
    expect(p.energy?.impliedFatKg).toBe(2.6);
  });
});

describe("buildPeriodProgress: intake series", () => {
  test("daily bars up to 45 days, weekly beyond, with the average over logged days", () => {
    const short = buildPeriodProgress(input({ food: steady("2026-10-01", "2026-10-10", 1800, 2300).food }));
    expect(short.intake.weekly).toBe(false);
    expect(short.intake.bars).toHaveLength(20);
    expect(short.intake.avgKcal).toBe(1800);
    expect(short.intake.targetKcal).toBe(2000);

    const long = buildPeriodProgress(input({ from: "2026-07-01", food: steady("2026-07-01", "2026-10-20", 1800, 2300).food }));
    expect(long.intake.weekly).toBe(true);
    expect(long.intake.bars.length).toBeLessThan(20);
    expect(long.intake.avgKcal).toBe(1800);
  });

  test("no food at all has no average", () => {
    expect(buildPeriodProgress(input()).intake.avgKcal).toBeNull();
  });
});

test("WIB: the day boundary comes from jakartaToday, not the UTC date", () => {
  // 23:30 UTC on the 20th is already the 21st in Jakarta
  expect(jakartaToday(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-21");
});
