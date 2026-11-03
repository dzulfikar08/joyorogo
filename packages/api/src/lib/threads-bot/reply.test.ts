import { describe, expect, test } from "bun:test";

import {
  LOW_CONFIDENCE,
  MAX_REPLY_CHARS,
  REPLY_LINK,
  UNCLEAR_REPLY,
  cleanDishName,
  formatEstimate,
  isLowConfidence,
  replyTextProblem,
} from "./reply";

describe("formatEstimate", () => {
  test("Indonesian reply: weight and kcal per dish, the plate's kcal and macros, the disclaimer and the campaign link", () => {
    const { text, totalKcal, totals, dishes } = formatEstimate([
      { name: "Telur mata sapi", kcal: 90, grams: 50, protein: 6.4, carbs: 0.4, fat: 7, fiber: 0 },
      { name: "Nasi goreng", kcal: 500, grams: 300, protein: 12, carbs: 70, fat: 18, fiber: 3 },
    ]);
    expect(text).toContain("• Nasi goreng (300 g): 500 kcal");
    expect(text).toContain("• Telur mata sapi (50 g): 90 kcal");
    expect(text.indexOf("Nasi goreng")).toBeLessThan(text.indexOf("Telur mata sapi"));
    expect(text).toContain("Total: 590 kcal");
    expect(text).toContain("Protein 18 g · Karbo 70 g · Lemak 25 g · Serat 3 g");
    expect(text).toContain("Perkiraan AI, bukan saran medis");
    expect(text).toContain(REPLY_LINK);
    expect(REPLY_LINK).toBe(
      "https://joyorogo.com/?utm_source=threads&utm_medium=reply&utm_campaign=mention-bot",
    );
    expect(totalKcal).toBe(590);
    expect(totals).toEqual({ protein: 18, carbs: 70, fat: 25, fiber: 3 });
    expect(dishes.map((d) => [d.name, d.grams, d.kcal])).toEqual([
      ["Nasi goreng", 300, 500],
      ["Telur mata sapi", 50, 90],
    ]);
  });

  test("a dish the scan gave no weight for is listed without one; missing macros count as 0", () => {
    const { text, totals } = formatEstimate([{ name: "Soto", kcal: 300, protein: 15 }]);
    expect(text).toContain("• Soto: 300 kcal");
    expect(totals).toEqual({ protein: 15, carbs: 0, fat: 0, fiber: 0 });
  });

  test("never passes 500 characters: ten long dish names fold into '+ N lainnya', the total still counts all", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: `Hidangan panjang nomor ${i + 1} dengan nama yang sangat panjang sekali ya`,
      kcal: 600 - i * 10,
    }));
    const { text, totalKcal } = formatEstimate(items);
    expect(text.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(text).toMatch(/\+ \d+ lainnya/);
    expect(totalKcal).toBe(items.reduce((sum, item) => sum + item.kcal, 0));
    expect(text).toContain(REPLY_LINK);
    expect(text).toContain("bukan saran medis");
  });

  test("a plate of three ordinary dishes fits whole", () => {
    const { text } = formatEstimate([
      { name: "Nasi putih", kcal: 200, grams: 150, protein: 4, carbs: 45, fat: 0, fiber: 1 },
      { name: "Ayam goreng", kcal: 260, grams: 120, protein: 25, carbs: 5, fat: 16, fiber: 0 },
      { name: "Sambal", kcal: 30, grams: 20, protein: 0, carbs: 3, fat: 2, fiber: 1 },
    ]);
    expect(text.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(text).not.toContain("lainnya");
  });

  test("items without calories are left out", () => {
    const { dishes } = formatEstimate([
      { name: "Air putih", kcal: 0 },
      { name: "Tempe", kcal: 100 },
    ]);
    expect(dishes.map((d) => d.name)).toEqual(["Tempe"]);
  });

  test("says nothing about body, weight or health beyond the disclaimer", () => {
    const { text } = formatEstimate([{ name: "Bakso", kcal: 400 }]);
    expect(text).not.toMatch(/berat badan|diet|gemuk|kurus|sehat|obesitas|lemak tubuh/i);
  });
});

describe("cleanDishName", () => {
  test("strips mentions, hashtags and links, folds whitespace, caps the length", () => {
    expect(cleanDishName("  Nasi @goreng #enak https://evil.example/x  ")).toBe("Nasi goreng enak");
    expect(cleanDishName("Soto\nAyam\t\u200bLamongan")).toBe("Soto Ayam Lamongan");
    expect(cleanDishName("x".repeat(80)).length).toBeLessThanOrEqual(40);
    expect(cleanDishName("@#")).toBe("Makanan");
  });
});

describe("isLowConfidence", () => {
  test("no usable items, or an average below the threshold", () => {
    expect(isLowConfidence([])).toBe(true);
    expect(isLowConfidence([{ name: "a", kcal: 0 }])).toBe(true);
    expect(isLowConfidence([{ name: "a", kcal: 100, confidence: LOW_CONFIDENCE - 0.1 }])).toBe(
      true,
    );
    expect(
      isLowConfidence([
        { name: "a", kcal: 100, confidence: 0.9 },
        { name: "b", kcal: 50, confidence: 0.2 },
      ]),
    ).toBe(false);
  });

  test("a scan with no confidence at all is trusted", () => {
    expect(isLowConfidence([{ name: "a", kcal: 100 }])).toBe(false);
  });
});

describe("UNCLEAR_REPLY and replyTextProblem", () => {
  test("the polite reply is short, has no numbers and says nothing about the body", () => {
    expect(UNCLEAR_REPLY.length).toBeLessThan(MAX_REPLY_CHARS);
    expect(UNCLEAR_REPLY).not.toMatch(/\d|kcal|berat|diet/i);
  });

  test("an admin text must be 1 to 500 characters", () => {
    expect(replyTextProblem("")).not.toBeNull();
    expect(replyTextProblem("   ")).not.toBeNull();
    expect(replyTextProblem("a".repeat(501))).not.toBeNull();
    expect(replyTextProblem("a".repeat(500))).toBeNull();
  });
});
