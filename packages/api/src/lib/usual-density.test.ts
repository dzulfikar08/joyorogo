import { describe, expect, test } from "bun:test";

import { buildUsualMap, withUsualDensity } from "./usual-density";
import type { UsualRow } from "./usual-density";

const row = (over: Partial<UsualRow> & { name: string }): UsualRow => ({
  grams: 100,
  kcal: 52,
  protein: null,
  carbs: null,
  fat: null,
  fiber: null,
  ...over,
});

describe("buildUsualMap: the newest matching row decides", () => {
  test("same normalised name, newest first; rows without weight or kcal never count", () => {
    const map = buildUsualMap([
      row({ name: "Putih Telur", grams: 100, kcal: 52 }),
      row({ name: "putih telur!", grams: 100, kcal: 104 }),
      row({ name: "putih telur", grams: null, kcal: 40 }),
      row({ name: "putih telur", grams: 100, kcal: 0 }),
    ]);
    expect(map.get("putih telur")).toMatchObject({ kcalPerGram: 0.52, n: 2 });
  });
});

describe("withUsualDensity", () => {
  const usual = buildUsualMap([
    row({ name: "nasi putih", grams: 100, kcal: 195, protein: 3.5, carbs: 42, fat: 0.4, fiber: 0.6 }),
    row({ name: "ayam goreng", grams: 80, kcal: 200 }),
  ]);

  test("the model's kcal is replaced by the user's kcal per gram at the item's grams, macros from their own row", () => {
    const item = { name: "Nasi putih", grams: 150, kcal: 231, protein: 4.2, carbs: 50, fat: 0.5, fiber: 0.5 };
    const out = withUsualDensity(item, usual);
    expect(out).toMatchObject({ kcal: 293, protein: 5.3, carbs: 63, fat: 0.6, fiber: 0.9, usualDensity: { modelKcal: 231, n: 1 } });
  });

  test("a history row without macros: the model's macros scale with the kcal, never invented", () => {
    const out = withUsualDensity({ name: "ayam goreng", grams: 120, kcal: 274, protein: 22, carbs: 10, fat: 15 }, usual);
    expect(out.kcal).toBe(300);
    expect(out.protein).toBe(24.1);
    expect(out.carbs).toBe(10.9);
    expect(out.fat).toBe(16.4);
    expect("fiber" in out).toBe(false);
  });

  test("no history, no weight, a hidden cup, or the same number: the item comes back untouched", () => {
    const rice = { name: "nasi putih", grams: 150, kcal: 293 };
    expect(withUsualDensity({ name: "soto", grams: 300, kcal: 250 }, usual)).toEqual({ name: "soto", grams: 300, kcal: 250 });
    expect(withUsualDensity({ name: "nasi putih", kcal: 200 }, usual)).toEqual({ name: "nasi putih", kcal: 200 });
    expect(withUsualDensity({ ...rice, cup: "M" }, usual)).toEqual({ ...rice, cup: "M" });
    expect(withUsualDensity({ ...rice, kcal: 290 }, usual)).toEqual({ ...rice, kcal: 290 });
  });

  test("a usual density more than twice the model's is another dish: kept as the model said", () => {
    const item = { name: "nasi putih", grams: 100, kcal: 60 };
    expect(withUsualDensity(item, usual)).toEqual(item);
    const big = { name: "nasi putih", grams: 100, kcal: 500 };
    expect(withUsualDensity(big, usual)).toEqual(big);
  });

  test("a different dish with the name inside it never borrows", () => {
    const item = { name: "nasi goreng", grams: 200, kcal: 340 };
    expect(withUsualDensity(item, usual)).toEqual(item);
  });
});
