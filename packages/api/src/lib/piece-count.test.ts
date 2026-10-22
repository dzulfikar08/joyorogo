import { describe, expect, test } from "bun:test";

import { expectedGrams, readCount, reconcileCount } from "./piece-count";
import { parseAnswer, visionPrompt } from "./vision";

describe("expectedGrams", () => {
  test("egg: 50 g a whole one, 25 g a half", () => {
    expect(expectedGrams("telur rebus", { count: 3, unit: "butir" })).toBe(150);
    expect(expectedGrams("telur rebus", { count: 7, unit: "belahan" })).toBe(175);
  });

  test("other counted items use their own unit weight", () => {
    expect(expectedGrams("sate ayam", { count: 10, unit: "tusuk" })).toBe(300);
    expect(expectedGrams("nugget ayam", { count: 5, unit: "potong" })).toBe(100);
  });

  test("an item or unit outside the table has no expectation", () => {
    expect(expectedGrams("ayam goreng", { count: 2, unit: "potong" })).toBeUndefined();
    expect(expectedGrams("sate ayam", { count: 2, unit: "butir" })).toBeUndefined();
  });
});

describe("readCount", () => {
  test("prefers the model's count and unit", () => {
    expect(readCount({ count: 7, unit: "Belahan", portion: "1 butir" })).toEqual({ count: 7, unit: "belahan" });
  });

  test("falls back to the count written in the portion", () => {
    expect(readCount({ portion: "7 belahan (3,5 butir)" })).toEqual({ count: 7, unit: "belahan" });
    expect(readCount({ portion: "3,5 butir" })).toEqual({ count: 3.5, unit: "butir" });
    expect(readCount({ portion: "sepiring" })).toBeUndefined();
  });
});

describe("reconcileCount", () => {
  test("seven egg halves answered as one egg: grams and kcal follow the count", () => {
    const item = reconcileCount({ name: "telur rebus", portion: "7 belahan (3,5 butir)", grams: 60, kcal: 78, protein: 6, count: 7, unit: "belahan" });
    expect(item.grams).toBe(175);
    expect(item.kcal).toBe(Math.round(78 * (175 / 60)));
    expect(item.protein).toBe(Math.round(6 * (175 / 60)));
    expect(item.portion).toBe("7 belahan (3,5 butir)");
    expect("count" in item).toBe(false);
    expect("unit" in item).toBe(false);
  });

  test("grams within 20% of count x unit weight are kept as the model gave them", () => {
    const item = reconcileCount({ name: "telur rebus", portion: "7 belahan", grams: 160, kcal: 240, count: 7, unit: "belahan" });
    expect(item.grams).toBe(160);
    expect(item.kcal).toBe(240);
  });

  test("a portion without the count gets it written in", () => {
    const item = reconcileCount({ name: "sate ayam", portion: "porsi", grams: 300, kcal: 500, count: 10, unit: "tusuk" });
    expect(item.portion).toBe("10 tusuk");
  });

  test("count read from the portion alone also reconciles", () => {
    const item = reconcileCount({ name: "telur rebus", portion: "3 butir", grams: 50, kcal: 75 });
    expect(item.grams).toBe(150);
    expect(item.kcal).toBe(225);
  });

  test("items outside the table keep their numbers", () => {
    const item = reconcileCount({ name: "ayam goreng", portion: "2 potong", grams: 90, kcal: 300, count: 2, unit: "potong" });
    expect(item.grams).toBe(90);
    expect(item.kcal).toBe(300);
  });
});

describe("scan pipeline", () => {
  test("parseAnswer reconciles a miscounted egg answer and keeps the count in the portion", () => {
    const answer = JSON.stringify({
      items: [{ name: "telur rebus", kind: "makanan", portion: "7 belahan (3,5 butir)", grams: 60, count: 7, unit: "belahan", kcal: 78 }],
    });
    const [item] = parseAnswer(answer, "stop").items;
    expect(item!.grams).toBe(175);
    expect(item!.kcal).toBeGreaterThan(200);
    expect(item!.portion).toContain("7 belahan");
  });

  test("the prompt asks for the count and carries the unit weights the server checks against", () => {
    const prompt = visionPrompt();
    expect(prompt).toContain('"count"');
    expect(prompt).toContain("1 belahan 25 g");
    expect(prompt).toContain("1 butir utuh 50 g");
  });
});
