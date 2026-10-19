import { describe, expect, test } from "bun:test";

import {
  type SleepDay,
  type SleepNight,
  averageStages,
  hypnogram,
  stageShare,
  stagesPresent,
} from "./sleep-stages";

const night = (over: Partial<SleepNight> = {}): SleepNight => ({
  start: 1000,
  end: 1000 + 8 * 3600,
  asleepSec: 7 * 3600,
  awakeSec: 3600,
  stages: { awake: 3600, rem: 5400, light: 14400, deep: 5400, asleep: 0 },
  hasStages: true,
  awakenings: 2,
  periods: [
    { start: 1000, end: 1000 + 3600, stage: "light" },
    { start: 1000 + 3600, end: 1000 + 7200, stage: "deep" },
    { start: 1000 + 7200, end: 1000 + 8 * 3600, stage: "awake" },
  ],
  ...over,
});

const day = (n: SleepNight | null, d = "2026-10-19"): SleepDay => ({
  day: d,
  asleepSec: n?.asleepSec ?? 0,
  napSec: 0,
  night: n,
  naps: [],
});

describe("stages of a night", () => {
  test("only the stages with time are drawn, top to bottom awake, REM, light, deep", () => {
    expect(stagesPresent(night())).toEqual(["awake", "rem", "light", "deep"]);
    expect(
      stagesPresent(
        night({ stages: { awake: 0, rem: 0, light: 0, deep: 0, asleep: 25200 }, hasStages: false }),
      ),
    ).toEqual(["asleep"]);
  });

  test("a stage's share is of the whole night, asleep and awake", () => {
    expect(stageShare(night(), "light")).toBe(50);
    expect(stageShare(night(), "awake")).toBe(12.5);
    expect(stageShare(night({ asleepSec: 0, awakeSec: 0 }), "deep")).toBe(0);
  });

  test("the chart bars sit along the night and on their stage's row", () => {
    const { bars, rows } = hypnogram(night());
    expect(rows).toEqual(["awake", "rem", "light", "deep"]);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ stage: "light", row: 2, x: 0 });
    expect(bars[0]?.width).toBeCloseTo(3600 / 28800);
    expect(bars[1]).toMatchObject({ stage: "deep", row: 3 });
    expect(bars[1]?.x).toBeCloseTo(0.125);
    expect(bars[2]).toMatchObject({ stage: "awake", row: 0 });
    expect(bars[2]?.x + (bars[2]?.width ?? 0)).toBeCloseTo(1);
  });
});

describe("averages", () => {
  test("only nights the watch staged count; null when none", () => {
    const unstaged = night({
      stages: { awake: 0, rem: 0, light: 0, deep: 0, asleep: 25200 },
      hasStages: false,
    });
    const other = night({
      stages: { awake: 1800, rem: 3600, light: 18000, deep: 3600, asleep: 0 },
    });
    const result = averageStages([
      day(night()),
      day(unstaged, "2026-10-18"),
      day(null, "2026-10-17"),
      day(other, "2026-10-16"),
    ]);
    expect(result).toEqual({ nights: 2, deep: 4500, rem: 4500, light: 16200, awake: 2700 });
    expect(averageStages([day(unstaged)])).toBeNull();
    expect(averageStages([])).toBeNull();
  });
});
