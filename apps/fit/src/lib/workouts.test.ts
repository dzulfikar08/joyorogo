import { describe, expect, test } from "bun:test";
import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";

import {
  filterWorkouts,
  kindCounts,
  paceSecKm,
  readsAsPace,
  sortWorkouts,
  speedMs,
} from "./workouts";

const w = (start: number, over: Partial<FitWebWorkout> = {}): FitWebWorkout => ({
  start,
  date: "2026-10-10",
  sportName: "Outdoor Run",
  sportKind: "run",
  elapsedSec: 1800,
  movingSec: 1800,
  distanceM: 5000,
  elevGainM: 20,
  avgHr: 150,
  maxHr: 170,
  calories: 300,
  hasGps: true,
  hasAnalysis: true,
  imported: false,
  ...over,
});

describe("pace and speed", () => {
  test("derived from distance over moving time", () => {
    expect(speedMs(w(1))).toBeCloseTo(2.7778, 3);
    expect(paceSecKm(w(1))).toBe(360);
    expect(speedMs(w(1, { distanceM: null }))).toBeNull();
    expect(speedMs(w(1, { distanceM: 0 }))).toBeNull();
    expect(paceSecKm(w(1, { movingSec: 0 }))).toBeNull();
  });

  test("runs and walks read as pace, rides and unknown kinds as speed", () => {
    expect(readsAsPace("run")).toBe(true);
    expect(readsAsPace("walk")).toBe(true);
    expect(readsAsPace("ride")).toBe(false);
    expect(readsAsPace("hike")).toBe(false);
  });
});

describe("sortWorkouts", () => {
  const items = [
    w(1, { distanceM: 3000 }),
    w(2, { distanceM: 8000 }),
    w(3, { distanceM: null }),
    w(4, { distanceM: 5000 }),
  ];

  test("sorts by a metric in both directions and keeps rows without the value last", () => {
    expect(sortWorkouts(items, "distance", "desc").map((i) => i.start)).toEqual([2, 4, 1, 3]);
    expect(sortWorkouts(items, "distance", "asc").map((i) => i.start)).toEqual([1, 4, 2, 3]);
  });

  test("date sorts by start, newest first when descending", () => {
    expect(sortWorkouts(items, "date", "desc").map((i) => i.start)).toEqual([4, 3, 2, 1]);
  });

  test("ties fall back to the newest first and the input is not mutated", () => {
    const tied = [w(1), w(2), w(3)];
    expect(sortWorkouts(tied, "calories", "asc").map((i) => i.start)).toEqual([3, 2, 1]);
    expect(tied.map((i) => i.start)).toEqual([1, 2, 3]);
  });

  test("a calories value of zero is no value", () => {
    expect(
      sortWorkouts([w(1, { calories: 0 }), w(2, { calories: 100 })], "calories", "asc").map(
        (i) => i.start,
      ),
    ).toEqual([2, 1]);
  });
});

describe("filterWorkouts", () => {
  const items = [
    w(1),
    w(2, { sportName: "Road Cycling", sportKind: "ride" }),
    w(3, { sportName: "Trail Run", sportKind: "hike" }),
  ];

  test("no kinds and no query is everything", () => {
    expect(filterWorkouts(items, [], "")).toHaveLength(3);
  });

  test("filters by kind, with unknown kinds counted as other", () => {
    expect(filterWorkouts(items, ["ride"], "").map((i) => i.start)).toEqual([2]);
    expect(filterWorkouts(items, ["other"], "").map((i) => i.start)).toEqual([3]);
    expect(filterWorkouts(items, ["run", "ride"], "").map((i) => i.start)).toEqual([1, 2]);
  });

  test("the query matches the sport name, ignoring case and surrounding space", () => {
    expect(filterWorkouts(items, [], "  RUN ").map((i) => i.start)).toEqual([1, 3]);
    expect(filterWorkouts(items, ["run"], "trail")).toEqual([]);
  });

  test("kindCounts counts per kind", () => {
    expect([...kindCounts(items)]).toEqual([
      ["run", 1],
      ["ride", 1],
      ["other", 1],
    ]);
  });
});
