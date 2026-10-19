import { describe, expect, test } from "bun:test";
import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";

import {
  change,
  consistencyOf,
  dayPoints,
  latest,
  mean,
  median,
  previousWindow,
  sleepStats,
  stdDev,
  totals,
  weekStart,
  weekdayAverages,
  weeklyVolume,
} from "./aggregate";

const workout = (date: string, over: Partial<FitWebWorkout> = {}): FitWebWorkout => ({
  start: 0,
  date,
  sportName: "Outdoor Run",
  sportKind: "run",
  elapsedSec: 3600,
  movingSec: 3600,
  distanceM: 10_000,
  elevGainM: 50,
  avgHr: 150,
  maxHr: 170,
  calories: 600,
  hasGps: true,
  hasAnalysis: true,
  imported: false,
  ...over,
});

describe("dayPoints", () => {
  test("one row per calendar day, null where the day has no data", () => {
    const rows = dayPoints("2026-10-08", "2026-10-11", [
      { date: "2026-10-09", recoveryPct: 60, hrvMs: 55 } as never,
      { date: "2026-10-11", recoveryPct: 70 } as never,
    ]);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(rows.map((r) => r.recoveryPct)).toEqual([null, 60, null, 70]);
    expect(rows[1]?.hrvMs).toBe(55);
    expect(rows[3]?.hrvMs).toBeNull();
  });
});

describe("statistics", () => {
  test("mean, latest and median ignore gaps", () => {
    expect(mean([null, 2, 4, undefined])).toBe(3);
    expect(mean([null])).toBeNull();
    expect(latest([1, 2, null])).toBe(2);
    expect(median([5, null, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  test("stdDev needs two values", () => {
    expect(stdDev([7])).toBeNull();
    expect(stdDev([6, 8])).toBe(1);
  });

  test("change is absolute and relative, null without both sides, no percent from zero", () => {
    expect(change(110, 100)).toEqual({ abs: 10, pct: 10 });
    expect(change(5, 0)).toEqual({ abs: 5, pct: null });
    expect(change(null, 3)).toBeNull();
    expect(change(3, null)).toBeNull();
  });
});

describe("windows", () => {
  test("the previous window is as long as the current one and ends the day before it", () => {
    expect(previousWindow("2026-10-13", "2026-10-19")).toEqual({
      from: "2026-10-06",
      to: "2026-10-12",
    });
    expect(previousWindow("2026-10-19", "2026-10-19")).toEqual({
      from: "2026-10-18",
      to: "2026-10-18",
    });
  });

  test("weeks start on Monday", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
  });
});

describe("workouts", () => {
  test("totals add up and treat a missing distance as zero", () => {
    expect(
      totals([
        workout("2026-10-10"),
        workout("2026-10-11", { distanceM: null, elevGainM: null, calories: 100 }),
      ]),
    ).toEqual({
      count: 2,
      movingSec: 7200,
      elapsedSec: 7200,
      distanceM: 10_000,
      elevGainM: 50,
      calories: 700,
    });
  });

  test("weekly volume fills empty weeks and groups unknown kinds under other", () => {
    const items = [
      workout("2026-10-06"),
      workout("2026-10-07", { sportKind: "ride", movingSec: 1800, distanceM: 15_000 }),
      workout("2026-10-20", { sportKind: "hike", movingSec: 7200, distanceM: 8_000 }),
    ];
    const hours = weeklyVolume(items, "2026-10-06", "2026-10-22", "time");
    expect(hours.map((r) => r.weekStart)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(hours[0]).toMatchObject({ run: 1, ride: 0.5, other: 0 });
    expect(hours[1]).toMatchObject({ run: 0, ride: 0, other: 0 });
    expect(hours[2]).toMatchObject({ other: 2 });
    const km = weeklyVolume(items, "2026-10-06", "2026-10-22", "distance");
    expect(km[0]).toMatchObject({ run: 10, ride: 15 });
    expect(km[2]).toMatchObject({ other: 8 });
  });
});

describe("sleep", () => {
  test("the need is the median of hours over share of need; debt and nights met follow from it", () => {
    const stats = sleepStats([
      { sleepHours: 8, sleepPct: 100 },
      { sleepHours: 6, sleepPct: 75 },
      { sleepHours: 7, sleepPct: 88 },
      { sleepHours: null, sleepPct: null },
    ]);
    expect(stats.nights).toBe(3);
    expect(stats.avgHours).toBe(7);
    expect(stats.bestHours).toBe(8);
    expect(stats.worstHours).toBe(6);
    expect(stats.needHours).toBe(8);
    expect(stats.debtHours).toBe(3);
    expect(stats.nightsMet).toBe(1);
  });

  test("without any night or any share of need there is nothing to claim", () => {
    expect(sleepStats([])).toEqual({
      nights: 0,
      avgHours: null,
      bestHours: null,
      worstHours: null,
      spreadMin: null,
      needHours: null,
      debtHours: null,
      nightsMet: null,
    });
    const noPct = sleepStats([{ sleepHours: 7, sleepPct: null }]);
    expect(noPct.avgHours).toBe(7);
    expect(noPct.needHours).toBeNull();
    expect(noPct.debtHours).toBeNull();
  });

  test("consistency bands", () => {
    expect(consistencyOf(20)).toBe("steady");
    expect(consistencyOf(30)).toBe("steady");
    expect(consistencyOf(45)).toBe("ok");
    expect(consistencyOf(90)).toBe("irregular");
  });
});

describe("weekdayAverages", () => {
  test("averages the nights by the weekday they ended on, Monday first", () => {
    const avg = weekdayAverages([
      { date: "2026-10-19", sleepHours: 7 }, // Monday
      { date: "2026-10-12", sleepHours: 5 }, // Monday
      { date: "2026-10-25", sleepHours: 8 }, // Sunday
      { date: "2026-10-20", sleepHours: null },
    ]);
    expect(avg).toEqual([6, null, null, null, null, null, 8]);
  });
});
