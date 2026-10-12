import { describe, expect, test } from "bun:test";

import { estimateKcal, metByKey, metForStravaType } from "./met";

describe("metByKey", () => {
  test("known keys map to their MET", () => {
    expect(metByKey("lari")).toBe(9.8);
    expect(metByKey("yoga")).toBe(2.5);
  });

  test("unknown key falls back to default", () => {
    expect(metByKey("panjat")).toBe(6.0);
  });
});

describe("metForStravaType", () => {
  test("maps common Strava types", () => {
    expect(metForStravaType("Run")).toBe(9.8);
    expect(metForStravaType("Ride")).toBe(6.8);
    expect(metForStravaType("WeightTraining")).toBe(5.0);
  });

  test("unmapped Strava type uses default", () => {
    expect(metForStravaType("Surf")).toBe(6.0);
  });
});

describe("estimateKcal", () => {
  test("70 kg runner, 30 min at MET 9.8", () => {
    // kcal = MET x 3.5 x kg x min / 200
    expect(estimateKcal(9.8, 70, 30)).toBe(Math.round((9.8 * 3.5 * 70 * 30) / 200));
  });
  test("scales linearly with duration", () => {
    expect(estimateKcal(5, 80, 40)).toBe(estimateKcal(5, 80, 20) * 2);
  });
});
