import { describe, expect, test } from "bun:test";

import { MYFCD_DISHES } from "./myfcd-dishes";
import { calibrateItems, canonicalFood, libraryKcal } from "./tkpi";

const one = (name: string, grams: number, kcal: number, region?: "MY" | "ID" | "SG") =>
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

describe("Singapore reads HPB SG FoodID first", () => {
  test("the Singapore hawker names resolve to their rows", () => {
    expect(one("chicken rice", 346, 509, "SG")).toMatchObject({ kcal: 509, matched: true });
    expect(one("char kway teow", 480, 974, "SG")).toMatchObject({ kcal: 974, matched: true });
    expect(one("roti prata", 71, 246, "SG")).toMatchObject({ kcal: 246, matched: true });
    expect(one("kaya toast", 94, 376, "SG")).toMatchObject({ kcal: 376, matched: true });
    expect(one("bubble tea", 500, 270, "SG")).toMatchObject({ matched: true });
  });

  test("kopi and teh with Singapore ordering words resolve", () => {
    expect(libraryKcal("kopi peng", 400, "SG")).toBeDefined();
    expect(libraryKcal("teh peng", 400, "SG")).toBeDefined();
    expect(libraryKcal("kopi c", 250, "SG")).toBe(130);
  });

  test("Singapore uses the same table as Malaysia and Indonesia stays unchanged", () => {
    expect(one("nasi lemak", 313, 1000, "SG")).toEqual(one("nasi lemak", 313, 1000, "MY"));
    expect(one("roti prata", 71, 900)).toMatchObject({ matched: false });
    expect(canonicalFood("roti prata", "SG")).toBe("roti canai");
  });

  test("Indonesian dishes still resolve for a user in Singapore", () => {
    expect(one("nasi padang", 300, 2000, "SG")).toMatchObject({ matched: true });
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
