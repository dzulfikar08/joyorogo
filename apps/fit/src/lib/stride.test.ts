import { describe, expect, test } from "bun:test";

import { plausibleStepLength, stepLengthFromSpeed, stepLengthSeries } from "./stride";

describe("stepLengthFromSpeed", () => {
  test("is speed over steps per second", () => {
    // 3 m/s at 180 steps per minute (3 steps per second): one metre per step.
    expect(stepLengthFromSpeed(3, 180)).toBeCloseTo(1, 6);
  });

  test("is null while standing, without a cadence, or outside the human range", () => {
    expect(stepLengthFromSpeed(0.3, 170)).toBeNull();
    expect(stepLengthFromSpeed(3, null)).toBeNull();
    expect(stepLengthFromSpeed(null, 170)).toBeNull();
    expect(stepLengthFromSpeed(3, 20)).toBeNull();
    expect(stepLengthFromSpeed(12, 100)).toBeNull();
  });
});

describe("plausibleStepLength", () => {
  test("keeps a step length of a person, drops anything else", () => {
    expect(plausibleStepLength(0.95)).toBe(0.95);
    expect(plausibleStepLength(0.05)).toBeNull();
    expect(plausibleStepLength(9)).toBeNull();
    expect(plausibleStepLength(null)).toBeNull();
  });
});

describe("stepLengthSeries", () => {
  test("derives from pace and cadence, a gap stays a gap", () => {
    // 333.3 s/km is 3 m/s.
    const series = stepLengthSeries({ pace: [1000 / 3, null, 1000 / 3], cad: [180, 180, null] }, 3);
    expect(series?.[0]).toBeCloseTo(1, 3);
    expect(series?.[1]).toBeNull();
    expect(series?.[2]).toBeNull();
  });

  test("a measured series wins as a whole", () => {
    const series = stepLengthSeries({ pace: [300, 300], cad: [170, 170], stride: [0.8, null] }, 2);
    expect(series).toEqual([0.8, null]);
  });

  test("is null when no sample has one", () => {
    expect(stepLengthSeries({ pace: null, cad: [170, 170] }, 2)).toBeNull();
  });
});
