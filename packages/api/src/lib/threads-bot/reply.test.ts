import { describe, expect, test } from "bun:test";

import {
  LOW_CONFIDENCE,
  MAX_REPLY_CHARS,
  REPLY_LINK,
  UNCLEAR_REPLY,
  cleanDishName,
  formatEstimate,
  isLowConfidence,
  kcalRange,
  replyTextProblem,
} from "./reply";

describe("kcalRange", () => {
  test("±band in 10-kcal steps, never below 0", () => {
    expect(kcalRange(500, 0.2)).toEqual({ low: 400, high: 600 });
    expect(kcalRange(333, 0.2)).toEqual({ low: 270, high: 400 });
    expect(kcalRange(5, 0.2)).toEqual({ low: 0, high: 10 });
    expect(kcalRange(500, 0.1)).toEqual({ low: 450, high: 550 });
  });
});

describe("formatEstimate", () => {
  test("Indonesian reply: a range per dish, the total range, the disclaimer and the campaign link", () => {
    const { text, low, high, dishes } = formatEstimate(
      [
        { name: "Telur mata sapi", kcal: 90 },
        { name: "Nasi goreng", kcal: 500 },
      ],
      0.2,
    );
    expect(text).toContain("• Nasi goreng: 400–600 kcal");
    expect(text).toContain("• Telur mata sapi: 70–110 kcal");
    expect(text.indexOf("Nasi goreng")).toBeLessThan(text.indexOf("Telur mata sapi"));
    expect(text).toContain("Total: 470–710 kcal (±20%)");
    expect(text).toContain("Perkiraan AI, bukan saran medis");
    expect(text).toContain(REPLY_LINK);
    expect(REPLY_LINK).toBe(
      "https://joyorogo.com/?utm_source=threads&utm_medium=reply&utm_campaign=mention-bot",
    );
    expect([low, high]).toEqual([470, 710]);
    expect(dishes.map((d) => [d.name, d.low, d.high])).toEqual([
      ["Nasi goreng", 400, 600],
      ["Telur mata sapi", 70, 110],
    ]);
  });

  test("band comes from config", () => {
    expect(formatEstimate([{ name: "Soto", kcal: 300 }], 0.1).text).toContain(
      "• Soto: 270–330 kcal",
    );
    expect(formatEstimate([{ name: "Soto", kcal: 300 }], 0.1).text).toContain("(±10%)");
  });

  test("never passes 500 characters: ten long dish names fold into '+ N lainnya', the total still counts all", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: `Hidangan panjang nomor ${i + 1} dengan nama yang sangat panjang sekali ya`,
      kcal: 600 - i * 10,
    }));
    const { text, totalKcal } = formatEstimate(items, 0.2);
    expect(text.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(text).toMatch(/\+ \d+ lainnya/);
    expect(totalKcal).toBe(items.reduce((sum, item) => sum + item.kcal, 0));
    expect(text).toContain(REPLY_LINK);
    expect(text).toContain("bukan saran medis");
  });

  test("a plate of three ordinary dishes fits whole", () => {
    const { text } = formatEstimate(
      [
        { name: "Nasi putih", kcal: 200 },
        { name: "Ayam goreng", kcal: 260 },
        { name: "Sambal", kcal: 30 },
      ],
      0.2,
    );
    expect(text.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(text).not.toContain("lainnya");
  });

  test("items without calories are left out", () => {
    const { dishes } = formatEstimate(
      [
        { name: "Air putih", kcal: 0 },
        { name: "Tempe", kcal: 100 },
      ],
      0.2,
    );
    expect(dishes.map((d) => d.name)).toEqual(["Tempe"]);
  });

  test("says nothing about body, weight or health beyond the disclaimer", () => {
    const { text } = formatEstimate([{ name: "Bakso", kcal: 400 }], 0.2);
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
