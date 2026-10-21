import { describe, expect, test } from "bun:test";

import { dayTargetStatus, monthSummary } from "./diary-view";

describe("dayTargetStatus", () => {
  test("a losing plan treats the target as a ceiling", () => {
    expect(dayTargetStatus(1800, 2000, "lose")).toBe("within");
    expect(dayTargetStatus(2000, 2000, "lose")).toBe("within");
    expect(dayTargetStatus(2001, 2000, "lose")).toBe("over");
  });

  test("a gain plan treats the target as a floor and never reads over", () => {
    expect(dayTargetStatus(3500, 2800, "gain")).toBe("within");
    expect(dayTargetStatus(1200, 2800, "gain")).toBe("under");
  });

  test("Hamil/Menyusui, a missing target and an empty day judge nothing", () => {
    expect(dayTargetStatus(2500, 2000, "neutral")).toBeNull();
    expect(dayTargetStatus(2500, null, "lose")).toBeNull();
    expect(dayTargetStatus(2500, 0, "lose")).toBeNull();
    expect(dayTargetStatus(0, 2000, "lose")).toBeNull();
  });
});

describe("monthSummary", () => {
  test("counts days by status and averages intake over the logged days", () => {
    const days = [{ kcal: 1800 }, { kcal: 2400 }, { kcal: 1900 }];
    expect(monthSummary(days, 2000, "lose")).toEqual({
      logged: 3,
      within: 2,
      over: 1,
      under: 0,
      avgKcal: 2033,
    });
  });

  test("no target still reports logged days and the average", () => {
    expect(monthSummary([{ kcal: 1000 }, { kcal: 2000 }], null, "lose")).toEqual({
      logged: 2,
      within: 0,
      over: 0,
      under: 0,
      avgKcal: 1500,
    });
  });

  test("an empty month has no average", () => {
    expect(monthSummary([], 2000, "lose")).toEqual({
      logged: 0,
      within: 0,
      over: 0,
      under: 0,
      avgKcal: null,
    });
  });
});
