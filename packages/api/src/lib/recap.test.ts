import { describe, expect, test } from "bun:test";

import type { TrendPoint } from "./engine";
import { buildWeekRecap, recapShare, weekRangeLabel, weekStartOf } from "./recap";

// 2026-10-12 is a Monday.
const MON = "2026-10-12";

const point = (date: string, trendKg: number): TrendPoint => ({ date, weightKg: trendKg, trendKg });

const base = {
  weekStart: MON,
  today: "2026-10-19",
  targetKcal: 2000,
  proteinTargetG: 90,
  food: [],
  exercise: [],
  trendPoints: [],
  loggedDates: [],
};

describe("weekStartOf", () => {
  test("every day of a week maps to its Monday, Sunday included", () => {
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10);
      expect(weekStartOf(date)).toBe(MON);
    }
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19");
  });
});

describe("weekRangeLabel", () => {
  test("same month and across a month boundary", () => {
    expect(weekRangeLabel(MON)).toBe("12–18 Okt");
    expect(weekRangeLabel("2026-09-28")).toBe("28 Sep–4 Okt");
  });

  test("English puts the month first", () => {
    expect(weekRangeLabel(MON, "en")).toBe("Oct 12–18");
    expect(weekRangeLabel("2026-09-28", "en")).toBe("Sep 28–Oct 4");
  });
});

describe("buildWeekRecap", () => {
  test("empty week", () => {
    const recap = buildWeekRecap(base);
    expect(recap.empty).toBe(true);
    expect(recap.avgKcal).toBeNull();
    expect(recap.daysOnTarget).toBe(0);
    expect(recap.weight).toBeNull();
    expect(recap.bestDay).toBeNull();
    expect(recap.protein).toBeNull();
    expect(recap.complete).toBe(true);
    expect(recapShare(recap)).toBeNull();
  });

  test("averages logged days only; on target tolerates 5% over, not under half", () => {
    const recap = buildWeekRecap({
      ...base,
      food: [
        { date: "2026-10-12", kcal: 1900, protein: 100 },
        { date: "2026-10-13", kcal: 2100, protein: 80 }, // +5% exactly: on target
        { date: "2026-10-14", kcal: 2600, protein: null }, // over
        { date: "2026-10-15", kcal: 800, protein: 20 }, // under half: forgotten log
      ],
    });
    expect(recap.loggedDays).toBe(4);
    expect(recap.avgKcal).toBe(Math.round((1900 + 2100 + 2600 + 800) / 4));
    expect(recap.daysOnTarget).toBe(2);
    expect(recap.days.map((d) => d.status)).toEqual([
      "on_target",
      "on_target",
      "over",
      "under",
      "empty",
      "empty",
      "empty",
    ]);
    // 1900 is 100 from target, 2100 is 100 too: tie goes to the higher protein day.
    expect(recap.bestDay).toEqual({ date: "2026-10-12", eatenKcal: 1900, proteinG: 100 });
    // days without protein data stay out of the average
    expect(recap.protein).toEqual({ avgG: 67, targetG: 90, days: 3 });
  });

  test("a running week judges only days before today", () => {
    const recap = buildWeekRecap({
      ...base,
      today: "2026-10-14",
      food: [
        { date: "2026-10-12", kcal: 2000, protein: 90 },
        { date: "2026-10-14", kcal: 300, protein: 10 }, // today: half-logged, not judged
      ],
    });
    expect(recap.complete).toBe(false);
    expect(recap.evaluatedDays).toBe(2);
    expect(recap.loggedDays).toBe(1);
    expect(recap.days[2]!.status).toBe("pending");
    expect(recap.avgKcal).toBe(2000);
  });

  test("exercise totals skip nothing the router passed and count active days", () => {
    const recap = buildWeekRecap({
      ...base,
      exercise: [
        { date: "2026-10-12", kcal: 300, minutes: 45, sessions: 1 },
        { date: "2026-10-15", kcal: 450.4, minutes: 60, sessions: 2 },
      ],
    });
    expect(recap.exercise).toEqual({ kcal: 750, minutes: 105, sessions: 3, activeDays: 2 });
    expect(recap.empty).toBe(false);
  });

  test("weight change runs from the pre-week trend to the last in-week trend", () => {
    const recap = buildWeekRecap({
      ...base,
      trendPoints: [
        point("2026-10-05", 80),
        point("2026-10-10", 79.8),
        point("2026-10-13", 79.5),
        point("2026-10-17", 79.1),
        point("2026-10-20", 78), // next week: ignored
      ],
    });
    expect(recap.weight).toEqual({ startKg: 79.8, endKg: 79.1, changeKg: -0.7, weighIns: 2 });
  });

  test("first week of weighing uses the first reading as baseline; one reading is no change", () => {
    const two = buildWeekRecap({
      ...base,
      trendPoints: [point("2026-10-13", 80), point("2026-10-17", 79.6)],
    });
    expect(two.weight).toMatchObject({ startKg: 80, endKg: 79.6, changeKg: -0.4 });
    const one = buildWeekRecap({ ...base, trendPoints: [point("2026-10-13", 80)] });
    expect(one.weight).toBeNull();
    expect(one.empty).toBe(false);
  });

  test("streak is counted as of the week's end, not today", () => {
    const loggedDates = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"];
    const past = buildWeekRecap({ ...base, loggedDates });
    expect(past.streakDays).toBe(5);
    const now = buildWeekRecap({ ...base, weekStart: "2026-10-19", loggedDates });
    expect(now.streakDays).toBe(6);
  });

  test("share fields for the story card", () => {
    const share = recapShare(
      buildWeekRecap({
        ...base,
        food: [{ date: "2026-10-14", kcal: 2000, protein: 95 }],
      }),
    );
    expect(share).toMatchObject({
      name: "12–18 Okt",
      avgKcal: 2000,
      daysOnTarget: 1,
      loggedDays: 1,
      proteinAvgG: 95,
      weightChangeKg: null,
      bestDay: { label: "Rabu", kcal: 2000 },
    });
  });
});
