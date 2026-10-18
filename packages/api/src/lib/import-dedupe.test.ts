import { describe, expect, test } from "bun:test";

import { crossSourceMatcher } from "./import-dedupe";

const row = (durationMin: number | null, type: string | null = "Run", date = "2026-10-17") => ({ date, type, durationMin });

describe("crossSourceMatcher", () => {
  test("the same workout read by the other source is a duplicate", () => {
    const matcher = crossSourceMatcher([row(30)]);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 31 })).toBe(true);
  });

  test("another day, type or a different length is a different workout", () => {
    const matcher = crossSourceMatcher([row(30)]);
    expect(matcher.claim({ date: "2026-10-18", type: "Run", durationMin: 30 })).toBe(false);
    expect(matcher.claim({ date: "2026-10-17", type: "Ride", durationMin: 30 })).toBe(false);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 33 })).toBe(false);
  });

  test("a stored row absorbs one candidate only: two real walks of the same length both stay", () => {
    const matcher = crossSourceMatcher([row(30)]);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 30 })).toBe(true);
    expect(matcher.claim({ date: "2026-10-17", type: "Run", durationMin: 30 })).toBe(false);
  });

  test("rows without a duration never match", () => {
    expect(crossSourceMatcher([row(null)]).claim({ date: "2026-10-17", type: "Run", durationMin: 30 })).toBe(false);
  });
});
