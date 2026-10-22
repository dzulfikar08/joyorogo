import { describe, expect, test } from "bun:test";

import { TODAY, fakeRpc } from "./data-fixtures";
import { FOOD_BLOCK_LIMITS, foodBlockFor } from "./food-block";
import { createToolData } from "./tool-data";
import type { RogoRpc } from "./tool-data";

const data = (rpc: RogoRpc = fakeRpc()) => createToolData(rpc, { today: () => TODAY, engine: "hosted" });

describe("owner example questions", () => {
  test("id: fiber across pepaya, melon, semangka -> a ranked block from our rows", async () => {
    const block = await foodBlockFor("Mana yang seratnya paling tinggi: pepaya, melon, atau semangka?", data());
    expect(block).toContain("FOOD DATA (ours");
    expect(block).toContain("Pepaya, segar (ER073): 46 kcal, fiber 1.6 g");
    expect(block).toContain("Melon, segar (ER067): 37 kcal, fiber 1 g");
    expect(block).toContain("Semangka, segar (ER105): 28 kcal, fiber 0.4 g");
    expect(block).toContain("Ranked by fiber per 100 g (highest first): 1. Pepaya, segar 1.6; 2. Melon, segar 1; 3. Semangka, segar 0.4");
    // ER073's macros are withheld, not shown
    expect(block).toContain("protein/carbs/fat withheld");
    expect(block).not.toContain("fat 12");
    // no portion in our data for these fruits
    expect(block).toContain("Pepaya, segar: no portion in our data");
  });

  test("id: nasi merah atau nasi putih for my target -> both rows, the person's usual portion, what is left today", async () => {
    const block = await foodBlockFor("Lebih baik nasi merah atau nasi putih buat target saya?", data());
    expect(block).toContain("Nasi beras merah (AP005): 149 kcal");
    expect(block).toContain("Nasi (AP001): 180 kcal");
    expect(block).toContain("Nasi, 120 g (the person's usual)");
    expect(block).toContain("left today after it: kcal 1374");
    // no nutrient named: no ranking line
    expect(block).not.toContain("Ranked by");
  });

  test("the other two suggestion chips name no food: no block", async () => {
    expect(await foodBlockFor("Sisa kalori hari ini cukup untuk apa?", data())).toBeNull();
    expect(await foodBlockFor("Kenapa berat saya naik minggu ini?", data())).toBeNull();
  });
});

describe("languages", () => {
  test("en: which / better / compare / should I eat", async () => {
    const fiber = await foodBlockFor("Which has more fiber: papaya, melon or watermelon?", data());
    expect(fiber).toContain("Ranked by fiber per 100 g (highest first): 1. Pepaya, segar 1.6; 2. Melon, segar 1; 3. Semangka, segar 0.4");
    const rice = await foodBlockFor("Is brown rice better than white rice for my target?", data());
    expect(rice).toContain("Nasi beras merah (AP005)");
    expect(rice).toContain("Nasi (AP001)");
    const banana = await foodBlockFor("Should I eat a banana or an apple?", data());
    expect(banana).toContain("Pisang ambon, segar (ER074)");
    expect(banana).toContain("Apel, segar (ER004)");
    expect(banana).toContain("90 g (1 banana (buah))");
    expect(await foodBlockFor("Compare papaya and melon", data())).toContain("Pepaya, segar (ER073)");
  });

  test("ms: mana / lebih baik / atau / banding", async () => {
    const ms = await foodBlockFor("Mana lebih tinggi serat, betik atau tembikai, papaya atau melon?", data());
    expect(ms).toContain("Pepaya, segar (ER073)");
    expect(ms).toContain("Melon, segar (ER067)");
    const rice = await foodBlockFor("Lebih baik nasi perang atau nasi putih?", data());
    expect(rice).toContain("Nasi beras merah (AP005)");
    expect(rice).toContain("Nasi (AP001)");
    const fruit = await foodBlockFor("Mana yang lebih baik, betik atau tembikai?", data());
    expect(fruit).toContain("Pepaya, segar (ER073)");
    expect(fruit).toContain("Semangka, segar (ER105)");
    expect(await foodBlockFor("Boleh saya makan pisang ambon malam ini?", data())).toContain("Pisang ambon, segar (ER074)");
    const banding = await foodBlockFor("Tolong banding melon dengan semangka untuk protein", data());
    expect(banding).toContain("Ranked by protein per 100 g (highest first): 1. Melon, segar 0.6; 2. Semangka, segar 0.5");
  });

  test("id single food with a cue: boleh makan / cocok", async () => {
    const block = await foodBlockFor("Boleh makan pisang ambon malam ini?", data());
    expect(block).toContain("Pisang ambon, segar, 90 g");
    expect(block).toContain("left today after it: kcal 1493");
    expect(await foodBlockFor("Apakah apel cocok untuk target saya?", data())).toContain("Apel, segar (ER004)");
  });
});

describe("no cue, no food, no block", () => {
  test("a food named without a food-choice cue is not preseeded", async () => {
    expect(await foodBlockFor("Saya makan pepaya tadi pagi", data())).toBeNull();
  });

  test("a cue with no food of ours, and non-questions, give null", async () => {
    expect(await foodBlockFor("Which is better, today or tomorrow?", data())).toBeNull();
    expect(await foodBlockFor("hello", data())).toBeNull();
    expect(await foodBlockFor("", data())).toBeNull();
    expect(await foodBlockFor("   ", data())).toBeNull();
  });

  test("an unknown name is left out and the block says unlisted foods are unknown", async () => {
    const block = await foodBlockFor("Mana lebih baik kue lapis surga xyz atau melon?", data());
    expect(block).toContain("Melon, segar (ER067)");
    expect(block).not.toContain("kue lapis");
    expect(block).toContain("not in our data");
  });

  test("an ambiguous word is offered as candidates, never guessed", async () => {
    const block = await foodBlockFor("Boleh makan pisang?", data());
    expect(block).toContain("Several rows match (ask which one, do not pick): pisang ->");
    expect(block).not.toContain("kcal");
  });

  test("a multi-word name wins over its first word", async () => {
    const block = await foodBlockFor("Lebih baik nasi merah atau nasi putih?", data());
    expect(block?.match(/\(AP00\d\)/g)).toEqual(["(AP005)", "(AP001)"]);
  });
});

describe("limits and failure", () => {
  test("at most 6 foods, and a capped block", async () => {
    const block = await foodBlockFor("Mana yang lebih baik: pepaya, melon, semangka, apel, jeruk, mangga, nanas, durian?", data());
    const rows = block?.split("\n").filter((l) => /\((ER|AP)\d+\)/.test(l)) ?? [];
    expect(rows.length).toBe(FOOD_BLOCK_LIMITS.maxFoods);
    expect((block ?? "").length).toBeLessThanOrEqual(FOOD_BLOCK_LIMITS.maxChars);
  });

  test("a failing day read only drops the 'left today' parts", async () => {
    const rpc = fakeRpc();
    rpc.daySummary = async () => {
      throw new Error("down");
    };
    const block = await foodBlockFor("Boleh makan pisang ambon?", data(rpc));
    expect(block).toContain("Pisang ambon, segar, 90 g");
    expect(block).not.toContain("left today after it");
  });

  test("no usualGrams: the typical portion is used", async () => {
    const rpc = fakeRpc();
    delete rpc.recentFoods;
    const block = await foodBlockFor("Lebih baik nasi putih atau nasi merah?", data(rpc));
    expect(block).toContain("Nasi, 150 g (1 typical serving of nasi putih)");
  });
});
