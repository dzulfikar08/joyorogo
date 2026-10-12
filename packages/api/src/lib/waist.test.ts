import { describe, expect, test } from "bun:test";

import { assessWaist } from "./waist";

describe("assessWaist", () => {
  test("sex-specific cut-off is inclusive", () => {
    expect(assessWaist(89.9, "male", null).overCutoff).toBe(false);
    expect(assessWaist(90, "male", null).overCutoff).toBe(true);
    expect(assessWaist(79.9, "female", null).overCutoff).toBe(false);
    expect(assessWaist(80, "female", null).overCutoff).toBe(true);
  });

  test("waist-to-height bands at 0.5 and 0.6", () => {
    expect(assessWaist(84.9, "male", 170).band).toBe("ok");
    expect(assessWaist(85, "male", 170).band).toBe("raised");
    expect(assessWaist(101.9, "male", 170).band).toBe("raised");
    expect(assessWaist(102, "male", 170).band).toBe("high");
  });

  test("ratio and half height are reported; no height gives nulls", () => {
    const a = assessWaist(80, "female", 157);
    expect(a.ratio).toBe(0.51);
    expect(a.halfHeightCm).toBe(78.5);
    expect(assessWaist(80, "female", null)).toEqual({
      cutoffCm: 80,
      overCutoff: true,
      ratio: null,
      band: null,
      halfHeightCm: null,
    });
  });
});
