import { describe, expect, test } from "bun:test";

import type { CalibrationInfo } from "@joyorogo/api/lib/calibration";

import { calibrationChip } from "./calibration-chip";

const base: CalibrationInfo = {
  enabled: true,
  status: "collecting",
  loggedDays: 5,
  loggedDaysNeeded: 20,
  spanDays: 3,
  spanDaysNeeded: 21,
  weighIns: 2,
  weighInsNeeded: 6,
  windowDays: 28,
  anchorDate: "2026-10-19",
  nextDate: "2026-10-26",
  formulaKcal: 2200,
  measuredKcal: null,
  usedKcal: null,
  clamped: false,
  avgWorkoutKcal: null,
};

describe("calibrationChip", () => {
  test("counts the longest gate, not the sum", () => {
    expect(calibrationChip(base)).toEqual({ kind: "days", days: 18 });
    expect(calibrationChip({ ...base, loggedDays: 20, spanDays: 21, weighIns: 4 })).toEqual({
      kind: "days",
      days: 2,
    });
  });

  test("never promises zero days while a gate is still open", () => {
    expect(calibrationChip({ ...base, loggedDays: 20, spanDays: 21, weighIns: 6 })).toEqual({
      kind: "days",
      days: 1,
    });
  });

  test("without a weigh-in in the window there is no count to give", () => {
    expect(calibrationChip({ ...base, weighIns: 0, spanDays: 0 })).toEqual({ kind: "weigh" });
  });

  test("data ready but the Monday measurement has not run: names the date", () => {
    expect(calibrationChip({ ...base, status: "waiting" })).toEqual({
      kind: "waiting",
      date: "2026-10-26",
    });
  });

  test("hidden when active, off, manual, or unknown", () => {
    for (const status of ["active", "off", "manual"] as const) {
      expect(calibrationChip({ ...base, status })).toBeNull();
    }
    expect(calibrationChip(null)).toBeNull();
    expect(calibrationChip(undefined)).toBeNull();
  });
});
