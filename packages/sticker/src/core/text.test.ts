import { describe, expect, test } from "bun:test";

import { ellipsize, fitText, measureText, sanitizeText } from "./text";
import { TEST_FONTS } from "./test-kit";

const m = TEST_FONTS.metrics("body", 700);

describe("sanitizeText", () => {
  test("strips emoji, joiners, variation selectors and controls", () => {
    expect(sanitizeText("Mie \u{1F35C} ayam \u{1F468}\u200D\u{1F469}\u200D\u{1F467} enak\u2764\uFE0F")).toBe("Mie ayam enak");
    expect(sanitizeText("a\u0000b\u0007c\u200Bd")).toBe("abcd");
    expect(sanitizeText("flag \u{1F1EE}\u{1F1E9} here")).toBe("flag here");
    expect(sanitizeText("1\uFE0F\u20E3 satu")).toBe("1 satu");
  });

  test("drops scripts the fonts cannot draw, keeps Latin and punctuation", () => {
    expect(sanitizeText("Nasi \u5E7F\u4E1C fried")).toBe("Nasi fried");
    expect(sanitizeText("Caf\u00E9 \u201Cquote\u201D \u2013 50% off \u20AC5")).toBe("Caf\u00E9 \u201Cquote\u201D \u2013 50% off \u20AC5");
  });

  test("normalizes whitespace and composes accents", () => {
    expect(sanitizeText("  a \n\t b  ")).toBe("a b");
    expect(sanitizeText("e\u0301")).toBe("\u00E9");
  });

  test("cuts to maxChars with an ellipsis, counting code points", () => {
    const out = sanitizeText("x".repeat(300), 140);
    expect(Array.from(out)).toHaveLength(140);
    expect(out.endsWith("\u2026")).toBe(true);
    expect(sanitizeText("", 10)).toBe("");
  });
});

describe("fitText", () => {
  const size = 50;
  const width = (text: string, s = size) => measureText(text, m, s);

  test("shrink reduces size until it fits, then ellipsizes at the floor", () => {
    const text = "Nasi goreng kampung special";
    const fits = fitText(text, m, { size, minSize: 20, maxWidth: width(text, 30), mode: "shrink", maxLines: 1 });
    expect(fits.size).toBeLessThan(size);
    expect(fits.size).toBeGreaterThanOrEqual(20);
    expect(fits.lines[0]).toBe(text);
    const cut = fitText(text, m, { size, minSize: 40, maxWidth: width(text, 30), mode: "shrink", maxLines: 1 });
    expect(cut.size).toBe(40);
    expect(cut.lines[0]!.endsWith("\u2026")).toBe(true);
    expect(measureText(cut.lines[0]!, m, 40)).toBeLessThanOrEqual(width(text, 30));
  });

  test("ellipsis keeps the size", () => {
    const r = fitText("abcdefghijklmnopqrstuvwxyz", m, { size, minSize: 20, maxWidth: 300, mode: "ellipsis", maxLines: 1 });
    expect(r.size).toBe(size);
    expect(r.lines[0]!.endsWith("\u2026")).toBe(true);
    expect(r.width).toBeLessThanOrEqual(300);
  });

  test("wrap breaks on spaces up to maxLines and ellipsizes the last line", () => {
    const r = fitText("satu dua tiga empat lima enam tujuh delapan", m, { size, minSize: 20, maxWidth: 400, mode: "wrap", maxLines: 2 });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]!.endsWith("\u2026")).toBe(true);
    for (const line of r.lines) expect(measureText(line, m, size)).toBeLessThanOrEqual(400);
  });

  test("a single word wider than the box is cut, not wrapped forever", () => {
    const r = fitText("superkalifragilistik", m, { size, minSize: 20, maxWidth: 200, mode: "wrap", maxLines: 3 });
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBeLessThanOrEqual(200);
  });

  test("infinite width never changes anything; empty and tiny widths do not throw", () => {
    expect(fitText("hello", m, { size, minSize: 20, maxWidth: Infinity, mode: "shrink", maxLines: 1 }).lines).toEqual(["hello"]);
    expect(ellipsize("hello", m, size, 0)).toBe("\u2026");
    expect(fitText("", m, { size, minSize: 20, maxWidth: 10, mode: "wrap", maxLines: 2 }).lines).toBeDefined();
  });

  test("letter spacing counts between glyphs", () => {
    expect(measureText("ab", m, 10, 5)).toBeCloseTo(measureText("ab", m, 10, 0) + 5);
  });
});
