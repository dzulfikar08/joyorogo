import { describe, expect, test } from "bun:test";

import { nameScore, pairItems } from "./scan-match";

describe("eval name matching", () => {
  test("same TKPI dish through an alias matches, different dishes never do", () => {
    expect(nameScore("nasi goreng", "Nasi Goreng")).toBe(1);
    expect(nameScore("nasi", "nasi putih")).toBe(1);
    expect(nameScore("nasi goreng", "nasi putih")).toBe(0);
  });

  test("unknown dishes fall back to token overlap and spelling", () => {
    expect(nameScore("tahu isi", "tahu isi sayur")).toBeGreaterThanOrEqual(0.5);
    expect(nameScore("kerupuk udang", "krupuk udang")).toBeGreaterThanOrEqual(0.5);
    expect(nameScore("es doger", "martabak manis")).toBeLessThan(0.5);
  });

  test("pairing is one-to-one and leaves unmatched items out", () => {
    const pairs = pairItems(
      [
        { name: "nasi putih", grams: 200, kcal: 260 },
        { name: "nasi", grams: 100, kcal: 130 },
        { name: "es doger", kcal: 200 },
      ],
      [{ name: "nasi putih", grams: 150, kcal: 195 }],
    );
    expect(pairs).toHaveLength(1);
  });
});
