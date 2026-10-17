import { describe, expect, test } from "bun:test";

import {
  assignRanks,
  buildProgress,
  challengeEndDate,
  challengeShareText,
  challengeStatus,
  compareRank,
  defaultChallengeTitle,
  describeGoal,
  evaluateDay,
  fitnessFacts,
  foodFacts,
  memberFromDate,
  stepsFacts,
  validateChallengeInput,
  verificationLabel,
  workoutFacts,
} from "./challenge";
import type { DayFacts } from "./challenge";

const today = "2026-10-15";

describe("dates and status", () => {
  test("end date is inclusive of the duration", () => {
    expect(challengeEndDate("2026-10-15", 7)).toBe("2026-10-21");
    expect(challengeEndDate("2026-10-28", 7)).toBe("2026-11-03");
    expect(challengeEndDate("2026-10-15", 30)).toBe("2026-11-13");
  });

  test("status upcoming, active, ended", () => {
    expect(challengeStatus("2026-10-16", "2026-10-22", today)).toBe("upcoming");
    expect(challengeStatus("2026-10-15", "2026-10-21", today)).toBe("active");
    expect(challengeStatus("2026-10-09", "2026-10-15", today)).toBe("active");
    expect(challengeStatus("2026-10-08", "2026-10-14", today)).toBe("ended");
  });

  test("a late joiner counts from the join day, not the start", () => {
    expect(memberFromDate("2026-10-10", "2026-10-13")).toBe("2026-10-13");
    expect(memberFromDate("2026-10-16", "2026-10-13")).toBe("2026-10-16");
    expect(memberFromDate("2026-10-13", "2026-10-13")).toBe("2026-10-13");
  });
});

describe("validateChallengeInput", () => {
  const ok = { goal: "steps", target: 8000, durationDays: 7, startDate: today } as const;

  test("accepts a valid fixed-target challenge", () => {
    expect(validateChallengeInput(ok, today)).toBeNull();
  });

  test("rejects durations other than 7, 14, 30", () => {
    expect(validateChallengeInput({ ...ok, durationDays: 10 }, today)).not.toBeNull();
    expect(validateChallengeInput({ ...ok, durationDays: 14 }, today)).toBeNull();
    expect(validateChallengeInput({ ...ok, durationDays: 30 }, today)).toBeNull();
  });

  test("start must be within today and 14 days ahead", () => {
    expect(validateChallengeInput({ ...ok, startDate: "2026-10-14" }, today)).not.toBeNull();
    expect(validateChallengeInput({ ...ok, startDate: "2026-10-29" }, today)).toBeNull();
    expect(validateChallengeInput({ ...ok, startDate: "2026-10-30" }, today)).not.toBeNull();
  });

  test("fixed goals need a target inside the range and on the step", () => {
    expect(validateChallengeInput({ ...ok, target: null }, today)).not.toBeNull();
    expect(validateChallengeInput({ ...ok, target: 500 }, today)).not.toBeNull();
    expect(validateChallengeInput({ ...ok, target: 8200 }, today)).not.toBeNull();
    expect(validateChallengeInput({ ...ok, goal: "strain", target: 10.5 }, today)).toBeNull();
    expect(validateChallengeInput({ ...ok, goal: "strain", target: 22 }, today)).not.toBeNull();
    expect(validateChallengeInput({ ...ok, goal: "sleep", target: 87 }, today)).not.toBeNull();
    expect(validateChallengeInput({ ...ok, goal: "workouts", target: 2 }, today)).toBeNull();
  });

  test("protein and calories take no host target", () => {
    expect(validateChallengeInput({ ...ok, goal: "protein", target: null }, today)).toBeNull();
    expect(validateChallengeInput({ ...ok, goal: "calories", target: null }, today)).toBeNull();
    expect(validateChallengeInput({ ...ok, goal: "protein", target: 100 }, today)).not.toBeNull();
  });
});

describe("evaluateDay: monotonic goals", () => {
  const facts = (value: number | null): DayFacts => ({ value, basis: "device" });
  const judge = (value: number | null, date: string) =>
    evaluateDay({ goal: "steps", target: 8000, facts: value === null ? undefined : facts(value), date, today }).status;

  test("at or above target is a hit, also today", () => {
    expect(judge(8000, "2026-10-14")).toBe("hit");
    expect(judge(8000, today)).toBe("hit");
  });

  test("below target: past day is a miss, today is still pending", () => {
    expect(judge(7999, "2026-10-14")).toBe("miss");
    expect(judge(7999, today)).toBe("pending");
  });

  test("no data: past day is a miss, today is pending", () => {
    expect(judge(null, "2026-10-14")).toBe("miss");
    expect(judge(null, today)).toBe("pending");
  });

  test("strain and sleep use the same threshold rule", () => {
    const strain = (value: number, date: string) =>
      evaluateDay({ goal: "strain", target: 10, facts: fitnessFacts(value), date, today }).status;
    expect(strain(10, "2026-10-14")).toBe("hit");
    expect(strain(9.5, "2026-10-14")).toBe("miss");
    const sleep = (value: number) =>
      evaluateDay({ goal: "sleep", target: 90, facts: fitnessFacts(value), date: "2026-10-14", today }).status;
    expect(sleep(104)).toBe("hit");
    expect(sleep(89)).toBe("miss");
  });
});

describe("evaluateDay: calories", () => {
  const day = (kcal: number | null, meals: number, date: string) =>
    evaluateDay({
      goal: "calories",
      target: 2000,
      facts: kcal === null ? undefined : { value: kcal, basis: "manual", mealsLogged: meals },
      date,
      today,
    }).status;

  test("a finished day within target and above the floor is a hit", () => {
    expect(day(1800, 3, "2026-10-14")).toBe("hit");
    expect(day(2000, 3, "2026-10-14")).toBe("hit");
    expect(day(1000, 3, "2026-10-14")).toBe("hit");
  });

  test("over target is a miss, also while today is running", () => {
    expect(day(2001, 3, "2026-10-14")).toBe("miss");
    expect(day(2300, 3, today)).toBe("miss");
  });

  test("eating within range today stays pending until the day ends", () => {
    expect(day(1500, 2, today)).toBe("pending");
  });

  test("under half the target is a forgotten log, not a hit", () => {
    expect(day(999, 1, "2026-10-14")).toBe("miss");
  });

  test("nothing logged is never a hit", () => {
    expect(day(null, 0, "2026-10-14")).toBe("miss");
    expect(day(null, 0, today)).toBe("pending");
  });
});

describe("normalising raw rows", () => {
  test("steps rows are device-backed", () => {
    expect(stepsFacts({ steps: 5400 })).toEqual({ value: 5400, basis: "device" });
    expect(stepsFacts(undefined)).toBeUndefined();
  });

  test("food is photo-backed only when every entry came from a scan", () => {
    const base = { kcal: 1800, protein: 90, meals: 3 };
    expect(foodFacts("protein", { ...base, aiMeals: 3 })).toEqual({
      value: 90,
      basis: "photo",
      mealsLogged: 3,
    });
    expect(foodFacts("protein", { ...base, aiMeals: 2 })?.basis).toBe("manual");
    expect(foodFacts("calories", { ...base, aiMeals: 0 })).toEqual({
      value: 1800,
      basis: "manual",
      mealsLogged: 3,
    });
    expect(foodFacts("calories", undefined)).toBeUndefined();
  });

  test("null protein sums count as zero grams", () => {
    expect(foodFacts("protein", { kcal: 300, protein: null, meals: 1, aiMeals: 0 })?.value).toBe(0);
  });

  test("workouts are device-backed only when verified sessions reach the target", () => {
    expect(workoutFacts({ total: 1, verified: 1 }, 1)).toEqual({ value: 1, basis: "device" });
    expect(workoutFacts({ total: 2, verified: 1 }, 2)).toEqual({ value: 2, basis: "manual" });
    expect(workoutFacts({ total: 1, verified: 0 }, 1)).toEqual({ value: 1, basis: "manual" });
    expect(workoutFacts({ total: 0, verified: 0 }, 1)).toBeUndefined();
  });

  test("fitness values pass through, null and missing are no data", () => {
    expect(fitnessFacts(12)).toEqual({ value: 12, basis: "device" });
    expect(fitnessFacts(0)).toEqual({ value: 0, basis: "device" });
    expect(fitnessFacts(null)).toBeUndefined();
    expect(fitnessFacts(undefined)).toBeUndefined();
  });
});

describe("buildProgress", () => {
  const stepFacts = (entries: Record<string, number>) =>
    new Map(Object.entries(entries).map(([date, steps]) => [date, stepsFacts({ steps })!]));

  const progress = (entries: Record<string, number>, fromDate = "2026-10-09", endDate = "2026-10-15") =>
    buildProgress({
      goal: "steps",
      target: 8000,
      fromDate,
      endDate,
      today,
      factsByDate: stepFacts(entries),
    });

  test("counts hits and misses, streak ending today", () => {
    const p = progress({
      "2026-10-09": 9000,
      "2026-10-10": 2000,
      "2026-10-11": 8000,
      "2026-10-12": 8500,
      "2026-10-13": 9000,
      "2026-10-14": 10000,
      "2026-10-15": 8100,
    });
    expect(p.hitDays).toBe(6);
    expect(p.missDays).toBe(1);
    expect(p.totalDays).toBe(7);
    expect(p.streak).toBe(5);
    expect(p.bestStreak).toBe(5);
    expect(p.days).toHaveLength(7);
  });

  test("a pending today keeps the streak from yesterday", () => {
    const p = progress({ "2026-10-13": 9000, "2026-10-14": 9000, "2026-10-15": 100 }, "2026-10-13", "2026-10-19");
    expect(p.days.at(-1)?.status).toBe("pending");
    expect(p.streak).toBe(2);
    expect(p.missDays).toBe(0);
    expect(p.totalDays).toBe(7);
  });

  test("a missed yesterday zeroes the current streak but not the best", () => {
    const p = progress({
      "2026-10-11": 9000,
      "2026-10-12": 9000,
      "2026-10-13": 9000,
      "2026-10-14": 1000,
      "2026-10-15": 9000,
    }, "2026-10-11", "2026-10-17");
    expect(p.bestStreak).toBe(3);
    expect(p.streak).toBe(1);
  });

  test("days after the end or before today are not judged ahead of time", () => {
    const p = progress({}, "2026-10-01", "2026-10-07");
    expect(p.days).toHaveLength(7);
    expect(p.hitDays).toBe(0);
    expect(p.missDays).toBe(7);
    expect(p.streak).toBe(0);
  });

  test("future-start span has no judged days", () => {
    const p = progress({}, "2026-10-17", "2026-10-23");
    expect(p.days).toHaveLength(0);
    expect(p.totalDays).toBe(7);
  });

  test("hits are split by backing", () => {
    const facts = new Map<string, DayFacts>([
      ["2026-10-13", { value: 1, basis: "device" }],
      ["2026-10-14", { value: 1, basis: "manual" }],
    ]);
    const p = buildProgress({
      goal: "workouts",
      target: 1,
      fromDate: "2026-10-13",
      endDate: "2026-10-19",
      today,
      factsByDate: facts,
    });
    expect(p.hitsByBasis).toEqual({ device: 1, photo: 0, manual: 1 });
  });
});

describe("ranking", () => {
  const key = (hitDays: number, streak: number, bestStreak: number) => ({ hitDays, streak, bestStreak });

  test("more hit days first, then streak, then best streak", () => {
    const sorted = [key(5, 1, 3), key(5, 4, 4), key(7, 0, 2), key(5, 4, 5)].sort(compareRank);
    expect(sorted).toEqual([key(7, 0, 2), key(5, 4, 5), key(5, 4, 4), key(5, 1, 3)]);
  });

  test("ties share a place and the next place is skipped", () => {
    const sorted = [key(6, 2, 4), key(6, 2, 4), key(3, 0, 1), key(0, 0, 0)];
    expect(assignRanks(sorted)).toEqual([1, 1, 3, 4]);
  });

  test("a single participant is rank 1, empty is empty", () => {
    expect(assignRanks([key(0, 0, 0)])).toEqual([1]);
    expect(assignRanks([])).toEqual([]);
  });
});

describe("verificationLabel", () => {
  test("says how the hit days were recorded and never hides manual entries", () => {
    expect(verificationLabel({ device: 0, photo: 0, manual: 0 })).toBeNull();
    expect(verificationLabel({ device: 4, photo: 0, manual: 0 })).toBe("Terverifikasi perangkat");
    expect(verificationLabel({ device: 0, photo: 3, manual: 0 })).toBe("Dari scan foto");
    expect(verificationLabel({ device: 0, photo: 0, manual: 2 })).toBe("Dicatat manual");
    expect(verificationLabel({ device: 4, photo: 0, manual: 1 })).toBe("Sebagian dicatat manual");
    expect(verificationLabel({ device: 0, photo: 2, manual: 1 })).toBe("Sebagian dicatat manual");
    expect(verificationLabel({ device: 2, photo: 1, manual: 0 })).toBe("Perangkat dan scan foto");
  });
});

describe("copy", () => {
  test("describeGoal reads naturally in Indonesian", () => {
    expect(describeGoal("steps", 10000)).toBe("Minimal 10.000 langkah per hari");
    expect(describeGoal("workouts", 2)).toBe("Catat minimal 2 sesi latihan per hari");
    expect(describeGoal("sleep", 85)).toBe("Tidur JoyoFit minimal 85% per hari");
    expect(describeGoal("strain", 10.5)).toBe("Strain JoyoFit minimal 10,5 per hari");
  });

  test("default titles carry the target and duration", () => {
    expect(defaultChallengeTitle("steps", 10000, 7)).toBe("10.000 langkah, 7 hari");
    expect(defaultChallengeTitle("calories", null, 30)).toBe("Kalori sesuai target, 30 hari");
  });

  test("English wording and number format", () => {
    expect(describeGoal("steps", 10000, "en")).toBe("At least 10,000 steps a day");
    expect(defaultChallengeTitle("steps", 10000, 7, "en")).toBe("10,000 steps, 7 days");
    expect(verificationLabel({ device: 4, photo: 0, manual: 1 }, "en")).toBe(
      "Partly logged manually",
    );
    expect(
      validateChallengeInput(
        { goal: "steps", target: 500, durationDays: 7, startDate: "2026-10-15" },
        "2026-10-15",
        "en",
      ),
    ).toBe("The daily steps target must be between 2,000 and 30,000.");
    const text = challengeShareText(
      {
        title: "10,000 steps, 7 days",
        goal: "steps",
        target: 10000,
        durationDays: 7,
        status: "ended",
        hitDays: 5,
        judgedDays: 7,
        streak: 3,
        bestStreak: 4,
        rank: 1,
        participants: 6,
        hitsByBasis: { device: 5, photo: 0, manual: 0 },
      },
      "en",
    );
    expect(text).toBe(
      "Finished a 7-day challenge: 10,000 steps, 7 days. Goal hit on 5 of 7 days. Rank 1 of 6. Best streak 4 days. Data: verified by device. Join me on JoyoRogo.",
    );
  });

  test("share text states real numbers and has no em dash", () => {
    const text = challengeShareText({
      title: "10.000 langkah, 7 hari",
      goal: "steps",
      target: 10000,
      durationDays: 7,
      status: "ended",
      hitDays: 5,
      judgedDays: 7,
      streak: 3,
      bestStreak: 4,
      rank: 1,
      participants: 6,
      hitsByBasis: { device: 5, photo: 0, manual: 0 },
    });
    expect(text).toContain("Data: terverifikasi perangkat.");
    expect(text).toContain("5 dari 7 hari");
    expect(text).toContain("Peringkat 1 dari 6");
    expect(text).toContain("Streak terbaik 4 hari");
    expect(text).not.toContain("\u2014");
  });

  test("share text omits rank for a solo challenge and score before it starts", () => {
    const upcoming = challengeShareText({
      title: "t",
      goal: "steps",
      target: 8000,
      durationDays: 14,
      status: "upcoming",
      hitDays: 0,
      judgedDays: 0,
      streak: 0,
      bestStreak: 0,
      rank: 1,
      participants: 1,
      hitsByBasis: { device: 0, photo: 0, manual: 0 },
    });
    expect(upcoming).not.toContain("Peringkat");
    expect(upcoming).not.toContain("hari target tercapai");
  });
});
