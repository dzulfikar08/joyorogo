import { describe, expect, test } from "bun:test";

import { clampCount, itemAtCount, MAX_PIECES, pieceUnitKey } from "./piece-chip";

const egg = {
  name: "telur rebus",
  portion: "1 butir",
  grams: 50,
  kcal: 75,
  protein: 6,
  carbs: 0.6,
  fat: 5,
  fiber: 0,
  pieces: { count: 1, unit: "butir", unitGrams: 50 },
};

describe("itemAtCount", () => {
  test("1 -> 3 eggs: grams, kcal and every macro triple", () => {
    expect(itemAtCount(egg, 3)).toMatchObject({
      grams: 150,
      kcal: 225,
      protein: 18,
      carbs: 1.8,
      fat: 15,
      fiber: 0,
      portion: "3 butir",
      pieces: { count: 3, unit: "butir", unitGrams: 50 },
    });
  });

  test("3 -> 2: the per-piece numbers come from the row as it is now", () => {
    const three = itemAtCount(egg, 3);
    expect(itemAtCount(three, 2)).toMatchObject({ grams: 100, kcal: 150, protein: 12 });
  });

  test("a kcal the user typed scales too", () => {
    expect(itemAtCount({ ...egg, kcal: 90 }, 2).kcal).toBe(180);
  });

  test("count is whole and bounded", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(2.6)).toBe(3);
    expect(clampCount(500)).toBe(MAX_PIECES);
    expect(itemAtCount(egg, 0).pieces?.count).toBe(1);
  });

  test("the same count, or a row without pieces, is the same row", () => {
    expect(itemAtCount(egg, 1)).toBe(egg);
    const rice = { name: "nasi", grams: 100, kcal: 130 };
    expect(itemAtCount(rice, 3)).toBe(rice);
  });

  test("the usual-portion and scale chips end with an explicit count", () => {
    const chipped = { ...egg, portionPrior: { active: "ai" }, scaleRead: { active: "ai" } };
    const next = itemAtCount(chipped, 2);
    expect("portionPrior" in next).toBe(false);
    expect("scaleRead" in next).toBe(false);
  });

  test("a bone-in piece keeps both weights in step with the count", () => {
    const wing = {
      name: "ayam goreng",
      portion: "2 potong, dengan tulang",
      grams: 200,
      grossGrams: 200,
      edibleGrams: 130,
      kcal: 400,
      pieces: { count: 2, unit: "potong", unitGrams: 100 },
    };
    expect(itemAtCount(wing, 3)).toMatchObject({
      grams: 300,
      grossGrams: 300,
      edibleGrams: 195,
      kcal: 600,
    });
  });
});

describe("pieceUnitKey", () => {
  test("model words map onto the app's unit labels", () => {
    expect(pieceUnitKey("Butir")).toBe("butir");
    expect(pieceUnitKey("batang")).toBe("tusuk");
    expect(pieceUnitKey("slices")).toBe("lembar");
    expect(pieceUnitKey("halves")).toBe("belahan");
    expect(pieceUnitKey("pcs")).toBe("buah");
    expect(pieceUnitKey("mangkuk")).toBe("buah");
  });
});
