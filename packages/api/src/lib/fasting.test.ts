import { describe, expect, test } from "bun:test";

import type { DayLog } from "./fasting";
import {
  adherenceWeek,
  buildSchedule,
  countKept,
  dayReminders,
  dueReminders,
  fastingDay,
  fmtCountdown,
  fmtHHMM,
  insideWindow,
  minutesUntil,
  parseHHMM,
  slotForTime,
  windowHoursFor,
  windowTimes,
  wibDateKey,
  wibMinutes,
} from "./fasting";

describe("clock helpers", () => {
  test("parseHHMM accepts H:MM and HH:MM, rejects out of range", () => {
    expect(parseHHMM("12:00")).toBe(720);
    expect(parseHHMM("7:05")).toBe(425);
    expect(parseHHMM("24:00")).toBe(null);
    expect(parseHHMM("12:60")).toBe(null);
    expect(parseHHMM("pagi")).toBe(null);
  });

  test("fmtHHMM pads and wraps around midnight", () => {
    expect(fmtHHMM(720)).toBe("12:00");
    expect(fmtHHMM(425)).toBe("07:05");
    expect(fmtHHMM(1440 + 90)).toBe("01:30");
    expect(fmtHHMM(-30)).toBe("23:30");
  });

  test("wibMinutes / wibDateKey follow UTC+7 across the UTC day boundary", () => {
    // 2026-10-13T17:30:00Z → 00:30 WIB on the 14th.
    const late = new Date("2026-10-13T17:30:00Z");
    expect(wibMinutes(late)).toBe(30);
    expect(wibDateKey(late)).toBe("2026-10-14");
    expect(wibMinutes(new Date("2026-10-13T05:00:00Z"))).toBe(720);
  });

  test("minutesUntil counts forward around midnight", () => {
    expect(minutesUntil(720, 480)).toBe(240);
    expect(minutesUntil(360, 1380)).toBe(420); // 23:00 → 06:00 crosses midnight
    expect(minutesUntil(480, 480)).toBe(0);
  });

  test("fmtCountdown reads naturally", () => {
    expect(fmtCountdown(0)).toBe("<1 mnt");
    expect(fmtCountdown(45)).toBe("45 mnt");
    expect(fmtCountdown(85)).toBe("1 j 25 mnt");
    expect(fmtCountdown(120)).toBe("2 j");
  });
});

describe("window boundaries", () => {
  test("non-crossing 12:00–20:00 window", () => {
    const w = windowTimes("12:00", 8);
    expect(w).toEqual({ startMin: 720, endMin: 1200 });
    expect(insideWindow(719, w)).toBe(false);
    expect(insideWindow(720, w)).toBe(true);
    expect(insideWindow(1199, w)).toBe(true);
    expect(insideWindow(1200, w)).toBe(false);
  });

  test("crossing 22:00–06:00 window includes the early morning", () => {
    const w = windowTimes("22:00", 8);
    expect(w.endMin).toBe(1440 + 360);
    expect(insideWindow(1259, w)).toBe(false);
    expect(insideWindow(1320, w)).toBe(true);
    expect(insideWindow(359, w)).toBe(true);
    expect(insideWindow(360, w)).toBe(false);
    expect(insideWindow(720, w)).toBe(false);
  });
});

describe("buildSchedule", () => {
  test("16:8 from 12:00 → buka 12:00, camilan 15:30, terakhir 19:30", () => {
    const plan = buildSchedule("16:8", "12:00");
    expect(plan.map((m) => [fmtHHMM(m.atMin), m.kind, m.share])).toEqual([
      ["12:00", "buka", 0.45],
      ["15:30", "camilan", 0.15],
      ["19:30", "terakhir", 0.4],
    ]);
  });

  test("18:6 and 20:4 carry two meals, OMAD exactly one", () => {
    expect(buildSchedule("18:6", "12:00").map((m) => [fmtHHMM(m.atMin), m.kind])).toEqual([
      ["12:00", "buka"],
      ["17:30", "terakhir"],
    ]);
    expect(buildSchedule("20:4", "12:00")).toHaveLength(2);
    const omad = buildSchedule("omad", "19:00");
    expect(omad).toHaveLength(1);
    expect(omad[0]).toMatchObject({ share: 1, kind: "buka" });
  });

  test("window hours follow the pattern", () => {
    expect(windowHoursFor("16:8")).toBe(8);
    expect(windowHoursFor("omad")).toBe(1);
  });

  test("meals map onto existing meal slots so logging keeps working", () => {
    expect(slotForTime(420)).toBe("sarapan");
    expect(slotForTime(720)).toBe("makan_siang");
    expect(slotForTime(1020)).toBe("makan_malam");
    expect(slotForTime(1330)).toBe("snack");
  });
});

describe("fastingDay", () => {
  const BASE = { pattern: "16:8" as const, windowStart: "12:00", eatKcal: 1600 };

  test("before the window: puasa, countdown to open, full plan", () => {
    const day = fastingDay({ ...BASE, logs: [], nowMin: 480 });
    expect(day.state).toBe("puasa");
    // At 08:00 the buka meal and the window open coincide; the meal wins ties.
    expect(day.nextEvent).toMatchObject({ kind: "meal", time: "12:00", minutesAway: 240 });
    expect(day.schedule.map((m) => [m.time, m.kcal, m.past])).toEqual([
      ["12:00", 720, false],
      ["15:30", 240, false],
      ["19:30", 640, false],
    ]);
    expect(day.remainingKcal).toBe(1600);
  });

  test("inside the window with buka logged: future meals split the remainder", () => {
    const logs: DayLog[] = [{ kcal: 700, meal: "makan_siang", min: 720 }];
    const day = fastingDay({ ...BASE, logs, nowMin: 900 });
    expect(day.state).toBe("jendela_makan");
    expect(day.nextEvent).toMatchObject({ kind: "meal", time: "15:30" });
    expect(day.lastMeal).toEqual({ time: "12:00", meal: "makan_siang", kcal: 700 });
    // 900 kcal left, split by future shares (15/55, 40/55).
    expect(day.schedule[0]).toMatchObject({ kind: "buka", kcal: 720, past: true });
    expect(day.schedule[1]).toMatchObject({ kcal: 245, past: false });
    expect(day.schedule[2]).toMatchObject({ kcal: 655, past: false });
    expect(day.schedule[1]!.kcal + day.schedule[2]!.kcal).toBe(900);
    expect(day.remainingKcal).toBe(900);
  });

  test("over the budget: nothing planned ahead, overage visible", () => {
    const logs: DayLog[] = [
      { kcal: 700, meal: "makan_siang", min: 725 },
      { kcal: 500, meal: "snack", min: 950 },
      { kcal: 900, meal: "makan_malam", min: 1150 },
    ];
    const day = fastingDay({ ...BASE, logs, nowMin: 1160 });
    expect(day.remainingKcal).toBe(0);
    expect(day.schedule.every((m) => m.kcal === 0 || m.past)).toBe(true);
    expect(day.lastMeal).toMatchObject({ time: "19:10" });
  });

  test("food logged outside the window is flagged with times and kcal", () => {
    const logs: DayLog[] = [
      { kcal: 300, meal: "sarapan", min: 540 },
      { kcal: 700, meal: "makan_siang", min: 750 },
    ];
    const day = fastingDay({ ...BASE, logs, nowMin: 800 });
    expect(day.outsideWindow).toEqual([{ meal: "sarapan", kcal: 300, time: "09:00" }]);
    expect(day.outsideWindowKcal).toBe(300);
  });

  test("crossing window 22:00–06:00: late evening is makan time", () => {
    const day = fastingDay({
      pattern: "20:4",
      windowStart: "22:00",
      eatKcal: 1800,
      logs: [],
      nowMin: 1380,
    });
    expect(day.state).toBe("jendela_makan");
    expect(day.windowOpen).toBe("22:00");
    expect(day.windowClose).toBe("02:00");
    expect(day.nextEvent).toMatchObject({ kind: "meal", time: "01:30", minutesAway: 150 });
    // Morning of the same WIB day: still fasting, window opens 22:00 again.
    const morning = fastingDay({
      pattern: "20:4",
      windowStart: "22:00",
      eatKcal: 1800,
      logs: [],
      nowMin: 480,
    });
    expect(morning.state).toBe("puasa");
    expect(morning.nextEvent).toMatchObject({
      kind: "meal",
      mealKind: "buka",
      time: "22:00",
      minutesAway: 840,
    });
  });

  test("OMAD: one meal worth the whole budget", () => {
    const day = fastingDay({
      pattern: "omad",
      windowStart: "19:00",
      eatKcal: 1600,
      logs: [],
      nowMin: 600,
    });
    expect(day.schedule).toEqual([
      expect.objectContaining({ time: "19:00", kcal: 1600, meal: "makan_malam", past: false }),
    ]);
    expect(day.nextEvent).toMatchObject({ kind: "meal", time: "19:00", minutesAway: 540 });
  });

  test("Ramadan takes precedence: feature steps aside", () => {
    const day = fastingDay({ ...BASE, logs: [], nowMin: 720, ramadan: true });
    expect(day.active).toBe(false);
    expect(day.ramadan).toBe(true);
    expect(day.schedule).toEqual([]);
  });
});

describe("adherence", () => {
  const week = [
    { date: "2026-10-06", logs: [{ kcal: 500, meal: "makan_siang" as const, min: 750 }] },
    {
      date: "2026-10-07",
      logs: [
        { kcal: 500, meal: "makan_siang" as const, min: 750 },
        { kcal: 200, meal: "sarapan" as const, min: 480 },
      ],
    },
    { date: "2026-10-08", logs: [] },
    {
      date: "2026-10-09",
      logs: [
        { kcal: 700, meal: "makan_siang" as const, min: 730 },
        { kcal: 640, meal: "makan_malam" as const, min: 1170 },
      ],
    },
  ];

  test("kept when every log sits inside the window; no logs → null", () => {
    const days = adherenceWeek(week, "12:00", "16:8");
    expect(days.map((d) => d.kept)).toEqual([true, false, null, true]);
    expect(countKept(days)).toBe(2);
  });
});

describe("reminders", () => {
  test("16:8 day: open, camilan, last-meal-with-30-min-warning (merged)", () => {
    const drafts = dayReminders({
      pattern: "16:8",
      windowStart: "12:00",
      dateKey: "2026-10-13",
      remainingKcal: 900,
    });
    expect(drafts.map((d) => [d.key, d.atMin])).toEqual([
      ["2026-10-13:open", 720],
      ["2026-10-13:m1", 930],
      ["2026-10-13:m2", 1170],
    ]);
    // Last meal carries the closing warning instead of a duplicate buzz.
    expect(drafts[2]!.title).toBe("Waktunya makan terakhir");
    expect(drafts[2]!.body).toContain("30 menit lagi jendela tutup");
  });

  test("OMAD keeps both meal and 30-minute warning", () => {
    const drafts = dayReminders({
      pattern: "omad",
      windowStart: "19:00",
      dateKey: "2026-10-13",
      remainingKcal: 1600,
    });
    expect(drafts.map((d) => d.key)).toEqual(["2026-10-13:open", "2026-10-13:close30"]);
    expect(drafts[1]).toMatchObject({ title: "30 menit lagi jendela tutup", atMin: 1170 });
  });

  test("dueReminders picks the elapsed 5-minute tick only", () => {
    const input = {
      pattern: "16:8" as const,
      windowStart: "12:00",
      dateKey: "2026-10-13",
      remainingKcal: 900,
    };
    expect(dueReminders({ ...input, nowMin: 723 }).map((d) => d.key)).toEqual(["2026-10-13:open"]);
    expect(dueReminders({ ...input, nowMin: 719 })).toEqual([]);
    expect(dueReminders({ ...input, nowMin: 725 })).toEqual([]);
    expect(dueReminders({ ...input, nowMin: 933 }).map((d) => d.key)).toEqual(["2026-10-13:m1"]);
  });
});
