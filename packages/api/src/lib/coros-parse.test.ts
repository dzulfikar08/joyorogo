import { describe, expect, test } from "bun:test";

import { corosWorkoutType, parseActivityDetail, parseDuration, parseSportRecords } from "./coros-parse";

// The documented sample outputs: https://github.com/coroslab/COROS-MCP/blob/main/docs/en/tools.md
const SPORT_RECORDS = `Sport Records — 2026-09-19 to 2026-10-18 (1 records)

1. Sport(9807) — 2026-10-03
   Duration: 2:12:38 | Distance: 12.03 km
   Average Pace: 11:01 /km`;

const ACTIVITY_DETAIL = `Sport(9807) Activity Details

Workout Time: 2:12:38
Distance: 12.03 km
Average Pace: 11:01 /km
Average Heart Rate: 76 bpm
Calories: 372 kcal`;

describe("parseDuration", () => {
  test.each([
    ["2:12:38", 7958],
    ["45:10", 2710],
    ["1h 20min 5s", 4805],
    ["90 min", 5400],
    ["5400", 5400],
  ])("%s", (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });
  test("not a duration", () => {
    expect(parseDuration("n/a")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

describe("parseSportRecords", () => {
  test("the documented sample", () => {
    const { activities, unparsed } = parseSportRecords({ text: SPORT_RECORDS });
    expect(unparsed).toBe(0);
    expect(activities).toEqual([
      { labelId: null, sportType: 9807, date: "2026-10-03", name: null, startedAt: null, durationSec: 7958 },
    ]);
  });

  test("several records, an identifier and a start time when the list carries them", () => {
    const text = `Sport Records — 2026-10-01 to 2026-10-04 (3 records)

1. Sport(100) — 2026-10-04
   Duration: 45:10 | Distance: 8.20 km
   Label ID: 4811223344556677 | Start: 2026-10-04 06:15:00
2. Sport(200) — 2026-10-02
   Duration: 1:30:00 | Distance: 40.00 km
   labelId: 99887766
3. Sport(100) — 2026-10-01
   Distance: 5 km`;
    const { activities, unparsed } = parseSportRecords({ text });
    expect(unparsed).toBe(1);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({ labelId: "4811223344556677", sportType: 100, date: "2026-10-04", durationSec: 2710, startedAt: "2026-10-04 06:15:00" });
    expect(activities[1]).toMatchObject({ labelId: "99887766", sportType: 200, durationSec: 5400 });
  });

  test("a title COROS named becomes the name", () => {
    const { activities } = parseSportRecords({ text: "1. Trail Run(102) — 2026-10-03\n   Duration: 1:00:00" });
    expect(activities[0]).toMatchObject({ sportType: 102, name: "Trail Run" });
  });

  test("structuredContent wins over the text", () => {
    const { activities } = parseSportRecords({
      text: "ignored",
      structured: { records: [{ labelId: 123, sportType: 100, date: "20261003", totalTime: 1800 }, { nonsense: true }] },
    });
    expect(activities).toEqual([{ labelId: "123", sportType: 100, date: "2026-10-03", name: null, startedAt: null, durationSec: 1800 }]);
  });

  test("a JSON text body is read like structured content", () => {
    const text = JSON.stringify([{ id: "a1", sport: 2, happenDay: 20261005, duration: "30:00", name: "Morning ride" }]);
    const { activities, unparsed } = parseSportRecords({ text });
    expect(unparsed).toBe(0);
    expect(activities[0]).toMatchObject({ labelId: "a1", sportType: 2, date: "2026-10-05", durationSec: 1800, name: "Morning ride" });
  });

  test("garbage and empty answers never throw", () => {
    expect(parseSportRecords({ text: "" })).toEqual({ activities: [], unparsed: 0 });
    expect(parseSportRecords({ text: "No records found." })).toEqual({ activities: [], unparsed: 0 });
    expect(parseSportRecords({ text: "{not json" }).activities).toEqual([]);
  });
});

describe("parseActivityDetail", () => {
  test("the documented sample", () => {
    expect(parseActivityDetail({ text: ACTIVITY_DETAIL })).toEqual({ calories: 372, avgHeartRate: 76, durationSec: 7958 });
  });

  test("thousands separator and a missing calories line", () => {
    expect(parseActivityDetail({ text: "Calories: 1,204 kcal" }).calories).toBe(1204);
    expect(parseActivityDetail({ text: "Workout Time: 10:00\nDistance: 1 km" }).calories).toBeNull();
  });

  test("JSON detail", () => {
    expect(parseActivityDetail({ text: "", structured: { summary: { calories: 410, avgHr: 150, totalTime: 3000 } } })).toEqual({
      calories: 410,
      avgHeartRate: 150,
      durationSec: 3000,
    });
  });

  test("zero calories mean unknown", () => {
    expect(parseActivityDetail({ text: "Calories: 0 kcal" }).calories).toBeNull();
  });
});

describe("corosWorkoutType", () => {
  test("known codes map to the diary vocabulary, the rest is a generic workout", () => {
    expect(corosWorkoutType(100)).toBe("Run");
    expect(corosWorkoutType(101)).toBe("Treadmill");
    expect(corosWorkoutType(102)).toBe("TrailRun");
    expect(corosWorkoutType(200)).toBe("Ride");
    expect(corosWorkoutType(300)).toBe("Swim");
    expect(corosWorkoutType(402)).toBe("WeightTraining");
    expect(corosWorkoutType(900)).toBe("Walk");
    expect(corosWorkoutType(9807)).toBe("OtherWorkout");
  });
});
