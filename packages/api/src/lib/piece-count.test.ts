import { describe, expect, test } from "bun:test";

import { applyHintCounts, expectedGrams, piecesFor, readCount, reconcileCount } from "./piece-count";
import { itemAtCount } from "./piece-chip";
import type { Pieces } from "./piece-chip";
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

describe("pieces: the row's Jumlah stepper", () => {
  test("a counted egg row carries its count, unit and one piece's weight", () => {
    const item = reconcileCount({ name: "telur rebus", portion: "3 butir", grams: 150, kcal: 225, count: 3, unit: "butir" });
    expect(item.pieces).toEqual({ count: 3, unit: "butir", unitGrams: 50 });
  });

  test("halves count per half at half an egg", () => {
    const item = reconcileCount({ name: "telur rebus", portion: "7 belahan", grams: 175, kcal: 270, count: 7, unit: "belahan" });
    expect(item.pieces).toEqual({ count: 7, unit: "belahan", unitGrams: 25 });
  });

  test("an egg the model gave no count for gets the count its grams amount to", () => {
    expect(reconcileCount({ name: "telur rebus", portion: "1 porsi", grams: 100, kcal: 150 }).pieces).toEqual({ count: 2, unit: "butir", unitGrams: 50 });
    expect(piecesFor("telur rebus", undefined)).toBeUndefined();
  });

  test("egg white, a dish built on egg and unrelated foods get no table row; a counted dish keeps the model's grams", () => {
    expect(reconcileCount({ name: "putih telur", grams: 100, kcal: 52 }).pieces).toBeUndefined();
    expect(reconcileCount({ name: "nasi putih", portion: "1 porsi", grams: 150, kcal: 195 }).pieces).toBeUndefined();
    const balado = reconcileCount({ name: "telur balado", portion: "4 butir", grams: 200, kcal: 380 });
    expect(balado.grams).toBe(200);
    expect(balado.pieces).toEqual({ count: 4, unit: "butir", unitGrams: 50 });
  });

  test("ayam goreng '2 potong' is steppable with the model's own grams per piece", () => {
    const item = reconcileCount({ name: "ayam goreng", portion: "2 potong, dengan tulang", grams: 200, kcal: 400 });
    expect(item.pieces).toEqual({ count: 2, unit: "potong", unitGrams: 100 });
  });

  test("bakwan and pastel come from the typical household pieces", () => {
    expect(reconcileCount({ name: "bakwan", portion: "3 buah", grams: 150, kcal: 420, count: 3, unit: "buah" }).pieces).toEqual({ count: 3, unit: "buah", unitGrams: 50 });
  });

  test("the unit label a model wrote that the app has no word for still counts as pieces", () => {
    expect(reconcileCount({ name: "sate ayam", portion: "10 tusuk", grams: 300, kcal: 500, count: 10, unit: "tusuk" }).pieces?.count).toBe(10);
  });
});

describe("applyHintCounts: counts the user wrote in the retry hint", () => {
  const egg = (count = 1) => ({ name: "telur rebus", kcal: 75 * count, grams: 50 * count, portion: `${count} butir`, pieces: { count, unit: "butir", unitGrams: 50 } });
  const bakwan = { name: "bakwan", kcal: 140, grams: 50, portion: "1 buah", pieces: { count: 1, unit: "buah", unitGrams: 50 } };
  const rice: { name: string; kcal: number; grams: number; pieces?: Pieces } = { name: "nasi putih", kcal: 195, grams: 150 };

  test("'ini bakwan, telurnya 3' puts three on the egg row only", () => {
    const [b, e, r] = applyHintCounts([bakwan, egg(), rice], "ini bakwan, telurnya 3");
    expect(e?.pieces?.count).toBe(3);
    expect(e?.grams).toBe(150);
    expect(e?.kcal).toBe(225);
    expect(b).toBe(bakwan);
    expect(r).toBe(rice);
  });

  test("number before the food, with or without a unit", () => {
    expect(applyHintCounts([egg()], "3 telur")[0]?.pieces?.count).toBe(3);
    expect(applyHintCounts([egg()], "ada 4 butir telur")[0]?.pieces?.count).toBe(4);
  });

  test("a food name then a filler word then the number", () => {
    expect(applyHintCounts([egg()], "telur ada 2")[0]?.pieces?.count).toBe(2);
  });

  test("a bare count of pieces goes to the only counted row; with two it changes nothing", () => {
    expect(applyHintCounts([egg(), rice], "ada 3 butir")[0]?.pieces?.count).toBe(3);
    const two = [egg(), bakwan];
    expect(applyHintCounts(two, "ada 3 butir")).toEqual(two);
  });

  test("numbers that are weights or name no counted row change nothing", () => {
    const items = [egg(), rice];
    expect(applyHintCounts(items, "nasinya 100 gram")).toEqual(items);
    expect(applyHintCounts(items, "nasi 2")).toEqual(items);
    expect(applyHintCounts(items, undefined)).toBe(items);
  });
});

describe("itemAtCount", () => {
  test("a count change scales weight, kcal and macros together", () => {
    const row = { name: "telur rebus", portion: "1 butir", grams: 50, kcal: 75, protein: 6, carbs: 1, fat: 5, pieces: { count: 1, unit: "butir", unitGrams: 50 } };
    const three = itemAtCount(row, 3);
    expect(three).toMatchObject({ grams: 150, kcal: 225, protein: 18, carbs: 3, fat: 15, portion: "3 butir", pieces: { count: 3 } });
  });
});
