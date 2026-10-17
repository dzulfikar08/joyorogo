import { describe, expect, test } from "bun:test";

import { rescaleForGrams, resolvePortion } from "./portion";
import type { PortionValues } from "./portion";

// 200 g of nasi goreng as logged.
const NASI: PortionValues = { grams: 200, kcal: 300, protein: 8, carbs: 45, fat: 9, fiber: 2 };

describe("rescaleForGrams", () => {
  test("kcal and macros follow the weight: 99 g of a 200 g / 300 kcal row", () => {
    expect(rescaleForGrams(NASI, 99)).toEqual({
      grams: 99,
      kcal: 149, // 148.5 rounds up
      protein: 4,
      carbs: 22.3, // 22.275
      fat: 4.5, // 4.455
      fiber: 1,
    });
  });

  test("scales up and rounds kcal to whole numbers, macros to one decimal", () => {
    expect(rescaleForGrams(NASI, 333)).toEqual({
      grams: 333,
      kcal: 500, // 499.5
      protein: 13.3,
      carbs: 74.9, // 74.925
      fat: 15, // 14.985
      fiber: 3.3,
    });
  });

  test("an explicitly edited kcal wins for kcal only; macros still follow the weight", () => {
    const next = rescaleForGrams(NASI, 100, ["kcal"]);
    expect(next.kcal).toBe(300);
    expect(next.grams).toBe(100);
    expect(next.protein).toBe(4);
    expect(next.carbs).toBe(22.5);
  });

  test("an explicitly edited macro wins for that field only (Set or array)", () => {
    const fromSet = rescaleForGrams(NASI, 100, new Set(["protein"] as const));
    expect(fromSet).toEqual({ grams: 100, kcal: 150, protein: 8, carbs: 22.5, fat: 4.5, fiber: 1 });
    expect(rescaleForGrams(NASI, 100, ["protein", "fiber"])).toMatchObject({ protein: 8, fiber: 2, kcal: 150 });
  });

  test("null macros stay null", () => {
    const next = rescaleForGrams({ grams: 100, kcal: 200, protein: null, carbs: null, fat: null, fiber: null }, 50);
    expect(next).toEqual({ grams: 50, kcal: 100, protein: null, carbs: null, fat: null, fiber: null });
  });

  test("missing or zero old weight: only the grams change", () => {
    expect(rescaleForGrams({ ...NASI, grams: null }, 99)).toEqual({ ...NASI, grams: 99 });
    expect(rescaleForGrams({ ...NASI, grams: 0 }, 99)).toEqual({ ...NASI, grams: 99 });
  });

  test("invalid new weight changes nothing", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rescaleForGrams(NASI, bad)).toEqual(NASI);
    }
  });

  test("does not mutate prev and clamps to the caps", () => {
    const frozen = Object.freeze({ ...NASI });
    expect(rescaleForGrams(frozen, 10_000)).toMatchObject({ grams: 5000, kcal: 5000, protein: 400, carbs: 500 });
  });
});

describe("resolvePortion", () => {
  test("grams only rescales kcal and macros", () => {
    expect(resolvePortion(NASI, { grams: 99 })).toEqual({
      grams: 99,
      kcal: 149,
      protein: 4,
      carbs: 22.3,
      fat: 4.5,
      fiber: 1,
    });
  });

  test("grams + typed kcal: kcal as typed, macros follow kcal", () => {
    expect(resolvePortion(NASI, { grams: 99, kcal: 150 })).toMatchObject({ grams: 99, kcal: 150, protein: 4 });
  });

  test("grams + typed macro: the macro wins, the rest follow the weight", () => {
    expect(resolvePortion(NASI, { grams: 100, carbs: 40 })).toEqual({
      grams: 100,
      kcal: 150,
      protein: 4,
      carbs: 40,
      fat: 4.5,
      fiber: 1,
    });
  });

  test("grams on a row without a stored weight keeps the kcal", () => {
    expect(resolvePortion({ ...NASI, grams: null }, { grams: 99 })).toEqual({ ...NASI, grams: 99 });
  });
});
