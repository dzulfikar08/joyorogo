import { describe, expect, test } from "bun:test";

import { garminWorkoutType, humanTypeKey, netKcal, parseActivities, parseDailySummaries, parseWeighIns } from "./garmin-parse";

// Trimmed from a real account's `activities/search/activities` answer: only the fields the parser reads.
const ACTIVITIES = [
  { activityId: 23552790294, activityType: { typeKey: "walking" }, startTimeLocal: "2026-07-11 06:50:57", startTimeGMT: "2026-07-10 23:50:57", duration: 1487.373046875, calories: 145.0, bmrCalories: 41.0, averageHR: 115.0, distance: 1645.89 },
  { activityId: 23334844070, activityType: { typeKey: "treadmill_running" }, startTimeLocal: "2026-06-22 09:38:26", startTimeGMT: "2026-06-22 02:38:26", duration: 1420.119, calories: 228.0, bmrCalories: 40.0, averageHR: 130.0, distance: 362.23 },
  { activityId: 23228584840, activityType: { typeKey: "lap_swimming" }, startTimeLocal: "2026-06-07 16:11:37", startTimeGMT: "2026-06-07 09:11:37", duration: 2596.509, calories: 434.0, bmrCalories: 71.0, averageHR: 125.0, distance: 280.0 },
  { activityId: 21787853072, activityType: { typeKey: "paddelball" }, startTimeLocal: "2026-02-07 07:13:42", startTimeGMT: "2026-02-07 00:13:42", duration: 2410.828, calories: 387.0, bmrCalories: 46.0, averageHR: 151.0, distance: 100.14 },
  { activityId: 19873479271, activityType: { typeKey: "strength_training" }, startTimeLocal: "2025-07-28 19:46:24", startTimeGMT: "2025-07-28 12:46:24", duration: 713.77, calories: 65.0, bmrCalories: 19.0, averageHR: 110.0, distance: 0.0 },
  // Some activities come without bmrCalories.
  { activityId: 19991165516, activityType: { typeKey: "street_running" }, startTimeLocal: "2025-08-08 17:48:46", startTimeGMT: "2025-08-08 10:48:46", duration: 2668.0, calories: 569.0, bmrCalories: null },
];

describe("parseActivities", () => {
  test("reads id, type, the watch's own day, duration and both calorie figures", () => {
    const { activities, unparsed } = parseActivities(ACTIVITIES);
    expect(unparsed).toBe(0);
    expect(activities).toHaveLength(6);
    expect(activities[0]).toEqual({
      id: "23552790294",
      typeKey: "walking",
      type: "Walk",
      date: "2026-07-11",
      startedAt: "2026-07-10 23:50:57",
      durationSec: 1487.373046875,
      grossKcal: 145,
      restingKcal: 41,
    });
    expect(activities[5]!.restingKcal).toBeNull();
  });

  test("the day is the local start time, not the UTC one", () => {
    const [walk] = parseActivities(ACTIVITIES).activities;
    expect(walk!.startedAt!.slice(0, 10)).toBe("2026-07-10");
    expect(walk!.date).toBe("2026-07-11");
  });

  test("records that cannot be read are counted and skipped", () => {
    const bad = [
      null,
      "x",
      { activityType: { typeKey: "walking" }, startTimeLocal: "2026-07-11 06:00:00", duration: 600 },
      { activityId: 1, activityType: { typeKey: "walking" }, startTimeLocal: "soon", duration: 600 },
      { activityId: 2, activityType: { typeKey: "walking" }, startTimeLocal: "2026-07-11 06:00:00", duration: 0 },
      { activityId: 3, startTimeLocal: "2026-07-11 06:00:00", duration: 600 },
      ACTIVITIES[0],
    ];
    const { activities, unparsed } = parseActivities(bad);
    expect(activities.map((a) => a.id)).toEqual(["23552790294"]);
    expect(unparsed).toBe(6);
  });

  test("anything but an array is an empty list", () => {
    expect(parseActivities(null)).toEqual({ activities: [], unparsed: 0 });
    expect(parseActivities({ data: [] })).toEqual({ activities: [], unparsed: 0 });
  });
});

describe("garminWorkoutType", () => {
  test("maps Garmin type keys to the diary's vocabulary", () => {
    const expected: Record<string, string> = {
      walking: "Walk",
      hiking: "Hike",
      running: "Run",
      street_running: "Run",
      treadmill_running: "Treadmill",
      trail_running: "TrailRun",
      cycling: "Ride",
      indoor_cycling: "Ride",
      mountain_biking: "Ride",
      virtual_ride: "VirtualRide",
      lap_swimming: "Swim",
      open_water_swimming: "Swim",
      strength_training: "WeightTraining",
      yoga: "Yoga",
      badminton: "Badminton",
    };
    for (const [key, type] of Object.entries(expected)) expect([key, garminWorkoutType(key)]).toEqual([key, type]);
  });

  test("a type nobody mapped is OtherWorkout, named after its key", () => {
    expect(garminWorkoutType("paddelball")).toBe("OtherWorkout");
    expect(humanTypeKey("paddelball")).toBe("Paddelball");
    expect(humanTypeKey("hiit_cardio")).toBe("Hiit cardio");
  });
});

describe("netKcal", () => {
  test("Garmin's calories include the resting energy: the diary gets the difference", () => {
    expect(netKcal(145, 41, 99)).toBe(104);
    expect(netKcal(734.9, 191, 0)).toBeCloseTo(543.9, 5);
  });

  test("without bmrCalories the resting estimate is subtracted", () => {
    expect(netKcal(569, null, 78.5)).toBeCloseTo(490.5, 5);
  });

  test("never negative; no calories at all is null (the caller estimates)", () => {
    expect(netKcal(30, 41, 0)).toBe(0);
    expect(netKcal(null, 41, 10)).toBeNull();
    expect(netKcal(0, 0, 10)).toBeNull();
  });
});

describe("parseWeighIns", () => {
  const body = {
    dailyWeightSummaries: [
      { summaryDate: "2026-07-01", numOfWeightEntries: 1, latestWeight: { calendarDate: "2026-07-01", weight: 72500.0, bodyFat: null, bodyWater: null, boneMass: null, sourceType: "MANUAL" } },
      { summaryDate: "2026-06-23", latestWeight: { calendarDate: "2026-06-23", weight: 72799.99, bodyFat: 21.4, bodyWater: 55.1, boneMass: 3100, sourceType: "INDEX_SCALE" } },
    ],
    totalAverage: { weight: null },
    previousDateWeight: null,
  };

  test("grams become kilograms; body composition is read when present", () => {
    const { entries, unparsed } = parseWeighIns(body);
    expect(unparsed).toBe(0);
    expect(entries).toEqual([
      { date: "2026-07-01", weightKg: 72.5 },
      { date: "2026-06-23", weightKg: 72.8, bodyFatPct: 21.4, waterPct: 55.1, boneKg: 3.1 },
    ]);
  });

  test("an unreadable weight skips the entry, an out-of-range composition value only itself", () => {
    const { entries, unparsed } = parseWeighIns({
      dailyWeightSummaries: [
        { summaryDate: "2026-07-02", latestWeight: { calendarDate: "2026-07-02", weight: null } },
        { summaryDate: "2026-07-03", latestWeight: { calendarDate: "2026-07-03", weight: 5000 } },
        { summaryDate: "2026-07-04", latestWeight: { calendarDate: "2026-07-04", weight: 70000, bodyFat: 400, boneMass: 3000 } },
        { summaryDate: "2026-07-05" },
      ],
    });
    expect(entries).toEqual([{ date: "2026-07-04", weightKg: 70, boneKg: 3 }]);
    expect(unparsed).toBe(3);
  });

  test("an empty range", () => {
    expect(parseWeighIns({ dailyWeightSummaries: [], previousDateWeight: { weight: 105500 } })).toEqual({ entries: [], unparsed: 0 });
  });
});

describe("parseDailySummaries", () => {
  const day = (calendarDate: string, steps: number, extra: Record<string, unknown> = {}) => ({
    calendarDate,
    source: "garmin",
    includesWellnessData: true,
    movement: { steps: { goal: 7000, value: steps, distanceInMeters: steps * 0.75 } },
    calories: { burnedResting: 2396, burnedActive: 148, burnedTotal: 2544 },
    intensityMinutes: { goal: 150, moderate: 4, vigorous: 3 },
    ...extra,
  });

  test("steps, distance, active calories and intensity minutes (moderate + vigorous)", () => {
    const { days, unparsed } = parseDailySummaries({ data: [day("2026-07-06", 2363)] });
    expect(unparsed).toBe(0);
    expect(days).toEqual([{ date: "2026-07-06", steps: 2363, distanceMeters: 1772.25, activeCalories: 148, exerciseMinutes: 7 }]);
  });

  test("a day without wellness data or without steps is no reading; a record without a date is unparsed", () => {
    const { days, unparsed } = parseDailySummaries({
      data: [day("2026-07-07", 0), day("2026-07-08", 500, { includesWellnessData: false }), day("2026-07-09", 900), { steps: 1 }],
    });
    expect(days.map((d) => d.date)).toEqual(["2026-07-09"]);
    expect(unparsed).toBe(1);
  });

  test("values stay inside what daily_activity takes", () => {
    const { days } = parseDailySummaries({ data: [day("2026-07-10", 999_999, { calories: { burnedActive: 90_000 }, intensityMinutes: { moderate: 2000, vigorous: 5 } })] });
    expect(days[0]).toMatchObject({ steps: 300_000, activeCalories: 20_000, exerciseMinutes: 1440 });
  });
});
