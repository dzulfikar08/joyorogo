import { describe, expect, test } from "bun:test";

import { parseHealthLastSync } from "./health-last-sync";

describe("parseHealthLastSync", () => {
  test("reads what recordHealthSync writes", () => {
    const stored = JSON.stringify({
      at: 1,
      workoutsImported: 2,
      workoutsSkipped: 0,
      activityDays: 7,
      sleepNights: 6,
    });
    expect(parseHealthLastSync(stored)).toEqual({
      at: 1,
      workoutsImported: 2,
      workoutsSkipped: 0,
      activityDays: 7,
      sleepNights: 6,
    });
  });

  test("anything damaged or incomplete is no record", () => {
    expect(parseHealthLastSync(null)).toBeNull();
    expect(parseHealthLastSync("not json")).toBeNull();
    expect(parseHealthLastSync("[]")).toBeNull();
    expect(parseHealthLastSync(JSON.stringify({ at: 1 }))).toBeNull();
    expect(
      parseHealthLastSync(
        JSON.stringify({
          at: "x",
          workoutsImported: 0,
          workoutsSkipped: 0,
          activityDays: 0,
          sleepNights: 0,
        }),
      ),
    ).toBeNull();
  });
});
