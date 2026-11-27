import { describe, expect, test } from "bun:test";

import { KNOWN_GOOD_MIN_DAYS, findKnownGood, fitKnownGood, knownGoodRoom } from "./known-good";
import type { KnownGoodDay, KnownGoodMeal, KnownGoodRow } from "./known-good";

let seq = 0;
const row = (name: string, date: string, over: Partial<KnownGoodRow> = {}): KnownGoodRow => {
  seq += 1;
  return {
    id: `r${seq}`,
    name,
    kcal: 300,
    plateId: null,
    createdAt: 1_000 + seq,
    date,
    meal: "makan_siang",
    grams: null,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
    scanId: null,
    ...over,
  };
};
const days = (name: string, dates: string[], over: Partial<KnownGoodRow> = {}) => dates.map((date) => row(name, date, over));

describe("findKnownGood", () => {
  test(`a food logged on ${KNOWN_GOOD_MIN_DAYS} different days is a habit; three times on one day is not`, () => {
    expect(findKnownGood(days("Kopi susu", ["2026-11-01", "2026-11-01", "2026-11-01"]), [])).toEqual([]);
    const found = findKnownGood(days("Gado-gado", ["2026-11-01", "2026-11-03", "2026-11-05"], { kcal: 350 }), []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Gado-gado", kcal: 350, days: 3, meals: ["makan_siang"], savedFoodId: null });
  });

  test("names match regardless of case and punctuation; the newest row's values are the ones logged", () => {
    const rows = [
      row("Soto ayam", "2026-11-01", { kcal: 300 }),
      row("soto Ayam!", "2026-11-02", { kcal: 310, meal: "makan_malam" }),
      row("SOTO AYAM", "2026-11-03", { kcal: 330, protein: 22, grams: 400, scanId: "s".repeat(32) }),
    ];
    expect(findKnownGood(rows, [])[0]).toMatchObject({
      name: "SOTO AYAM",
      kcal: 330,
      protein: 22,
      grams: 400,
      scanId: "s".repeat(32),
      meals: ["makan_malam", "makan_siang"],
    });
  });

  test("a combo counts once per plate and is offered only when it is a favorite, under the favorite's name", () => {
    const plate = (id: string, date: string) => [
      row("nasi putih", date, { plateId: id, kcal: 180 }),
      row("ayam bakar", date, { plateId: id, kcal: 250 }),
    ];
    const rows = [...plate("p1", "2026-11-01"), ...plate("p2", "2026-11-02"), ...plate("p3", "2026-11-03")];
    expect(findKnownGood(rows, [])).toEqual([]);
    const favorite = { id: "f1", name: "Nasi ayam bakar", kcal: 430, itemNames: ["Ayam bakar", "Nasi putih"] };
    expect(findKnownGood(rows, [favorite])).toEqual([
      expect.objectContaining({ name: "Nasi ayam bakar", kcal: 430, savedFoodId: "f1", days: 3 }),
    ]);
  });

  test("hidden foods and zero-kcal habits are left out", () => {
    const rows = [
      ...days("Air putih", ["2026-11-01", "2026-11-02", "2026-11-03"], { kcal: 0 }),
      ...days("Kerupuk", ["2026-11-01", "2026-11-02", "2026-11-03"], { kcal: 60 }),
    ];
    expect(findKnownGood(rows, []).map((meal) => meal.name)).toEqual(["Kerupuk"]);
    expect(findKnownGood(rows, [], new Set(["kerupuk"]))).toEqual([]);
  });

  test("most-eaten first, the newest on a tie", () => {
    const rows = [
      ...days("Bubur ayam", ["2026-11-01", "2026-11-02", "2026-11-03"]),
      ...days("Pecel", ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]),
      ...days("Lontong", ["2026-11-05", "2026-11-06", "2026-11-07"]),
    ];
    expect(findKnownGood(rows, []).map((meal) => meal.name)).toEqual(["Pecel", "Lontong", "Bubur ayam"]);
  });
});

const habit = (name: string, kcal: number, meals: string[]): KnownGoodMeal => ({
  key: name.toLowerCase(),
  name,
  kcal,
  days: 3,
  meals,
  scanId: null,
  savedFoodId: null,
  grams: null,
  protein: null,
  carbs: null,
  fat: null,
  fiber: null,
});
const day = (over: Partial<KnownGoodDay> = {}): KnownGoodDay => ({
  eatKcal: 2000,
  eatenKcal: 0,
  eatenByMeal: {},
  ramadan: false,
  ...over,
});

describe("fitKnownGood", () => {
  const lunch = [habit("Nasi padang", 750, ["makan_siang"]), habit("Gado-gado", 350, ["makan_siang"]), habit("Pecel", 450, ["makan_siang", "makan_malam"])];

  test("the slot's room is its share of the budget less what it holds, capped by the day", () => {
    expect(knownGoodRoom("makan_siang", day())).toBe(700); // 35% of 2000
    expect(knownGoodRoom("makan_siang", day({ eatenKcal: 400, eatenByMeal: { makan_siang: 200 } }))).toBe(500);
    expect(knownGoodRoom("makan_siang", day({ eatenKcal: 1800 }))).toBe(200);
    expect(knownGoodRoom("snack", day({ eatenKcal: 2100 }))).toBe(0);
    expect(knownGoodRoom("makan_siang", day({ eatKcal: null }))).toBe(0);
  });

  test("only habits of that slot that fit are shown", () => {
    expect(fitKnownGood(lunch, "makan_siang", day()).map((m) => m.name)).toEqual(["Gado-gado", "Pecel"]);
    expect(fitKnownGood(lunch, "makan_malam", day()).map((m) => m.name)).toEqual(["Pecel"]);
    expect(fitKnownGood(lunch, "makan_siang", day({ eatenKcal: 300, eatenByMeal: { makan_siang: 300 } })).map((m) => m.name)).toEqual(["Gado-gado"]);
    expect(fitKnownGood(lunch, "makan_siang", day({ eatenKcal: 1900 }))).toEqual([]);
  });

  test("Ramadan uses its own split: breakfast has no share, berbuka has 45%", () => {
    const meals = [habit("Kolak", 300, ["berbuka", "sarapan"])];
    expect(fitKnownGood(meals, "sarapan", day({ ramadan: true }))).toEqual([]);
    expect(fitKnownGood(meals, "berbuka", day({ ramadan: true })).map((m) => m.name)).toEqual(["Kolak"]);
  });

  test("at most the given number", () => {
    const many = Array.from({ length: 6 }, (_, i) => habit(`Lauk ${i}`, 100, ["makan_siang"]));
    expect(fitKnownGood(many, "makan_siang", day())).toHaveLength(3);
  });
});
