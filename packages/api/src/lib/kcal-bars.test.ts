import { describe, expect, test } from "bun:test";

import { shiftDate } from "./engine";
import { kcalBars, kcalSummary, type KcalDay } from "./kcal-bars";

const today = "2026-03-31";
const series = (n: number, kcal: (i: number) => number | null): KcalDay[] =>
  Array.from({ length: n }, (_, i) => ({ date: shiftDate(today, i - n + 1), kcal: kcal(i) }));

describe("kcalBars", () => {
  test("short ranges give one bar per day, untracked days keep a null average", () => {
    const s = series(7, (i) => (i % 2 === 0 ? 2000 : null));
    const { weekly, bars } = kcalBars(s, shiftDate(today, -6), today);
    expect(weekly).toBe(false);
    expect(bars).toHaveLength(7);
    expect(bars.filter((b) => b.trackedDays === 1)).toHaveLength(4);
    expect(bars.find((b) => b.avgKcal === null)?.untrackedDays).toBe(1);
  });

  test("long ranges bucket per week: average of tracked days plus untracked count", () => {
    const s = series(60, (i) => (i % 7 === 0 ? null : 2100));
    const { weekly, bars } = kcalBars(s, shiftDate(today, -59), today);
    expect(weekly).toBe(true);
    expect(bars).toHaveLength(9);
    expect(bars[0]).toMatchObject({ days: 7, trackedDays: 6, untrackedDays: 1, avgKcal: 2100 });
  });

  test("today with nothing logged is neither tracked nor untracked", () => {
    const s: KcalDay[] = [
      { date: shiftDate(today, -1), kcal: 1800 },
      { date: today, kcal: null },
    ];
    expect(kcalSummary(s, shiftDate(today, -1), today)).toEqual({
      days: 1,
      trackedDays: 1,
      avgKcal: 1800,
    });
  });

  test("an all-untracked range has no average", () => {
    const s = series(5, () => null);
    expect(kcalSummary(s, shiftDate(today, -4), today)).toEqual({
      days: 4,
      trackedDays: 0,
      avgKcal: null,
    });
  });
});
