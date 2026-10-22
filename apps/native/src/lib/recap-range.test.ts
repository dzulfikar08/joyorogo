import { describe, expect, test } from "bun:test";

import { shiftDate } from "@joyorogo/api/lib/engine";
import type { DayStatus, WeekRecap } from "@joyorogo/api/lib/recap";

import { combineRecaps, weekStartsOf } from "./recap-range";

function week(weekStart: string, statuses: DayStatus[], over: Partial<WeekRecap> = {}): WeekRecap {
  const days = statuses.map((status, i) => ({
    date: shiftDate(weekStart, i),
    status,
    eatenKcal: status === "empty" || status === "pending" ? 0 : 2000,
    exerciseKcal: 0,
    targetKcal: 2000,
  }));
  return {
    weekStart,
    weekEnd: shiftDate(weekStart, 6),
    complete: true,
    evaluatedDays: 7,
    loggedDays: 0,
    empty: false,
    targetKcal: 2000,
    avgKcal: 2000,
    daysOnTarget: 0,
    exercise: { kcal: 100, minutes: 30, sessions: 1, activeDays: 1 },
    weight: null,
    streakDays: 0,
    gain: false,
    bestDay: null,
    protein: null,
    days,
    ...over,
  } as WeekRecap;
}

describe("weekStartsOf", () => {
  test("one week is the end week itself", () => {
    expect(weekStartsOf("2026-10-19", 1, shiftDate)).toEqual(["2026-10-19"]);
  });

  test("lists the weeks oldest first, ending with the end week", () => {
    expect(weekStartsOf("2026-10-19", 3, shiftDate)).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
  });
});

describe("combineRecaps", () => {
  test("counts days from the weeks' own statuses", () => {
    const a = week("2026-10-05", [
      "on_target",
      "on_target",
      "over",
      "under",
      "empty",
      "empty",
      "empty",
    ]);
    const b = week("2026-10-12", [
      "on_target",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    const total = combineRecaps([a, b]);
    expect(total.days).toHaveLength(14);
    expect(total.daysOnTarget).toBe(3);
    expect(total.loggedDays).toBe(5);
    expect(total.evaluatedDays).toBe(8);
    expect(total.avgKcal).toBe(2000);
  });

  test("nothing logged: no average, the last week's target stands in", () => {
    const total = combineRecaps([
      week("2026-10-05", ["empty", "empty", "empty", "empty", "empty", "empty", "empty"], {
        targetKcal: 1800,
      }),
    ]);
    expect(total.avgKcal).toBeNull();
    expect(total.targetKcal).toBe(1800);
  });

  test("weight runs from the first reading's start to the last one's end, skipping weeks without one", () => {
    const a = week("2026-10-05", [], {
      weight: { startKg: 80, endKg: 79.5, changeKg: -0.5, weighIns: 3 },
    });
    const b = week("2026-10-12", [], { weight: null });
    const c = week("2026-10-19", [], {
      weight: { startKg: 79.4, endKg: 78.8, changeKg: -0.6, weighIns: 2 },
    });
    expect(combineRecaps([a, b, c]).weight).toEqual({ startKg: 80, endKg: 78.8, changeKg: -1.2 });
    expect(combineRecaps([b]).weight).toBeNull();
  });

  test("sums the exercise of every week", () => {
    expect(combineRecaps([week("2026-10-05", []), week("2026-10-12", [])]).exercise).toEqual({
      kcal: 200,
      minutes: 60,
      sessions: 2,
    });
  });
});
