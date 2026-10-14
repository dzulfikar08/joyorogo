import { describe, expect, test } from "bun:test";

import { EXERCISE_MAX_KCAL, burnRate, kcalForDuration } from "./exercise-edit";

describe("burnRate", () => {
  test("kcal per minute of the logged row", () => {
    expect(burnRate(300, 30)).toBe(10);
    expect(burnRate(0, 30)).toBe(0);
  });

  test("null without a usable duration or kcal", () => {
    expect(burnRate(300, null)).toBeNull();
    expect(burnRate(300, undefined)).toBeNull();
    expect(burnRate(300, 0)).toBeNull();
    expect(burnRate(-5, 30)).toBeNull();
    expect(burnRate(Number.NaN, 30)).toBeNull();
  });
});

describe("kcalForDuration", () => {
  test("scales proportionally and rounds to a whole number", () => {
    const rate = burnRate(300, 30)!;
    expect(kcalForDuration(rate, 45)).toBe(450);
    expect(kcalForDuration(rate, 15)).toBe(150);
    expect(kcalForDuration(burnRate(100, 30)!, 20)).toBe(67);
  });

  test("a zero rate stays at zero", () => {
    expect(kcalForDuration(0, 90)).toBe(0);
  });

  test("never exceeds the row limit", () => {
    expect(kcalForDuration(100, 1440)).toBe(EXERCISE_MAX_KCAL);
  });
});
