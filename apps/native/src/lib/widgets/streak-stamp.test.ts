import { describe, expect, test } from "bun:test";

import { withPreviousLog } from "./streak-stamp";

describe("withPreviousLog", () => {
  test("a last day that moved forward remembers the day it moved from", () => {
    expect(withPreviousLog({ days: 1, lastLoggedDate: "2026-10-23" }, { days: 4, lastLoggedDate: "2026-10-10" })).toEqual({
      days: 1,
      lastLoggedDate: "2026-10-23",
      previousLoggedDate: "2026-10-10",
    });
  });

  test("the same last day keeps what was already remembered", () => {
    const before = { days: 1, lastLoggedDate: "2026-10-23", previousLoggedDate: "2026-10-10" };
    expect(withPreviousLog({ days: 1, lastLoggedDate: "2026-10-23" }, before)).toEqual(before);
    expect(withPreviousLog({ days: 1, lastLoggedDate: "2026-10-23" }, { days: 1, lastLoggedDate: "2026-10-23" })).toEqual({
      days: 1,
      lastLoggedDate: "2026-10-23",
      previousLoggedDate: null,
    });
  });

  test("nothing before (first write, signed out, no streak) or no last day: no earlier log", () => {
    for (const before of [null, undefined, { days: 0, lastLoggedDate: null }]) {
      expect(withPreviousLog({ days: 1, lastLoggedDate: "2026-10-23" }, before).previousLoggedDate).toBeNull();
    }
    expect(withPreviousLog({ days: 0, lastLoggedDate: null }, { days: 3, lastLoggedDate: "2026-10-10" })).toEqual({
      days: 0,
      lastLoggedDate: null,
      previousLoggedDate: null,
    });
  });

  test("a last day that moved backwards (a deleted log) is not an earlier log", () => {
    expect(withPreviousLog({ days: 1, lastLoggedDate: "2026-10-10" }, { days: 1, lastLoggedDate: "2026-10-23" }).previousLoggedDate).toBeNull();
  });
});
