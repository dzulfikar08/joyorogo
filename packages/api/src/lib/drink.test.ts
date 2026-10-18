import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CUP_DRINKS,
  CUP_SIZES,
  cupDrinkName,
  cupItem,
  cupSizeLabel,
  guessCupChoice,
} from "./drink-options";
import { foodKind } from "./food-kind";
import { applyCorrection } from "./scan-correct";
import type { CorrectionItemInput } from "./scan-correct";
import { calibrateItems } from "./tkpi";
import { analyzeFoodPhoto, parseAnswer, previewItem, retryInstruction, visionPrompt } from "./vision";
import type { AiRunner } from "./vision";

// Drinks (owner report 2026-10-18): neither a typed "coke zero" nor a photo of a
// Coke Zero can / a McDonald's cup logged. Zero kcal was treated as "no item"
// (parseAnswer, storyItemsFromText, applyCorrection) and the generic band floored
// the rest at 20 kcal. Fixtures: see fixtures/vision-drinks.json.
const FIXTURES = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "vision-drinks.json"), "utf8"),
) as Record<string, string>;
const raw = (key: string): string => {
  const text = FIXTURES[key];
  if (text === undefined) throw new Error(`no fixture ${key}`);
  return text;
};

const OPTS = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" as const };
const runnerFor = (text: string): AiRunner => ({
  run: () => Promise.resolve({ choices: [{ message: { content: text }, finish_reason: "stop" }] }),
});

describe("zero-calorie drinks from a photo", () => {
  test("Coke Zero can at 0 kcal is an item, not a failed scan", () => {
    const answer = parseAnswer(raw("live/coke-zero-can"), "stop");
    expect(answer.items).toHaveLength(1);
    expect(answer.items[0]).toMatchObject({ name: "Coca-Cola Zero", kind: "minuman", grams: 150 });
    expect(answer.items[0]!.kcal).toBeLessThanOrEqual(5);
  });

  test("analyzeFoodPhoto returns the zero drink instead of throwing", async () => {
    const result = await analyzeFoodPhoto(runnerFor(raw("live/coke-zero-can")), OPTS);
    expect(result.items.map((item) => item.name)).toEqual(["Coca-Cola Zero"]);
  });

  test("a water bottle is allowed at 0 kcal", async () => {
    const result = await analyzeFoodPhoto(runnerFor(raw("constructed/water-bottle")), OPTS);
    expect(result.items[0]).toMatchObject({ name: "Air putih", kcal: 0, grams: 600, kind: "minuman" });
  });

  test("unsweetened tea and black coffee stay near zero, not floored at 20", async () => {
    const tea = await analyzeFoodPhoto(runnerFor(raw("constructed/teh-tawar-glass")), OPTS);
    expect(tea.items[0]!.kcal).toBeLessThanOrEqual(10);
    const coffee = await analyzeFoodPhoto(runnerFor(raw("constructed/kopi-hitam")), OPTS);
    expect(coffee.items[0]!.kcal).toBeLessThanOrEqual(10);
  });

  test("sweet tea keeps its sugar kcal", async () => {
    const result = await analyzeFoodPhoto(runnerFor(raw("constructed/sweet-tea-glass")), OPTS);
    expect(result.items[0]!.kcal).toBeGreaterThanOrEqual(50);
    expect(result.items[0]!.carbs).toBeGreaterThan(10);
  });

  test("a Coke Zero next to fries keeps both items", async () => {
    const result = await analyzeFoodPhoto(runnerFor(raw("constructed/coke-zero-can-plus-fries")), OPTS);
    expect(result.items.map((item) => item.name)).toEqual(["Kentang goreng", "Coke Zero"]);
    expect(result.items[1]!.kcal).toBeLessThanOrEqual(5);
  });

  test("zero kcal is still a miss for something that is not a drink", () => {
    const answer = parseAnswer(
      JSON.stringify({ items: [{ name: "Nasi goreng", kind: "makanan", kcal: 0 }] }),
      "stop",
    );
    expect(answer.items).toEqual([]);
    expect(answer.found).toBe(1);
  });

  test("a zero drink streams as a preview row too", () => {
    const item = previewItem({ name: "Coke Zero", kind: "minuman", grams: 330, kcal: 0 });
    expect(item).toMatchObject({ name: "Coke Zero", grams: 330 });
    expect(item!.kcal).toBeLessThanOrEqual(1);
  });

  test("the prompt tells the model drinks are valid, zero is valid and ml is the unit", () => {
    const prompt = visionPrompt();
    expect(prompt).toContain("Coke Zero");
    expect(prompt).toContain("kcal 0 atau 1");
    expect(prompt).toContain("ml");
    expect(prompt).toContain("McDonald");
    expect(prompt).toContain('"cup"');
  });
});

describe("a branded cup whose contents are hidden", () => {
  test("the red McD cup becomes a drink item with options, not a failure", async () => {
    const result = await analyzeFoodPhoto(runnerFor(raw("live/mcd-cup-lidded-red")), OPTS);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: "Coca-Cola",
      kind: "minuman",
      grams: 350,
      portion: "M · 350 ml",
      cup: { drink: "coke", size: "M" },
    });
    expect(result.items[0]!.kcal).toBe(147);
    // A guess, and shown as one.
    expect(result.items[0]!.confidence).toBeLessThan(0.5);
  });

  test("the model's size letter picks the cup size and the guess picks the drink", () => {
    const [item] = parseAnswer(raw("constructed/mcd-cup-large-unknown-contents"), "stop").items;
    // "Minuman bersoda" names no drink: the McD default, Coca-Cola, at size L.
    expect(item).toMatchObject({ grams: 450, cup: { drink: "coke", size: "L" } });
    expect(item!.kcal).toBe(189);
  });

  test("a cup the model could identify (hot coffee under the lid) is a plain drink, no options", () => {
    const [item] = parseAnswer(raw("live/mcd-hot-cup-lid-top"), "stop").items;
    expect(item).toMatchObject({ name: "kopi panas", kind: "minuman" });
    expect(item!.cup).toBeUndefined();
  });

  test("a cup that the model names Coke Zero is offered as Coke Zero at ~0 kcal", () => {
    const answer = parseAnswer(
      JSON.stringify({ items: [{ name: "Coke Zero", kind: "minuman", kcal: 0, cup: "M" }] }),
      "stop",
    );
    expect(answer.items[0]).toMatchObject({ name: "Coke Zero", cup: { drink: "coke_zero", size: "M" } });
    expect(answer.items[0]!.kcal).toBeLessThanOrEqual(1);
  });

  test("an English locale shows the English drink name", () => {
    const answer = parseAnswer(
      JSON.stringify({ items: [{ name: "Es teh", kind: "minuman", kcal: 100, cup: "M" }] }),
      "stop",
      "en",
    );
    expect(answer.items[0]).toMatchObject({ name: "Iced sweet tea", cup: { drink: "iced_tea", size: "M" } });
  });

  test("a retry hint naming the contents overrides the cup guess", () => {
    expect(retryInstruction("coke zero")).toContain("Coke Zero");
    expect(retryInstruction("coke zero")).toContain("tanpa field");
  });

  test("a genuine not-food answer is still not food", async () => {
    const outcome = await analyzeFoodPhoto(
      runnerFor(JSON.stringify({ items: [], problem: "bukan_makanan" })),
      OPTS,
    ).catch((error: unknown) => error as { reason: string });
    expect(outcome).toMatchObject({ reason: "not_food" });
  });
});

describe("cup options", () => {
  test("every offered drink has a value for every size, in ml", () => {
    for (const drink of CUP_DRINKS) {
      for (const size of CUP_SIZES) {
        const item = cupItem({ drink: drink.id, size: size.id });
        expect(item.grams).toBe(size.ml);
        expect(item.kcal).toBeGreaterThanOrEqual(0);
        expect(item.portion).toBe(cupSizeLabel(size.id));
      }
    }
  });

  test("Coke Zero and water are 0 kcal, Coca-Cola and Sprite carry their sugar", () => {
    expect(cupItem({ drink: "coke_zero", size: "M" }).kcal).toBeLessThanOrEqual(1);
    expect(cupItem({ drink: "water", size: "L" }).kcal).toBe(0);
    const coke = cupItem({ drink: "coke", size: "M" });
    expect(coke.kcal).toBe(147);
    expect(coke.carbs).toBeGreaterThan(30);
    expect(cupItem({ drink: "sprite", size: "M" }).kcal).toBe(140);
  });

  test("sizes grow, and so does the sugar", () => {
    const kcal = CUP_SIZES.map((size) => cupItem({ drink: "coke", size: size.id }).kcal);
    expect(kcal).toEqual([...kcal].sort((a, b) => a - b));
    expect(new Set(kcal).size).toBe(3);
  });

  test("guessCupChoice reads drink names in both languages and falls back to the McD default", () => {
    expect(guessCupChoice("Coke Zero", "s")).toEqual({ drink: "coke_zero", size: "S" });
    expect(guessCupChoice("Diet Coke", "M")).toEqual({ drink: "coke_zero", size: "M" });
    expect(guessCupChoice("Coca-Cola", undefined)).toEqual({ drink: "coke", size: "M" });
    expect(guessCupChoice("Sprite", "L")).toEqual({ drink: "sprite", size: "L" });
    expect(guessCupChoice("Es teh manis", "M").drink).toBe("iced_tea");
    expect(guessCupChoice("iced coffee", "M").drink).toBe("coffee");
    expect(guessCupChoice("Air mineral", "M").drink).toBe("water");
    expect(guessCupChoice("Minuman bersoda", "XL")).toEqual({ drink: "coke", size: "M" });
    expect(guessCupChoice(undefined, undefined)).toEqual({ drink: "coke", size: "M" });
  });

  test("names come in Indonesian and English", () => {
    expect(cupDrinkName("iced_tea")).toBe("Es teh manis");
    expect(cupDrinkName("iced_tea", "en")).toBe("Iced sweet tea");
    expect(cupItem({ drink: "coffee", size: "M" }, "en")).toMatchObject({
      name: "Es kopi susu",
      localName: "Iced milk coffee",
    });
  });

  test("every offered drink is classified as a drink", () => {
    for (const drink of CUP_DRINKS) expect(foodKind(drink.names.id)).toBe("minuman");
  });
});

describe("drink calibration", () => {
  const kcalOf = (name: string, grams: number, kcal: number) =>
    calibrateItems([{ name, grams, kcal }])[0]!.kcal;

  test("zero-calorie drinks calibrate to ~0 whatever the model guessed", () => {
    expect(kcalOf("Coke Zero", 330, 0)).toBeLessThanOrEqual(1);
    expect(kcalOf("Coke Zero", 330, 140)).toBeLessThanOrEqual(5);
    expect(kcalOf("Coca-Cola Zero", 330, 1)).toBeLessThanOrEqual(5);
    expect(kcalOf("Diet Coke", 330, 0)).toBeLessThanOrEqual(5);
    expect(kcalOf("Pepsi Max", 330, 0)).toBeLessThanOrEqual(5);
    expect(kcalOf("Air putih", 250, 0)).toBe(0);
    expect(kcalOf("Air mineral", 600, 5)).toBe(0);
    expect(kcalOf("Es teh tawar", 250, 2)).toBeLessThanOrEqual(10);
    expect(kcalOf("Kopi hitam", 200, 0)).toBeLessThanOrEqual(10);
  });

  test("an unknown drink the model put at 0 is not floored at the generic 20", () => {
    expect(kcalOf("Pocari Sweat zero", 500, 0)).toBeLessThanOrEqual(20);
    expect(calibrateItems([{ name: "Minuman misterius", grams: 300, kcal: 0, drink: true }])[0]!.kcal).toBe(0);
  });

  test("sugary drinks are not pulled down", () => {
    expect(kcalOf("Coca-Cola", 330, 140)).toBeGreaterThanOrEqual(100);
    expect(kcalOf("Sprite", 330, 140)).toBeGreaterThanOrEqual(100);
    expect(kcalOf("Teh manis", 250, 100)).toBeGreaterThanOrEqual(50);
    expect(kcalOf("Es kopi susu", 250, 150)).toBeGreaterThanOrEqual(60);
    expect(kcalOf("Kopi susu gula aren", 250, 200)).toBeGreaterThanOrEqual(100);
  });

  test("a library key is not stolen by a longer name that contains it", () => {
    // "coca cola" is exactly a key; "coca cola zero" contains it and must not win for it.
    expect(kcalOf("Coca Cola", 330, 140)).toBeGreaterThanOrEqual(100);
    expect(kcalOf("Coca Cola Zero", 330, 140)).toBeLessThanOrEqual(5);
  });

  test("cokelat and soda gembira do not turn into soft drinks", () => {
    expect(kcalOf("Es cokelat", 300, 250)).toBeGreaterThanOrEqual(150);
    expect(kcalOf("Soda gembira", 300, 220)).toBeGreaterThanOrEqual(150);
  });

  test("a zero kcal non-drink still floors at the generic band", () => {
    expect(kcalOf("Menu misterius", 100, 0)).toBe(20);
  });
});

describe("correcting a drink by text", () => {
  const cup: CorrectionItemInput[] = [
    { name: "Coca-Cola", portion: "M · 350 ml", grams: 350, kcal: 147, protein: 0, carbs: 37.1, fat: 0, kind: "minuman" },
    { name: "Kentang goreng", portion: "1 porsi", grams: 110, kcal: 340, kind: "camilan" },
  ];
  const ops = (...list: unknown[]) => JSON.stringify({ ops: list });

  test("'coke zero' renames the cup to ~0 kcal, not to the old drink's 147", () => {
    const patch = applyCorrection(
      cup,
      ops({ op: "rename", i: 1, name: "Coke Zero", kind: "minuman", kcal100: 0, protein100: 0, carbs100: 0, fat100: 0 }),
    );
    expect(patch.items[0]).toMatchObject({ name: "Coke Zero", grams: 350, kind: "minuman" });
    expect(patch.items[0]!.kcal).toBeLessThanOrEqual(1);
    expect(patch.changes).toEqual([{ index: 0, kind: "renamed" }]);
  });

  test("renaming a juice to air putih ends at 0 kcal", () => {
    const patch = applyCorrection(
      cup,
      ops({ op: "rename", i: 1, name: "Air putih", kind: "minuman", kcal100: 0 }),
    );
    expect(patch.items[0]).toMatchObject({ name: "Air putih", kcal: 0 });
  });

  test("a zero-calorie drink can be added to the list", () => {
    const patch = applyCorrection(
      cup,
      ops({ op: "add", name: "Coke Zero", kind: "minuman", grams: 330, kcal: 0, protein: 0, carbs: 0, fat: 0 }),
    );
    expect(patch.items.map((item) => item.name)).toEqual(["Coca-Cola", "Kentang goreng", "Coke Zero"]);
    expect(patch.items[2]!.kcal).toBeLessThanOrEqual(1);
  });

  test("adding a zero-kcal food is still ignored", () => {
    expect(() =>
      applyCorrection(cup, ops({ op: "add", name: "Nasi goreng", kind: "makanan", kcal: 0 })),
    ).toThrow();
  });

  test("a sugary rename still takes the new drink's figure", () => {
    const patch = applyCorrection(
      cup,
      ops({ op: "rename", i: 1, name: "Teh manis", kind: "minuman", kcal100: 30, carbs100: 7.5 }),
    );
    expect(patch.items[0]!.kcal).toBeGreaterThanOrEqual(50);
  });
});
