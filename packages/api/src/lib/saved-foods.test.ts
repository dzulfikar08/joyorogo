import { describe, expect, test } from "bun:test";

import { carriesMoreNutrition, moveId } from "./saved-foods";
import type { SavedItem } from "./saved-foods";

const item = (over: Partial<SavedItem> = {}): SavedItem => ({
  name: "Bubur",
  grams: null,
  kcal: 300,
  protein: null,
  carbs: null,
  fat: null,
  fiber: null,
  scanId: null,
  photoId: null,
  ...over,
});

describe("carriesMoreNutrition", () => {
  test("a row that was filled in later replaces the macro-less favorite", () => {
    expect(carriesMoreNutrition([item({ protein: 9, carbs: 40, fat: 5 })], [item()])).toBe(true);
  });
  test("never the other way, nor for equal content", () => {
    expect(carriesMoreNutrition([item()], [item({ protein: 9, carbs: 40, fat: 5 })])).toBe(false);
    expect(carriesMoreNutrition([item({ protein: 9 })], [item({ protein: 9 })])).toBe(false);
  });
  test("a mix that loses a value anywhere is not richer, and component counts must match", () => {
    expect(carriesMoreNutrition([item({ protein: 9, fat: 1 }), item()], [item({ carbs: 3 }), item({ fat: 1 })])).toBe(false);
    expect(carriesMoreNutrition([item({ protein: 9 }), item()], [item()])).toBe(false);
    expect(carriesMoreNutrition([], [])).toBe(false);
  });
});

describe("moveId", () => {
  test("one place up or down; the ends and unknown ids stay as they are", () => {
    const ids = ["a", "b", "c"];
    expect(moveId(ids, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(ids, "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveId(ids, "a", -1)).toEqual(ids);
    expect(moveId(ids, "c", 1)).toEqual(ids);
    expect(moveId(ids, "x", 1)).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
