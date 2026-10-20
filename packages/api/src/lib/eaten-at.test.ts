import { describe, expect, test } from "bun:test";

import { defaultEatenAt, eatenAtClock, eatenAtFromClock, eatenAtProblem } from "./eaten-at";

// 2026-10-20 12:00 WIB
const now = new Date("2026-10-20T05:00:00Z");
const wib = (iso: string) => Date.parse(`${iso}+07:00`);

describe("eatenAtProblem", () => {
  test("accepts a time on the item's WIB day", () => {
    expect(eatenAtProblem(wib("2026-10-20T08:00:00"), "2026-10-20", now)).toBeNull();
    expect(eatenAtProblem(wib("2026-10-18T23:59:00"), "2026-10-18", now)).toBeNull();
  });

  test("the next day counts only between 00:00 and 03:59 WIB", () => {
    expect(eatenAtProblem(wib("2026-10-19T00:00:00"), "2026-10-18", now)).toBeNull();
    expect(eatenAtProblem(wib("2026-10-19T03:59:00"), "2026-10-18", now)).toBeNull();
    expect(eatenAtProblem(wib("2026-10-19T04:00:00"), "2026-10-18", now)).toBe("wrong_day");
  });

  test("rejects the day before and other days", () => {
    expect(eatenAtProblem(wib("2026-10-17T23:00:00"), "2026-10-18", now)).toBe("wrong_day");
    expect(eatenAtProblem(wib("2026-10-16T10:00:00"), "2026-10-18", now)).toBe("wrong_day");
  });

  test("rejects more than a day ahead and older than 45 days", () => {
    expect(eatenAtProblem(now.getTime() + 25 * 3_600_000, "2026-10-21", now)).toBe("too_far_ahead");
    expect(eatenAtProblem(wib("2026-09-01T10:00:00"), "2026-09-01", now)).toBe("too_old");
    expect(eatenAtProblem(wib("2026-09-10T10:00:00"), "2026-09-10", now)).toBeNull();
  });

  test("rejects non-integers", () => {
    expect(eatenAtProblem(now.getTime() + 0.5, "2026-10-20", now)).toBe("not_integer");
  });
});

describe("defaultEatenAt", () => {
  test("today suggests now", () => {
    expect(defaultEatenAt("2026-10-20", "sarapan", now)).toBe(now.getTime());
  });

  test("other days suggest the meal's usual WIB time", () => {
    expect(defaultEatenAt("2026-10-18", "sarapan", now)).toBe(wib("2026-10-18T07:00:00"));
    expect(defaultEatenAt("2026-10-18", "makan_siang", now)).toBe(wib("2026-10-18T12:30:00"));
    expect(defaultEatenAt("2026-10-18", "makan_malam", now)).toBe(wib("2026-10-18T19:00:00"));
    expect(defaultEatenAt("2026-10-18", "snack", now)).toBe(wib("2026-10-18T16:00:00"));
  });

  test("suggestions pass validation", () => {
    for (const meal of ["sarapan", "makan_siang", "makan_malam", "snack"]) {
      expect(eatenAtProblem(defaultEatenAt("2026-10-18", meal, now), "2026-10-18", now)).toBeNull();
    }
  });
});

describe("clock conversion", () => {
  test("round-trips WIB HH:MM on a day", () => {
    const ms = eatenAtFromClock("2026-10-18", "19:05");
    expect(ms).toBe(wib("2026-10-18T19:05:00"));
    expect(eatenAtClock(ms!)).toBe("19:05");
  });

  test("rejects malformed clocks", () => {
    expect(eatenAtFromClock("2026-10-18", "7:00")).toBeNull();
    expect(eatenAtFromClock("2026-10-18", "24:00")).toBeNull();
    expect(eatenAtFromClock("2026-10-18", "12:60")).toBeNull();
  });
});
