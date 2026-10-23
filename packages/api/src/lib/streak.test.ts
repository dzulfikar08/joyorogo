import { describe, expect, test } from "bun:test";

import { jakartaToday, shiftDate } from "./engine";
import { runReachesWindow, streakAt, streakState } from "./streak";

const TODAY = "2026-10-23";
const back = (n: number) => shiftDate(TODAY, -n);
const run = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => back(from - i));

describe("streakState", () => {
  test("today logged: the flame is lit and counts today", () => {
    expect(streakState([back(2), back(1), TODAY], TODAY)).toEqual({
      days: 3,
      status: "done",
      lastLoggedDate: TODAY,
      lapseDays: 0,
    });
  });

  test("today not logged yet, yesterday was: the streak is alive but at risk, and still counts", () => {
    expect(streakState(run(5, 1), TODAY)).toEqual({
      days: 5,
      status: "at_risk",
      lastLoggedDate: back(1),
      lapseDays: 1,
    });
  });

  test("yesterday missed: the streak is broken, the count falls to 0 and the lapse counts the days since the last log", () => {
    // Last logged the 20th: the 21st, 22nd and 23rd are blank -> 3 hari tanpa catat.
    expect(streakState(run(10, 3), TODAY)).toEqual({
      days: 0,
      status: "broken",
      lastLoggedDate: back(3),
      lapseDays: 3,
    });
  });

  test("a single day missed (last log two days ago) is the smallest broken streak", () => {
    expect(streakState([back(2), back(3)], TODAY)).toMatchObject({ days: 0, status: "broken", lapseDays: 2 });
  });

  test("nothing logged in the window: none, no lapse to count", () => {
    expect(streakState([], TODAY)).toEqual({ days: 0, status: "none", lastLoggedDate: null, lapseDays: 0 });
  });

  test("a gap inside the history ends the run at the gap", () => {
    expect(streakState([TODAY, back(1), back(3), back(4)], TODAY).days).toBe(2);
  });

  test("days after today (a zone change or a clock ahead) never count, nor become the last log", () => {
    const out = streakState([shiftDate(TODAY, 1), back(1)], TODAY);
    expect(out).toMatchObject({ days: 1, status: "at_risk", lastLoggedDate: back(1) });
  });

  test("repeated dates count once", () => {
    expect(streakState([TODAY, TODAY, back(1), back(1)], TODAY).days).toBe(2);
  });
});

describe("streakState across zones", () => {
  // 2026-10-21T16:30Z is 00:30 on the 22nd in Kuala Lumpur (UTC+8) and 23:30 on the 21st in Jakarta (UTC+7).
  const now = new Date("2026-10-21T16:30:00Z");
  const logged = ["2026-10-20", "2026-10-21"];

  test("the same two logged days keep a lit streak for Jakarta but are at risk for Kuala Lumpur", () => {
    const wib = streakState(logged, jakartaToday(now, "Asia/Jakarta"));
    const myt = streakState(logged, jakartaToday(now, "Asia/Kuala_Lumpur"));
    expect(wib).toMatchObject({ days: 2, status: "done", lapseDays: 0 });
    expect(myt).toMatchObject({ days: 2, status: "at_risk", lapseDays: 1 });
  });

  test("an hour later (17:30Z) Jakarta has rolled over too", () => {
    const later = new Date("2026-10-21T17:30:00Z");
    expect(streakState(logged, jakartaToday(later, "Asia/Jakarta"))).toMatchObject({ days: 2, status: "at_risk" });
    // Kuala Lumpur is already 01:30 on the 22nd: nothing changes.
    expect(streakState(logged, jakartaToday(later, "Asia/Kuala_Lumpur"))).toMatchObject({ days: 2, status: "at_risk" });
  });

  test("a log at 00:20 MYT on the 22nd lights the Kuala Lumpur flame while Jakarta, still on the 21st, is unchanged", () => {
    const withLateLog = [...logged, "2026-10-22"];
    expect(streakState(withLateLog, "2026-10-22")).toMatchObject({ days: 3, status: "done" });
    expect(streakState(withLateLog, "2026-10-21")).toMatchObject({ days: 2, status: "done" });
  });
});

describe("streakAt (ageing a stored stamp on the phone's date)", () => {
  const stamp = { days: 12, lastLoggedDate: TODAY };

  test("lit today, at risk after midnight, broken the day after", () => {
    expect(streakAt(stamp, TODAY)).toMatchObject({ days: 12, status: "done", lapseDays: 0 });
    expect(streakAt(stamp, shiftDate(TODAY, 1))).toMatchObject({ days: 12, status: "at_risk", lapseDays: 1 });
    expect(streakAt(stamp, shiftDate(TODAY, 2))).toMatchObject({ days: 0, status: "broken", lapseDays: 2 });
    expect(streakAt(stamp, shiftDate(TODAY, 5))).toMatchObject({ days: 0, status: "broken", lapseDays: 5 });
  });

  test("a stamp read on the date it was made equals the state computed from the dates", () => {
    const dates = run(9, 1);
    const state = streakState(dates, TODAY);
    expect(streakAt({ days: state.days, lastLoggedDate: state.lastLoggedDate }, TODAY)).toEqual(state);
  });

  test("a phone date behind the stamp's last day reads as today, never a negative lapse", () => {
    expect(streakAt(stamp, back(1))).toMatchObject({ days: 12, status: "done", lapseDays: 0 });
  });

  test("a stamp with no last day is none", () => {
    expect(streakAt({ days: 0, lastLoggedDate: null }, TODAY).status).toBe("none");
  });
});

describe("runReachesWindow", () => {
  const windowStart = back(45);

  test("a run that stops inside the window does not need older days", () => {
    expect(runReachesWindow(streakState(run(30, 0), TODAY), TODAY, windowStart)).toBe(false);
  });

  test("a run that fills the window (done today, or at risk ending yesterday) does", () => {
    expect(runReachesWindow(streakState(run(45, 0), TODAY), TODAY, windowStart)).toBe(true);
    expect(runReachesWindow(streakState(run(45, 1), TODAY), TODAY, windowStart)).toBe(true);
    expect(runReachesWindow(streakState(run(44, 1), TODAY), TODAY, windowStart)).toBe(false);
  });

  test("a broken or empty streak never does", () => {
    expect(runReachesWindow(streakState(run(45, 3), TODAY), TODAY, windowStart)).toBe(false);
    expect(runReachesWindow(streakState([], TODAY), TODAY, windowStart)).toBe(false);
  });
});
