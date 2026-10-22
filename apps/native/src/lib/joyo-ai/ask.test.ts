import { describe, expect, test } from "bun:test";

import { ASK_LIMITS, foodLabel, foodQuestion, oneLine, scanQuestion, type AskT } from "./ask";

/** Stands in for i18n: the key plus its variables, so the test sees exactly what the builders hand over. */
const t: AskT = (key, options = {}) =>
  `${key}|${Object.entries(options)
    .map(([k, v]) => `${k}=${v}`)
    .join("|")}`;

describe("food question", () => {
  test("names the food and the grams", () => {
    expect(foodQuestion(t, { name: "Nasi putih", grams: 150 })).toBe(
      "ask.food|name=Nasi putih|grams=150",
    );
  });

  test("grams are rounded, and a missing or useless weight asks about the food alone", () => {
    expect(foodQuestion(t, { name: "Apel", grams: 149.6 })).toBe("ask.food|name=Apel|grams=150");
    expect(foodQuestion(t, { name: "Apel", grams: null })).toBe("ask.foodNoGrams|name=Apel");
    expect(foodQuestion(t, { name: "Apel", grams: 0 })).toBe("ask.foodNoGrams|name=Apel");
    expect(foodQuestion(t, { name: "Apel" })).toBe("ask.foodNoGrams|name=Apel");
    expect(foodQuestion(t, { name: "Apel", grams: Number.NaN })).toBe("ask.foodNoGrams|name=Apel");
  });

  test("a name from a label or a model is one short line", () => {
    const name = foodQuestion(t, { name: `Es\n teh\u0000 manis ${"x".repeat(200)}`, grams: 200 });
    expect(name).not.toContain("\n");
    expect(name).not.toContain("\u0000");
    expect(name.length).toBeLessThanOrEqual(ASK_LIMITS.text);
    expect(name.startsWith("ask.food|name=Es teh manis ")).toBe(true);
  });
});

describe("scan question", () => {
  test("lists the items with their grams", () => {
    expect(
      scanQuestion(t, [
        { name: "Nasi", grams: 150 },
        { name: "Ayam goreng", grams: 90 },
        { name: "Teh" },
      ]),
    ).toBe("ask.scan|items=Nasi 150 g, Ayam goreng 90 g, Teh");
  });

  test("nothing named, nothing to ask", () => {
    expect(scanQuestion(t, [])).toBeNull();
    expect(scanQuestion(t, [{ name: "   " }, { name: "\n" }])).toBeNull();
  });

  test("at most six foods are named", () => {
    const foods = Array.from({ length: 9 }, (_, i) => ({ name: `F${i}`, grams: 10 }));
    const text = scanQuestion(t, foods)!;
    expect(text.split(", ")).toHaveLength(ASK_LIMITS.items);
    expect(text).not.toContain("F6");
  });

  test("the whole text stays under the cap", () => {
    const foods = Array.from({ length: 6 }, () => ({ name: "m".repeat(80), grams: 100 }));
    expect(scanQuestion(t, foods)!.length).toBeLessThanOrEqual(ASK_LIMITS.text);
  });
});

describe("helpers", () => {
  test("oneLine trims, flattens and cuts with an ellipsis", () => {
    expect(oneLine("  a \n b  ", 10)).toBe("a b");
    expect(oneLine("abcdefghij", 5)).toBe("abcd\u2026");
  });
  test("foodLabel", () => {
    expect(foodLabel({ name: "Roti", grams: 40 })).toBe("Roti 40 g");
    expect(foodLabel({ name: "Roti" })).toBe("Roti");
  });
});
