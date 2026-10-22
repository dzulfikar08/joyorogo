import { describe, expect, test } from "bun:test";

import { RANGE_DAYS, canStepBack, canStepForward, chunk, daysOf, windowAt } from "./range-window";

describe("windowAt", () => {
  test("offset 0 ends today and spans exactly the days asked", () => {
    expect(windowAt(7, 0, "2026-10-22")).toEqual({ from: "2026-10-16", to: "2026-10-22" });
  });

  test("older windows sit right before each other without overlap", () => {
    const first = windowAt(7, 1, "2026-10-22");
    expect(first).toEqual({ from: "2026-10-09", to: "2026-10-15" });
    expect(windowAt(7, 0, "2026-10-22").from).toBe("2026-10-16");
  });

  test("crosses a month and a year", () => {
    expect(windowAt(30, 0, "2026-01-10")).toEqual({ from: "2025-12-12", to: "2026-01-10" });
    expect(daysOf(windowAt(30, 2, "2026-03-01"))).toHaveLength(30);
  });
});

describe("stepping", () => {
  test("cannot step forward from the newest window", () => {
    expect(canStepForward(0)).toBe(false);
    expect(canStepForward(1)).toBe(true);
  });

  test("steps back only while an earlier window reaches the first day with data", () => {
    expect(canStepBack(7, 0, "2026-10-22", "2026-10-12")).toBe(true);
    expect(canStepBack(7, 0, "2026-10-22", "2026-10-16")).toBe(false);
    expect(canStepBack(7, 0, "2026-10-22", null)).toBe(true);
  });
});

describe("chunk", () => {
  test("a year of weeks divides exactly", () => {
    expect(chunk(daysOf(windowAt(RANGE_DAYS.y, 0, "2026-10-22")), 7)).toHaveLength(52);
  });

  test("keeps a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
