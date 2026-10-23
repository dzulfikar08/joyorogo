import { describe, expect, test } from "bun:test";

import {
  defaultEatenAt,
  eatenAtClock,
  eatenAtFromClock,
  eatenAtFitsDay,
  eatenAtNudge,
  eatenAtPresets,
  eatenAtProblem,
  mealFitsClock,
  usualEatenAt,
} from "./eaten-at";

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

  test("rejects more than a few minutes ahead and older than 45 days", () => {
    expect(eatenAtProblem(now.getTime() + 9 * 60_000, "2026-10-20", now)).toBeNull();
    expect(eatenAtProblem(now.getTime() + 11 * 60_000, "2026-10-20", now)).toBe("too_far_ahead");
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

describe("Kuala Lumpur day", () => {
  const KL = "Asia/Kuala_Lumpur" as const;
  const myt = (iso: string) => Date.parse(`${iso}+08:00`);
  // 2026-10-21 23:30 MYT
  const late = new Date("2026-10-21T15:30:00Z");

  test("23:30 MYT belongs to that MYT day", () => {
    expect(eatenAtProblem(myt("2026-10-21T23:30:00"), "2026-10-21", late, KL)).toBeNull();
  });

  test("00:30 MYT with the new date is not a wrong day, and the late-night rule still reaches back", () => {
    const after = new Date("2026-10-21T16:30:00Z");
    expect(eatenAtProblem(myt("2026-10-22T00:30:00"), "2026-10-22", after, KL)).toBeNull();
    expect(eatenAtProblem(myt("2026-10-22T00:30:00"), "2026-10-21", after, KL)).toBeNull();
    const midday = new Date("2026-10-22T05:00:00Z");
    expect(eatenAtProblem(myt("2026-10-22T04:00:00"), "2026-10-21", midday, KL)).toBe("wrong_day");
  });

  test("Jakarta is unchanged: the same instants land a day apart", () => {
    const after = new Date("2026-10-21T16:30:00Z");
    expect(eatenAtProblem(after.getTime(), "2026-10-21", after, "Asia/Jakarta")).toBeNull();
    expect(eatenAtProblem(after.getTime(), "2026-10-22", after, "Asia/Jakarta")).toBe("wrong_day");
    expect(eatenAtProblem(after.getTime(), "2026-10-22", after, KL)).toBeNull();
  });

  test("defaults and clock round-trip in KL", () => {
    expect(defaultEatenAt("2026-10-21", "sarapan", late, KL)).toBe(late.getTime());
    expect(defaultEatenAt("2026-10-20", "makan_malam", late, KL)).toBe(myt("2026-10-20T19:00:00"));
    const ms = eatenAtFromClock("2026-10-21", "23:30", KL);
    expect(ms).toBe(late.getTime());
    expect(eatenAtClock(ms!, KL)).toBe("23:30");
    expect(eatenAtClock(ms!, "Asia/Jakarta")).toBe("22:30");
  });
});

describe("nudge and presets", () => {
  // 2026-10-20 21:00 WIB, logging a late dinner... as breakfast
  const evening = new Date("2026-10-20T14:00:00Z");

  test("meal slots that do not suit the clock", () => {
    expect(mealFitsClock("sarapan", 7 * 60)).toBe(true);
    expect(mealFitsClock("sarapan", 21 * 60)).toBe(false);
    expect(mealFitsClock("makan_siang", 13 * 60)).toBe(true);
    expect(mealFitsClock("makan_malam", 21 * 60)).toBe(true);
    expect(mealFitsClock("makan_malam", 1 * 60)).toBe(true);
    expect(mealFitsClock("makan_malam", 9 * 60)).toBe(false);
    expect(mealFitsClock("snack", 3 * 60)).toBe(true);
  });

  test("Sarapan at 21:00 nudges toward the usual 07:00; a fitting slot does not", () => {
    expect(eatenAtNudge("2026-10-20", "sarapan", evening)).toBe(wib("2026-10-20T07:00:00"));
    expect(eatenAtNudge("2026-10-20", "makan_siang", evening)).toBe(wib("2026-10-20T12:30:00"));
    expect(eatenAtNudge("2026-10-20", "makan_malam", evening)).toBeNull();
    expect(eatenAtNudge("2026-10-20", "snack", evening)).toBeNull();
  });

  test("no nudge for another day, nor when the slot's usual time is still ahead", () => {
    expect(eatenAtNudge("2026-10-19", "sarapan", evening)).toBeNull();
    const morning = new Date("2026-10-20T01:00:00Z"); // 08:00 WIB
    expect(eatenAtNudge("2026-10-20", "makan_malam", morning)).toBeNull();
    expect(usualEatenAt("2026-10-20", "makan_malam", morning)).toBeNull();
  });

  test("presets are the parts of the day already behind us, and all valid", () => {
    // 12:00 WIB: only the morning is behind us
    expect(eatenAtPresets("2026-10-20", now)).toEqual([{ key: "pagi", eatenAt: wib("2026-10-20T07:00:00") }]);
    expect(eatenAtPresets("2026-10-20", evening).map((p) => p.key)).toEqual(["pagi", "siang", "malam"]);
    // a past day offers all three
    expect(eatenAtPresets("2026-10-18", now).map((p) => p.key)).toEqual(["pagi", "siang", "malam"]);
    for (const p of eatenAtPresets("2026-10-20", evening)) {
      expect(eatenAtProblem(p.eatenAt, "2026-10-20", evening)).toBeNull();
    }
  });

  test("eatenAtFitsDay: the day itself and 00:00-03:59 after it", () => {
    expect(eatenAtFitsDay(wib("2026-10-20T12:00:00"), "2026-10-20")).toBe(true);
    expect(eatenAtFitsDay(wib("2026-10-21T02:00:00"), "2026-10-20")).toBe(true);
    expect(eatenAtFitsDay(wib("2026-10-21T04:00:00"), "2026-10-20")).toBe(false);
    expect(eatenAtFitsDay(wib("2026-10-19T23:00:00"), "2026-10-20")).toBe(false);
  });
});
