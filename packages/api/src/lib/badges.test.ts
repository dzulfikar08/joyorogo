import { describe, expect, test } from "bun:test";

import {
  BADGES,
  RAMADAN_MIN_DAYS,
  RAMADAN_WINDOWS,
  badgesEnabled,
  boardName,
  closedRamadanWindows,
  compareScores,
  evaluate,
  isLoggedFood,
  longestRun,
  normalizeAlias,
  perfectWeeks,
  ramadanDaysIn,
  rankWeek,
  weekScore,
  weekStartOf,
} from "./badges";
import { shiftDate } from "./engine";

const at = (date: string, time = "12:00", offset = "+07:00") => Date.parse(`${date}T${time}:00${offset}`);
const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(from, i));

describe("logged day", () => {
  const base = { date: "2026-11-04", kcal: 300, source: "manual", createdAtMs: at("2026-11-04") };
  test("a meal written the same day counts", () => expect(isLoggedFood(base, "Asia/Jakarta")).toBe(true));
  test("no energy, no logged day", () => {
    expect(isLoggedFood({ ...base, kcal: 0 }, "Asia/Jakarta")).toBe(false);
  });
  test("imported history never counts", () => {
    expect(isLoggedFood({ ...base, source: "huawei" }, "Asia/Jakarta")).toBe(false);
  });
  test("backdating is allowed for 2 days and no further", () => {
    expect(isLoggedFood({ ...base, createdAtMs: at("2026-11-06") }, "Asia/Jakarta")).toBe(true);
    expect(isLoggedFood({ ...base, createdAtMs: at("2026-11-07") }, "Asia/Jakarta")).toBe(false);
  });
  test("a future day is rejected", () => {
    expect(isLoggedFood({ ...base, createdAtMs: at("2026-11-03") }, "Asia/Jakarta")).toBe(false);
  });
  test("the day is cut in the person's zone", () => {
    // 00:30 on the 4th in Kuala Lumpur is 23:30 on the 3rd in Jakarta.
    const written = at("2026-11-04", "00:30", "+08:00");
    expect(isLoggedFood({ ...base, createdAtMs: written }, "Asia/Kuala_Lumpur")).toBe(true);
    expect(isLoggedFood({ ...base, createdAtMs: written }, "Asia/Jakarta")).toBe(false);
  });
});

describe("runs and weeks", () => {
  test("longestRun finds the longest consecutive run", () => {
    expect(longestRun([...run("2026-11-01", 3), ...run("2026-11-10", 5), "2026-11-20"])).toBe(5);
    expect(longestRun([])).toBe(0);
  });
  test("weeks start on Monday", () => {
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16");
  });
  test("a perfect week is 7 of 7 days Monday to Sunday", () => {
    expect(perfectWeeks(run("2026-11-02", 7))).toBe(1);
    // seven in a row that straddle two weeks is not a perfect week
    expect(perfectWeeks(run("2026-11-04", 7))).toBe(0);
    expect(perfectWeeks([...run("2026-11-02", 7), ...run("2026-11-09", 7)])).toBe(2);
  });
});

describe("evaluate", () => {
  const tiersOf = (facts: Parameters<typeof evaluate>[0], id: string) => evaluate(facts).filter((a) => a.badgeId === id).map((a) => a.tier);
  test("streak tiers are 7, 30 and 100", () => {
    expect(tiersOf({ longestStreak: 6 }, "konsisten")).toEqual([]);
    expect(tiersOf({ longestStreak: 7 }, "konsisten")).toEqual([1]);
    expect(tiersOf({ longestStreak: 30 }, "konsisten")).toEqual([1, 2]);
    expect(tiersOf({ longestStreak: 100 }, "konsisten")).toEqual([1, 2, 3]);
  });
  test("protein tiers are 10, 30 and 60 days", () => {
    expect(tiersOf({ proteinDays: 9 }, "protein-target")).toEqual([]);
    expect(tiersOf({ proteinDays: 60 }, "protein-target")).toEqual([1, 2, 3]);
  });
  test("water tiers are 7 and 30, workout routine 10 and 50", () => {
    expect(tiersOf({ waterDays: 7 }, "air-putih")).toEqual([1]);
    expect(tiersOf({ waterDays: 30 }, "air-putih")).toEqual([1, 2]);
    expect(tiersOf({ workoutDays: 9 }, "latihan-10")).toEqual([]);
    expect(tiersOf({ workoutDays: 50 }, "latihan-10")).toEqual([1, 2]);
    expect(tiersOf({ workoutDays: 1 }, "latihan-pertama")).toEqual([1]);
  });
  test("team footprint needs 7 logged days, Ramadan the minimum days", () => {
    expect(tiersOf({ teamDays: 6 }, "jejak-tim")).toEqual([]);
    expect(tiersOf({ teamDays: 7 }, "jejak-tim")).toEqual([1]);
    expect(tiersOf({ ramadanDays: RAMADAN_MIN_DAYS - 1 }, "ramadan-konsisten")).toEqual([]);
    expect(tiersOf({ ramadanDays: RAMADAN_MIN_DAYS }, "ramadan-konsisten")).toEqual([1]);
  });
  test("nothing is earned from empty facts, and ids are unique", () => {
    expect(evaluate({})).toEqual([]);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });
  test("no badge counts weight", () => {
    expect(JSON.stringify(BADGES).toLowerCase()).not.toMatch(/weight|berat|kg|waist/);
  });
});

describe("Ramadan windows", () => {
  const window = RAMADAN_WINDOWS.find((w) => w.hijri === 1448)!;
  test("1448 covers the expected dates and counts only days inside", () => {
    expect(window.start).toBe("2027-02-08");
    expect(window.end).toBe("2027-03-09");
    expect(ramadanDaysIn([...run("2027-02-01", 20), ...run("2027-03-05", 10)], window)).toBe(13 + 5);
  });
  test("a window is closed only after its last day", () => {
    expect(closedRamadanWindows("2027-03-09").map((w) => w.hijri)).toEqual([]);
    expect(closedRamadanWindows("2027-03-10").map((w) => w.hijri)).toEqual([1448]);
  });
});

describe("weekly score and order", () => {
  const weekStart = "2026-11-09";
  test("counts logged, protein and workout days of the week, and the streak at the week's end", () => {
    const score = weekScore({
      weekStart,
      asOf: "2026-11-15",
      loggedDays: [...run("2026-11-05", 11), "2026-11-20"],
      proteinDays: ["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-14"],
      workoutDays: ["2026-11-10", "2026-11-17"],
    });
    expect(score).toEqual({ daysLogged: 7, proteinHitDays: 4, workoutDays: 1, streakEnd: 11, daysMask: 0b1111111 });
  });
  test("a running week only counts up to today", () => {
    const score = weekScore({ weekStart, asOf: "2026-11-11", loggedDays: run("2026-11-09", 7), proteinDays: [], workoutDays: [] });
    expect(score.daysLogged).toBe(3);
    expect(score.daysMask).toBe(0b111);
  });
  test("protein days only count on logged days", () => {
    const score = weekScore({ weekStart, asOf: "2026-11-15", loggedDays: ["2026-11-09"], proteinDays: ["2026-11-09", "2026-11-10"], workoutDays: [] });
    expect(score.proteinHitDays).toBe(1);
  });

  const row = (userId: string, s: Partial<ReturnType<typeof weekScore>>, alias = "") => ({
    userId,
    alias,
    daysLogged: 0,
    proteinHitDays: 0,
    workoutDays: 0,
    streakEnd: 0,
    daysMask: 0,
    ...s,
  });
  test("tiebreak: days logged, workout days, protein days, streak, alias, user id", () => {
    const rows = [
      row("a", { daysLogged: 5, workoutDays: 1 }),
      row("b", { daysLogged: 6 }),
      row("c", { daysLogged: 5, workoutDays: 2 }),
      row("d", { daysLogged: 5, workoutDays: 2, proteinHitDays: 3 }),
      row("e", { daysLogged: 5, workoutDays: 2, proteinHitDays: 3, streakEnd: 9 }),
      row("f", { daysLogged: 5, workoutDays: 2, proteinHitDays: 3, streakEnd: 9 }, "zed"),
      row("g", { daysLogged: 5, workoutDays: 2, proteinHitDays: 3, streakEnd: 9 }, "abe"),
    ];
    // e has no alias: "" sorts before "abe" and "zed"
    expect(rankWeek(rows).map((r) => `${r.rank}:${r.userId}`)).toEqual(["1:b", "2:e", "3:g", "4:f", "5:d", "6:c", "7:a"]);
  });
  test("equal scores are split by user id so the order is stable", () => {
    expect(compareScores(row("a", {}), row("b", {}))).toBeLessThan(0);
  });
});

describe("alias and names", () => {
  test("3 to 20 characters of a-z 0-9 _ . -, lower-cased", () => {
    expect(normalizeAlias(" Budi_99 ")).toBe("budi_99");
    expect(normalizeAlias("ab")).toBeNull();
    expect(normalizeAlias("a".repeat(21))).toBeNull();
    expect(normalizeAlias("hai kamu")).toBeNull();
    expect(normalizeAlias("é-mail")).toBeNull();
  });
  test("username mode shows the handle, else the alias, else anonymous", () => {
    expect(boardName({ displayMode: "username", handle: "budi", alias: "x" })).toEqual({ name: "budi", anonymous: false });
    expect(boardName({ displayMode: "anonim", handle: "budi", alias: "kancil" })).toEqual({ name: "kancil", anonymous: false });
    expect(boardName({ displayMode: "anonim", handle: "budi", alias: null })).toEqual({ name: null, anonymous: true });
  });
});

describe("flag", () => {
  test("allowlist, star and empty", () => {
    expect(badgesEnabled({}, "u1")).toBe(false);
    expect(badgesEnabled({ BADGES_USER_IDS: "" }, "u1")).toBe(false);
    expect(badgesEnabled({ BADGES_USER_IDS: "u1, u2" }, "u2")).toBe(true);
    expect(badgesEnabled({ BADGES_USER_IDS: "u1" }, "u3")).toBe(false);
    expect(badgesEnabled({ BADGES_USER_IDS: "*" }, "anyone")).toBe(true);
  });
});
