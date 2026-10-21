import { describe, expect, it } from "bun:test";

import { trendChange, weightSecondary } from "./home-stats";

const today = "2026-10-21";

describe("weightSecondary", () => {
  it("is none without a weight", () => {
    expect(weightSecondary({ weightKg: null, latestWeightDate: null, today })).toEqual({ kind: "none" });
  });

  it("is today when the last weight was logged today", () => {
    expect(weightSecondary({ weightKg: 80, latestWeightDate: today, today })).toEqual({ kind: "today" });
  });

  it("falls back to loggedToday when the date is unknown", () => {
    expect(weightSecondary({ weightKg: 80, latestWeightDate: undefined, today, loggedToday: true })).toEqual({
      kind: "today",
    });
  });

  it("gives the log date for an older weight", () => {
    expect(weightSecondary({ weightKg: 80, latestWeightDate: "2026-10-18", today, loggedToday: false })).toEqual({
      kind: "last",
      when: "2026-10-18",
    });
  });

  it("is lastUnknown when the date is unknown and nothing was logged today", () => {
    expect(weightSecondary({ weightKg: 80, latestWeightDate: null, today })).toEqual({ kind: "lastUnknown" });
  });
});

describe("trendChange", () => {
  it("compares against the point seven days back", () => {
    const pts = [
      { date: "2026-10-10", trendKg: 108 },
      { date: "2026-10-14", trendKg: 107.6 },
      { date: "2026-10-21", trendKg: 107.2 },
    ];
    const c = trendChange(pts)!;
    expect(c.days).toBe(7);
    expect(c.deltaKg).toBeCloseTo(-0.4);
  });
  it("is null with a single point", () => {
    expect(trendChange([{ date: "2026-10-21", trendKg: 100 }])).toBeNull();
  });
});
