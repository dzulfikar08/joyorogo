import { describe, expect, test } from "bun:test";

import { buildSources, hasActivitySource, type SourcesInput } from "./sources";

const empty: SourcesInput = {
  health: { connected: false, lastAt: null },
  strava: { connected: false },
  coros: { connected: false },
  garmin: { connected: false },
  exercise: [],
  weights: [],
  allDaySource: null,
  recentFrom: "2026-10-16",
};

const row = (rows: ReturnType<typeof buildSources>, id: string) => rows.find((r) => r.id === id)!;

describe("buildSources", () => {
  test("COROS has no row for a user it is not offered to", () => {
    const rows = buildSources({ ...empty, coros: null, garmin: null });
    expect(rows.map((r) => r.id)).toEqual(["joyofit", "health", "strava", "scale", "manual"]);
  });

  test("Garmin has no row for a user it is not offered to", () => {
    const rows = buildSources({ ...empty, garmin: null });
    expect(rows.map((r) => r.id)).not.toContain("garmin");
  });

  test("Garmin has a row, and counts as an activity source once connected, when offered", () => {
    expect(buildSources(empty).map((r) => r.id)).toContain("garmin");
    const rows = buildSources({ ...empty, garmin: { connected: true } });
    expect(row(rows, "garmin").connected).toBe(true);
    expect(hasActivitySource(rows)).toBe(true);
  });

  test("a fresh account: only manual entry is available", () => {
    const rows = buildSources(empty);
    expect(rows.map((r) => [r.id, r.connected])).toEqual([
      ["joyofit", false],
      ["health", false],
      ["strava", false],
      ["coros", false],
      ["garmin", false],
      ["scale", false],
      ["manual", true],
    ]);
    expect(hasActivitySource(rows)).toBe(false);
  });

  test("JoyoFit is connected by its workouts and reports the newest arrival and the last week's count", () => {
    const rows = buildSources({
      ...empty,
      exercise: [
        { source: "joyofit", date: "2026-10-10", at: 100 },
        { source: "joyofit", date: "2026-10-20", at: 300 },
        { source: "joyofit", date: "2026-10-18", at: 200 },
      ],
    });
    expect(row(rows, "joyofit")).toMatchObject({ connected: true, lastAt: 300, recent: 2 });
    expect(hasActivitySource(rows)).toBe(true);
  });

  test("the all-day figure marks its source as the one counted today", () => {
    expect(
      row(buildSources({ ...empty, allDaySource: "health_connect" }), "health").usedToday,
    ).toBe(true);
    const watch = buildSources({ ...empty, allDaySource: "joyofit" });
    expect(row(watch, "joyofit")).toMatchObject({ connected: true, usedToday: true });
  });

  test("the health store keeps its own last-import time", () => {
    const rows = buildSources({ ...empty, health: { connected: true, lastAt: 555 } });
    expect(row(rows, "health")).toMatchObject({ connected: true, lastAt: 555 });
  });

  test("a scale weigh-in and a typed one are told apart", () => {
    const rows = buildSources({
      ...empty,
      weights: [
        { source: "manual", date: "2026-10-21", at: 50 },
        { source: "scale", date: "2026-10-20", at: 40 },
      ],
    });
    expect(row(rows, "scale")).toMatchObject({ connected: true, lastAt: 40, recent: 1 });
    expect(row(rows, "manual")).toMatchObject({ lastAt: 50, recent: 1 });
  });

  test("manual workouts count with manual weigh-ins", () => {
    const rows = buildSources({
      ...empty,
      exercise: [{ source: "manual", date: "2026-10-22", at: 70 }],
      weights: [{ source: "manual", date: "2026-10-21", at: 60 }],
    });
    expect(row(rows, "manual")).toMatchObject({ lastAt: 70, recent: 2 });
  });
});
