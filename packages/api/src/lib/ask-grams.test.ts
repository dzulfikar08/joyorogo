import { describe, expect, test } from "bun:test";

import { asksGrams, ASK_GRAMS_MIN, itemAtTypedGrams, shouldAskGrams, sizeOptionsOf } from "./ask-grams";

const bowl = { name: "bubur kacang hijau", grams: 300, kcal: 330, kind: "makanan" };

describe("shouldAskGrams", () => {
  test("asks for a lone item from 200 g", () => {
    expect(ASK_GRAMS_MIN).toBe(200);
    expect(shouldAskGrams([{ ...bowl, grams: 200 }])).toBe(true);
    expect(shouldAskGrams([{ ...bowl, grams: 199 }])).toBe(false);
    expect(shouldAskGrams([{ ...bowl, grams: 350 }])).toBe(true);
  });

  test("never for an item with no weight, or an empty answer", () => {
    expect(shouldAskGrams([{ ...bowl, grams: undefined }])).toBe(false);
    expect(shouldAskGrams([])).toBe(false);
  });

  test("never for a plate of two or more items, however heavy", () => {
    expect(shouldAskGrams([bowl, { name: "nasi putih", grams: 150, kind: "makanan" }])).toBe(false);
    expect(shouldAskGrams([bowl, { ...bowl, name: "es teh", grams: 300 }])).toBe(false);
  });

  test("never for a drink, a cup with hidden contents, or a weight with another source", () => {
    expect(shouldAskGrams([{ ...bowl, kind: "minuman" }])).toBe(false);
    expect(shouldAskGrams([{ ...bowl, cup: { drink: "cola", size: "M" } }])).toBe(false);
    expect(shouldAskGrams([{ ...bowl, scaleRead: { active: "scale" } }])).toBe(false);
    expect(shouldAskGrams([{ ...bowl, portionPrior: { active: "prior" } }])).toBe(false);
  });

  test("a snack or a row with no kind is asked like a dish; a counted row too", () => {
    expect(shouldAskGrams([{ grams: 250 }])).toBe(true);
    expect(shouldAskGrams([{ ...bowl, kind: "camilan" }])).toBe(true);
    expect(shouldAskGrams([{ ...bowl, pieces: { count: 6, unit: "potong", unitGrams: 40 } }])).toBe(true);
  });
});

describe("sizeOptionsOf", () => {
  test("is half, one and one and a half times the typical serving, rounded to 5 g", () => {
    expect(sizeOptionsOf(150)).toEqual([75, 150, 225]);
    expect(sizeOptionsOf(350)).toEqual([175, 350, 525]);
    expect(sizeOptionsOf(130)).toEqual([65, 130, 195]);
    expect(sizeOptionsOf(135)).toEqual([70, 135, 205]);
    expect(sizeOptionsOf(133)).toEqual([65, 135, 200]);
  });

  test("keeps three different sizes of at least 5 g, or gives none", () => {
    expect(sizeOptionsOf(20)).toEqual([10, 20, 30]);
    expect(sizeOptionsOf(10)).toEqual([5, 10, 15]);
    expect(sizeOptionsOf(5)).toBeUndefined();
    expect(sizeOptionsOf(8)).toBeUndefined();
  });

  test("no typical serving, no sizes", () => {
    expect(sizeOptionsOf(undefined)).toBeUndefined();
    expect(sizeOptionsOf(0)).toBeUndefined();
    expect(sizeOptionsOf(-50)).toBeUndefined();
    expect(sizeOptionsOf(Number.NaN)).toBeUndefined();
  });

  test("caps the large size at 5000 g", () => {
    expect(sizeOptionsOf(4000)?.[2]).toBe(5000);
  });
});

describe("asksGrams", () => {
  test("shows until a chip or a typed weight stamps the row", () => {
    expect(asksGrams({ askGrams: true })).toBe(true);
    expect(asksGrams({ askGrams: true, gramsEdits: [] })).toBe(true);
    expect(asksGrams({ askGrams: true, gramsEdits: ["count"] })).toBe(false);
    expect(asksGrams({})).toBe(false);
  });
});

describe("itemAtTypedGrams", () => {
  const row = {
    name: "spaghetti bolognese",
    portion: "1 mangkuk",
    grams: 300,
    kcal: 450,
    protein: 18,
    carbs: 60,
    fat: 15,
    askGrams: true,
    pieces: { count: 1, unit: "porsi", unitGrams: 300 },
  };

  test("scales kcal and macros with the weight, stamps typed and ends the prompt", () => {
    const next = itemAtTypedGrams(row, 120);
    expect(next).toMatchObject({ grams: 120, kcal: 180, protein: 7.2, carbs: 24, fat: 6, gramsEdits: ["typed"] });
    expect(next).not.toHaveProperty("askGrams");
    expect(next).not.toHaveProperty("portion");
    expect(next).not.toHaveProperty("pieces");
    expect(asksGrams(next)).toBe(false);
  });

  test("rounds the typed weight and caps it at 5000 g", () => {
    expect(itemAtTypedGrams(row, 119.6).grams).toBe(120);
    expect(itemAtTypedGrams(row, 99999).grams).toBe(5000);
  });

  test("an unusable weight, or a row with no weight, comes back unchanged", () => {
    expect(itemAtTypedGrams(row, 0)).toBe(row);
    expect(itemAtTypedGrams(row, -5)).toBe(row);
    expect(itemAtTypedGrams(row, Number.NaN)).toBe(row);
    const bare = { name: "x", kcal: 100 };
    expect(itemAtTypedGrams(bare, 50)).toBe(bare);
  });

  test("a bone-in estimate and a usual-portion note no longer describe the weight", () => {
    const next = itemAtTypedGrams(
      { ...row, edibleGrams: 180, grossGrams: 300, withBone: true, portionPrior: { active: "ai" }, usualDensity: { modelKcal: 1 } },
      200,
    );
    for (const key of ["edibleGrams", "grossGrams", "withBone", "portionPrior", "usualDensity"]) expect(next).not.toHaveProperty(key);
  });
});

describe("itemAtTypedGrams from a size chip", () => {
  test("is stamped size, and the size chips leave with the prompt", () => {
    const next = itemAtTypedGrams({ name: "bubur", grams: 300, kcal: 330, askGrams: true, sizeOptions: [175, 350, 525] }, 175, "size");
    expect(next).toMatchObject({ grams: 175, kcal: 193, gramsEdits: ["size"] });
    expect(next).not.toHaveProperty("sizeOptions");
    expect(next).not.toHaveProperty("askGrams");
  });
});
