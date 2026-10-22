import { describe, expect, test } from "bun:test";

import { TKPI_2019 } from "../tkpi2019-data";
import { answer } from "./answer";
import type { AnswerDeps } from "./answer";
import { TODAY, fakeRpc } from "./data-fixtures";
import { foodBlockFor } from "./food-block";
import { amountsFor, choosePortion, lookupFood } from "./foods";
import { adult, safetyText, sampleSource, scriptedAdapter, textReply, toolReply } from "./testFixtures";
import { createToolData } from "./tool-data";
import { TYPICAL_PORTION_CODES, typicalPortionFor } from "./typical-portions";

const food = (name: string) => {
  const found = lookupFood(name);
  if (!found.ok) throw new Error(`${name} did not resolve`);
  return found.food;
};

describe("curated typical portions", () => {
  test("every code is a real TKPI row, with a sane gram figure and both unit names", () => {
    const codes = new Set(TKPI_2019.map((row) => row[0]));
    for (const code of TYPICAL_PORTION_CODES) {
      expect(codes.has(code)).toBe(true);
      const t = typicalPortionFor(code);
      expect(t?.grams).toBeGreaterThanOrEqual(10);
      expect(t?.grams).toBeLessThanOrEqual(200);
      expect(t?.id.length).toBeGreaterThan(0);
      expect(t?.en.length).toBeGreaterThan(0);
    }
    expect(typicalPortionFor(null)).toBeUndefined();
  });

  test("an entry never shadows a portion our data really has (no dead entries)", () => {
    for (const code of TYPICAL_PORTION_CODES) {
      const f = food(code);
      expect(f.portions.piece).toBeNull();
      expect(f.portions.library).toBeNull();
      expect(f.portions.typical?.label).toContain("typical estimate");
    }
  });

  test("the owner's fruit: pepaya 1 potong 100 g, melon 1 potong 100 g, semangka 1 potong 150 g, kcal from the TKPI row", () => {
    const rows = [
      ["pepaya", 100, 46],
      ["melon", 100, 37],
      ["semangka", 150, 42],
    ] as const;
    for (const [name, grams, kcal] of rows) {
      const f = food(name);
      expect(choosePortion(f)).toMatchObject({ grams, source: "typical" });
      expect(choosePortion(f)?.label).toContain("1 potong");
      expect(amountsFor(f, grams).kcal).toBe(kcal);
    }
  });

  test("other common fruit, gorengan, crackers and bread resolve to a portion", () => {
    const expected: [string, number, string][] = [
      ["mangga", 150, "typical"],
      ["nanas", 90, "typical"],
      ["salak", 100, "typical"],
      ["rambutan", 60, "typical"],
      ["jambu biji", 100, "typical"],
      ["alpukat", 100, "typical"],
      ["pisang raja", 100, "typical"],
      ["bakwan", 50, "typical"],
      ["pastel", 60, "typical"],
      ["kerupuk udang goreng", 20, "typical"],
      ["emping kerupuk melinjo", 20, "typical"],
      ["keripik singkong", 30, "typical"],
      ["biskuit", 30, "typical"],
      ["nasi merah", 150, "typical"],
      // real data wins or stays: counted pieces and dish-library servings
      ["apel", 150, "piece"],
      ["jeruk", 110, "piece"],
      ["pisang ambon", 90, "piece"],
      ["roti", 30, "piece"],
      ["tahu goreng", 100, "library"],
      ["tempe goreng", 80, "library"],
      ["kerupuk", 20, "library"],
      ["pisang goreng", 100, "library"],
    ];
    for (const [name, grams, source] of expected) expect(choosePortion(food(name))).toMatchObject({ grams, source });
  });

  test("real portion data and the person's grams beat the estimate", () => {
    expect(choosePortion(food("pepaya"), { usual: 130 })).toMatchObject({ grams: 130, source: "yours" });
    expect(choosePortion(food("pepaya"), { usual: 130, asked: 80 })).toMatchObject({ grams: 80, source: "asked" });
    expect(food("nasi putih").portions.typical).toBeNull();
  });

  test("a food with no data portion and no estimate still has no portion", () => {
    expect(choosePortion(food("anggur hutan"))).toBeNull();
  });
});

describe("the fruit question end to end: per-portion kcal and a fits_today answer without grams", () => {
  const QUESTION = "Mana yang seratnya paling tinggi: pepaya, melon, atau semangka?";

  test("food block and prompt tell the model to assume one portion; tool results carry per-portion kcal and what is left", async () => {
    const data = createToolData(fakeRpc(), { today: () => TODAY, engine: "hosted" });
    const adapter = scriptedAdapter([
      toolReply(
        { id: "c1", name: "compare_foods", args: { foods: ["pepaya", "melon", "semangka"], by: "fiber" } },
        { id: "c2", name: "fits_today", args: { food: "pepaya" } },
      ),
      textReply("Pepaya paling tinggi seratnya. 1 potong pepaya ≈ 100 g = 46 kkal, sisa 1.544 kkal."),
    ]);
    const deps: AnswerDeps = {
      adapter,
      conn: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-live-ABCDEFGH12345678", model: "gpt-6-luna" },
      person: adult,
      locale: "id",
      text: safetyText("id"),
      gather: async () => sampleSource(),
      data,
      preseed: (text) => foodBlockFor(text, data),
      beforeCall: () => {},
      afterCall: () => {},
    };
    const out = await answer([{ role: "user", content: QUESTION }], deps);
    expect(out.reply).toContain("1 potong pepaya ≈ 100 g = 46 kkal");

    const first = adapter.requests[0]!;
    expect(first.system).toContain("Pepaya, segar, 100 g (1 potong (1 slice), typical estimate): kcal 46");
    expect(first.system).toContain("do not ask for grams first");
    expect(first.system).toContain('Never answer "I have no portion data"');
    expect(first.system).toContain("1 potong pepaya ≈ 100 g = 46 kkal");

    const tools = adapter.requests[1]!.messages.filter((m) => m.role === "tool");
    expect(tools).toHaveLength(2);
    const compare = JSON.parse(tools[0]!.content);
    expect(compare.perPortionRanking.map((e: { name: string }) => e.name)).toEqual(["Pepaya, segar", "Melon, segar", "Semangka, segar"]);
    expect(compare.items.map((i: { portion: { grams: number; source: string } }) => [i.portion.grams, i.portion.source])).toEqual([
      [100, "typical"],
      [100, "typical"],
      [150, "typical"],
    ]);
    expect(compare.items.map((i: { perPortion: { kcal: number } }) => i.perPortion.kcal)).toEqual([46, 37, 42]);
    expect(compare.noPortion).toEqual([]);

    const fits = JSON.parse(tools[1]!.content);
    expect(fits.needsGrams).toBeUndefined();
    expect(fits).toMatchObject({ portion: { grams: 100, source: "typical" }, amounts: { kcal: 46 } });
    expect(fits.after.kcal).toBe(fits.remainingBefore.kcal - 46);
  });
});
