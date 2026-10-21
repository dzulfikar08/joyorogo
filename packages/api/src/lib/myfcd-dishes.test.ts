import { describe, expect, test } from "bun:test";

import { MYFCD_DISHES } from "./myfcd-dishes";

const LOW_ENERGY_DRINKS: Record<string, true> = {
  "teh o": true,
  "teh o ais": true,
  "kopi o": true,
  "kopi o kosong": true,
  "kopi o ais": true,
};

describe("MYFCD_DISHES", () => {
  test("has at least 80 entries", () => {
    expect(MYFCD_DISHES.length).toBeGreaterThanOrEqual(80);
  });

  test("names are unique, lowercase and non-empty", () => {
    const names = MYFCD_DISHES.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n.length).toBeGreaterThan(0);
      expect(n).toBe(n.toLowerCase());
    }
  });

  test("every alias is unique across the file, lowercase, and never equals a dish name", () => {
    const names = new Set(MYFCD_DISHES.map((d) => d.name));
    const seen = new Map<string, string>();
    for (const d of MYFCD_DISHES) {
      for (const a of d.aliases) {
        expect(a.length).toBeGreaterThan(0);
        expect(a).toBe(a.toLowerCase());
        expect(names.has(a)).toBe(false);
        expect(seen.has(a)).toBe(false);
        seen.set(a, d.name);
      }
    }
  });

  test("every row has a non-empty source citation", () => {
    for (const d of MYFCD_DISHES) {
      expect(d.source.cite.trim().length).toBeGreaterThan(0);
      expect(["myfcd", "hpb", "usda", "published", "derived"]).toContain(d.source.db);
    }
  });

  test("derived rows say which dishes they are computed from", () => {
    for (const d of MYFCD_DISHES.filter((x) => x.source.db === "derived")) {
      expect(d.source.cite).toMatch(/F\d{8}/);
    }
  });

  test("plausible ranges are sane and contain the typical portion for at least 95% of rows", () => {
    let inside = 0;
    for (const d of MYFCD_DISHES) {
      const [min, max] = d.plausibleKcalRange;
      expect(min).toBeGreaterThan(0);
      expect(min).toBeLessThan(max);
      const kcal = (d.kcalPer100g * d.typicalPortionG) / 100;
      if (kcal >= min && kcal <= max) inside++;
    }
    expect(inside / MYFCD_DISHES.length).toBeGreaterThanOrEqual(0.95);
  });

  test("energy density is plausible (20..600 kcal per 100 g, low-energy drinks exempt)", () => {
    for (const d of MYFCD_DISHES) {
      expect(d.kcalPer100g).toBeLessThanOrEqual(600);
      if (!LOW_ENERGY_DRINKS[d.name]) expect(d.kcalPer100g).toBeGreaterThanOrEqual(20);
      else expect(d.kcalPer100g).toBeGreaterThanOrEqual(5);
    }
  });

  test("portions and fibre are positive numbers", () => {
    for (const d of MYFCD_DISHES) {
      expect(d.typicalPortionG).toBeGreaterThan(0);
      expect(d.fiberPer100g).toBeGreaterThanOrEqual(0);
    }
  });
});
