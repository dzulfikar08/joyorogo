import { describe, expect, test } from "bun:test";

import { jakartaToday } from "./engine";

import { advanceClock } from "./jakarta-clock";

// 2026-10-20 23:59:30 WIB = 16:59:30 UTC.
const before = new Date("2026-10-20T16:59:30.000Z");
// 2026-10-21 00:00:05 WIB = 17:00:05 UTC.
const after = new Date("2026-10-20T17:00:05.000Z");

describe("advanceClock", () => {
  test("keeps the same Date while the WIB hour is unchanged", () => {
    const later = new Date("2026-10-20T16:59:59.000Z");
    expect(advanceClock(before, later)).toBe(before);
  });

  test("moves to the new day when a tick crosses WIB midnight", () => {
    expect(jakartaToday(before)).toBe("2026-10-20");
    const next = advanceClock(before, after);
    expect(next).toBe(after);
    expect(jakartaToday(next)).toBe("2026-10-21");
  });

  test("the app opened a full day later lands on that day", () => {
    const next = advanceClock(before, new Date("2026-10-21T22:00:00.000Z"));
    expect(jakartaToday(next)).toBe("2026-10-22");
  });

  test("the greeting hour boundary also advances", () => {
    // 10:59:59 WIB -> 11:00:00 WIB (pagi -> siang).
    const pagi = new Date("2026-10-21T03:59:59.000Z");
    const siang = new Date("2026-10-21T04:00:00.000Z");
    expect(advanceClock(pagi, siang)).toBe(siang);
  });

  test("a clock that went backwards still resyncs on a different hour", () => {
    const earlier = new Date("2026-10-20T10:00:00.000Z");
    expect(advanceClock(before, earlier)).toBe(earlier);
  });
});
