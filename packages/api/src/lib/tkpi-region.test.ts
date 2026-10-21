import { describe, expect, test } from "bun:test";

import { MYFCD_DISHES } from "./myfcd-dishes";
import { calibrateItems, canonicalFood, libraryKcal } from "./tkpi";

const one = (name: string, grams: number, kcal: number, region?: "MY" | "ID") =>
  calibrateItems([{ name, grams, kcal }], region ? { region } : undefined)[0]!;

describe("region-aware nutrient source", () => {
  test("Indonesia (default) is unchanged: nasi lemak is still TKPI's nasi uduk band, roti canai is unknown", () => {
    expect(one("nasi lemak", 313, 1000)).toMatchObject({ kcal: 861, matched: true });
    expect(one("nasi lemak", 313, 1000, "ID")).toMatchObject({ kcal: 861, matched: true });
    expect(one("roti canai", 71, 900)).toMatchObject({ matched: false });
  });

  test("Malaysia reads the Malaysian table first", () => {
    // The Malaysian band for a nasi lemak plate runs to 1000 kcal at the typical 313 g.
    expect(one("nasi lemak", 313, 1000, "MY")).toMatchObject({ kcal: 1000, matched: true });
    expect(one("roti canai", 71, 900, "MY")).toMatchObject({ kcal: 390, matched: true });
    expect(one("teh tarik", 250, 400, "MY")).toMatchObject({ kcal: 200, matched: true });
  });

  test("a dish name that contains another row's name is one dish, not a combination", () => {
    expect(one("nasi lemak ayam goreng", 399, 300, "MY")).toMatchObject({ kcal: 540, matched: true });
  });

  test("a genuine two-dish name stays a combination in Malaysia", () => {
    const item = one("roti canai teh tarik", 300, 300, "MY");
    expect(item.matched).toBe(false);
  });

  test("Indonesian dishes still resolve for a user in Malaysia", () => {
    expect(one("nasi padang", 300, 2000, "MY")).toMatchObject({ matched: true });
    expect(one("ayam geprek", 200, 300, "MY")).toMatchObject({ matched: true });
  });

  test("libraryKcal and canonicalFood follow the region", () => {
    expect(libraryKcal("roti canai", 142)).toBeUndefined();
    expect(libraryKcal("roti canai", 142, "MY")).toBe(493);
    expect(canonicalFood("roti prata")).toBe("roti prata");
    expect(canonicalFood("roti prata", "MY")).toBe("roti canai");
  });
});

describe("the Malaysian table", () => {
  test("every row is cited and sane", () => {
    expect(MYFCD_DISHES.length).toBeGreaterThanOrEqual(80);
    for (const dish of MYFCD_DISHES) {
      expect(dish.source.cite.length).toBeGreaterThan(10);
      expect(dish.plausibleKcalRange[0]).toBeLessThan(dish.plausibleKcalRange[1]);
    }
  });

  test("the dishes the launch names are present", () => {
    const keys = new Set(MYFCD_DISHES.flatMap((dish) => [dish.name, ...dish.aliases]));
    for (const dish of [
      "nasi lemak",
      "roti canai",
      "teh tarik",
      "mee goreng mamak",
      "char kuey teow",
      "laksa",
      "milo ais",
      "cendol",
    ]) {
      expect(keys.has(dish)).toBe(true);
    }
  });
});
