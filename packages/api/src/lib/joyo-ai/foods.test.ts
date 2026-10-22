import { describe, expect, test } from "bun:test";

import { amountsFor, atwaterConsistent, choosePortion, compareFoods, fitsToday, lookupFood, searchFoods } from "./foods";
import type { FoodFacts } from "./foods";

const food = (name: string): FoodFacts => {
  const found = lookupFood(name);
  if (!found.ok) throw new Error(`${name} did not resolve (${found.reason})`);
  return found.food;
};

describe("lookupFood: one row of our data, or unknown", () => {
  test.each([
    ["pepaya", "ER073", "Pepaya, segar"],
    ["melon", "ER067", "Melon, segar"],
    ["semangka", "ER105", "Semangka, segar"],
    ["nasi putih", "AP001", "Nasi"],
    ["nasi merah", "AP005", "Nasi beras merah"],
    ["papaya", "ER073", "Pepaya, segar"],
    ["watermelon", "ER105", "Semangka, segar"],
    ["brown rice", "AP005", "Nasi beras merah"],
    ["white rice", "AP001", "Nasi"],
    ["ER073", "ER073", "Pepaya, segar"],
    ["er105", "ER105", "Semangka, segar"],
    ["  Pepaya  ", "ER073", "Pepaya, segar"],
    ["Pisang ambon", "ER074", "Pisang ambon, segar"],
  ])("%s -> %s", (query, code, name) => {
    const found = lookupFood(query);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.food.code).toBe(code);
      expect(found.food.name).toBe(name);
    }
  });

  test("a made-up or empty name is unknown, never a guess", () => {
    expect(lookupFood("kue lapis surga xyz")).toEqual({ ok: false, reason: "no_match", candidates: [] });
    expect(lookupFood("").ok).toBe(false);
    expect(lookupFood("a").ok).toBe(false);
    expect(lookupFood("ER999").ok).toBe(false);
    expect(lookupFood("constructor").ok).toBe(false);
    expect(lookupFood("__proto__").ok).toBe(false);
  });

  test("a name that matches several rows is ambiguous with candidates to ask about", () => {
    const found = lookupFood("pisang");
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.reason).toBe("ambiguous");
      expect(found.candidates.length).toBeGreaterThan(1);
      expect(found.candidates.length).toBeLessThanOrEqual(4);
    }
  });

  test("no loose substring or loose prefix guess", () => {
    // "Anggur hutan" is wild grapes, not grapes; "Kopi bubuk instant" is not brewed coffee.
    expect(lookupFood("anggur").ok).toBe(false);
    expect(lookupFood("kopi").ok).toBe(false);
    expect(lookupFood("pep").ok).toBe(false);
    expect(lookupFood("semang").ok).toBe(false);
  });

  test("a dish-library name resolves to an approximate row with kcal and fiber only", () => {
    const f = food("nasi goreng");
    expect(f.source).toBe("dish");
    expect(f.code).toBeNull();
    expect(f.dataNote).toBe("dish_estimate");
    expect(f.per100g).toMatchObject({ kcal: 180, fiber: 2, protein: null, carbs: null, fat: null, sugar: null });
  });

  test("a USDA ingredient row keeps its own numbers", () => {
    const f = food("skinless chicken breast (raw)");
    expect(f.source).toBe("usda");
    expect(f.code).toBe("FDC171077");
    expect(f.per100g).toMatchObject({ kcal: 120, protein: 22.5, fat: 2.62, carbs: 0, fiber: 0 });
  });

  test("sugar is always unknown", () => {
    for (const q of ["pepaya", "melon", "nasi putih", "nasi goreng"]) expect(food(q).per100g.sugar).toBeNull();
  });
});

describe("Atwater check", () => {
  test("ER073 Pepaya, segar fails (fat 12.0 against 46 kcal): macros withheld, kcal and fiber kept", () => {
    const f = food("pepaya");
    expect(f.dataNote).toBe("macros_inconsistent");
    expect(f.per100g).toEqual({ kcal: 46, protein: null, carbs: null, fat: null, fiber: 1.6, sugar: null });
  });

  test("consistent rows keep their macros", () => {
    expect(food("melon").per100g).toEqual({ kcal: 37, protein: 0.6, carbs: 7.8, fat: 0.4, fiber: 1, sugar: null });
    expect(food("semangka").per100g).toMatchObject({ kcal: 28, protein: 0.5, carbs: 6.9, fat: 0.2, fiber: 0.4 });
    expect(food("nasi putih").dataNote).toBeNull();
  });

  test("the rule: |4P+4C+9F - kcal| > max(25, 0.35 kcal) fails; a missing column cannot fail", () => {
    expect(atwaterConsistent(46, 0.5, 12.2, 12)).toBe(false);
    expect(atwaterConsistent(37, 0.6, 7.8, 0.4)).toBe(true);
    expect(atwaterConsistent(46, null, 12.2, 12)).toBe(true);
    expect(atwaterConsistent(null, 1, 1, 1)).toBe(true);
  });
});

describe("portions: yours, library, piece, asked, else none", () => {
  test("typical dish portion is the library one", () => {
    expect(choosePortion(food("nasi putih"))).toMatchObject({ grams: 150, source: "library" });
  });

  test("an ingredient piece gives its grams and a label", () => {
    const p = choosePortion(food("pisang ambon"));
    expect(p).toMatchObject({ grams: 90, source: "piece" });
    expect(p?.label).toContain("buah");
  });

  test("the person's own usual grams beat library and piece; the caller's grams beat everything", () => {
    expect(choosePortion(food("nasi putih"), { usual: 120 })).toMatchObject({ grams: 120, source: "yours" });
    expect(choosePortion(food("pisang ambon"), { usual: 100 })).toMatchObject({ grams: 100, source: "yours" });
    expect(choosePortion(food("nasi putih"), { usual: 120, asked: 80 })).toMatchObject({ grams: 80, source: "asked" });
  });

  test("a fruit without a library portion has none: null, never an invented one", () => {
    for (const q of ["pepaya", "melon", "semangka", "nasi merah"]) expect(choosePortion(food(q))).toBeNull();
    expect(choosePortion(food("pepaya"), { asked: 150 })).toMatchObject({ grams: 150, source: "asked" });
  });

  test("bad grams are ignored", () => {
    expect(choosePortion(food("pepaya"), { asked: 0 })).toBeNull();
    expect(choosePortion(food("pepaya"), { asked: Number.NaN })).toBeNull();
    expect(choosePortion(food("pepaya"), { usual: -5 })).toBeNull();
  });
});

describe("compareFoods", () => {
  test("pepaya, melon, semangka by fiber: 1.6 > 1.0 > 0.4 per 100 g from the TKPI rows", () => {
    const r = compareFoods(["pepaya", "melon", "semangka"], { by: "fiber" });
    expect(r.per100gRanking).toEqual([
      { rank: 1, name: "Pepaya, segar", value: 1.6 },
      { rank: 2, name: "Melon, segar", value: 1 },
      { rank: 3, name: "Semangka, segar", value: 0.4 },
    ]);
    // No portion in our data for any of them: no per-portion numbers, and the result says to compare per 100 g.
    expect(r.perPortionRanking).toBeNull();
    expect(r.items.every((i) => i.portion === null && i.perPortion === null)).toBe(true);
    expect(r.noPortion).toEqual(["Pepaya, segar", "Melon, segar", "Semangka, segar"]);
    expect(r.notes.join(" ")).toContain("per 100 g");
    expect(r.unknown).toEqual([]);
  });

  test("ER073's macros are withheld as inconsistent while kcal and fiber stay", () => {
    const r = compareFoods(["pepaya", "melon"], { by: "fiber" });
    const pepaya = r.items.find((i) => i.code === "ER073");
    expect(pepaya?.dataNote).toBe("macros_inconsistent");
    expect(pepaya?.per100g).toMatchObject({ kcal: 46, fiber: 1.6, protein: null, carbs: null, fat: null });
    expect(r.notes.join(" ")).toContain("do not add up");
  });

  test("a food withheld for the ranked nutrient is unrankable, not ranked as 0", () => {
    const r = compareFoods(["pepaya", "melon", "semangka"], { by: "protein" });
    expect(r.unrankable).toEqual([{ name: "Pepaya, segar", reason: "value_unknown" }]);
    expect(r.per100gRanking?.map((e) => e.name)).toEqual(["Melon, segar", "Semangka, segar"]);
  });

  test("an unknown food is listed under unknown with a reason and never ranked", () => {
    const r = compareFoods(["pepaya", "kue lapis surga xyz", "melon"], { by: "fiber" });
    expect(r.unknown).toEqual([{ query: "kue lapis surga xyz", reason: "no_match", candidates: [] }]);
    expect(r.items.map((i) => i.name)).toEqual(["Pepaya, segar", "Melon, segar"]);
    expect(JSON.stringify(r.per100gRanking)).not.toContain("kue");
  });

  test("an ambiguous food is unknown with candidates", () => {
    const r = compareFoods(["pisang", "melon"]);
    expect(r.unknown[0]).toMatchObject({ query: "pisang", reason: "ambiguous" });
    expect(r.unknown[0]?.candidates.length).toBeGreaterThan(1);
    expect(r.per100gRanking).toBeNull();
  });

  test("a portion makes a per-portion ranking; typical portions differ per food", () => {
    const r = compareFoods(["nasi putih", "pisang ambon", "pepaya"], { by: "fiber" });
    const rice = r.items.find((i) => i.code === "AP001");
    const banana = r.items.find((i) => i.code === "ER074");
    expect(rice?.portion).toMatchObject({ grams: 150, source: "library" });
    expect(rice?.perPortion).toMatchObject({ kcal: 270, fiber: 0.3 });
    expect(banana?.portion).toMatchObject({ grams: 90, source: "piece" });
    expect(banana?.perPortion?.fiber).toBe(1.7);
    expect(r.perPortionRanking?.map((e) => e.name)).toEqual(["Pisang ambon, segar", "Nasi"]);
    expect(r.noPortion).toEqual(["Pepaya, segar"]);
  });

  test("asked grams (one for all, or one per food) give per-portion for every food", () => {
    const all = compareFoods(["pepaya", "melon", "semangka"], { by: "fiber", grams: 200 });
    expect(all.perPortionRanking?.map((e) => [e.name, e.value])).toEqual([
      ["Pepaya, segar", 3.2],
      ["Melon, segar", 2],
      ["Semangka, segar", 0.8],
    ]);
    expect(all.items.every((i) => i.portion?.source === "asked")).toBe(true);
    const each = compareFoods(["pepaya", "melon"], { by: "kcal", grams: [100, 300] });
    expect(each.perPortionRanking?.map((e) => e.value)).toEqual([111, 46]);
  });

  test("the person's usual grams are used and labelled yours", () => {
    const r = compareFoods(["nasi putih", "nasi merah"], { by: "kcal", usualGrams: [100, 150] });
    expect(r.items.map((i) => [i.portion?.grams, i.portion?.source])).toEqual([
      [100, "yours"],
      [150, "yours"],
    ]);
    expect(r.perPortionRanking?.map((e) => e.name)).toEqual(["Nasi beras merah", "Nasi"]);
  });

  test("nasi merah vs nasi putih per 100 g: kcal, fiber from the rows", () => {
    const r = compareFoods(["nasi merah", "nasi putih"], { by: "fiber" });
    expect(r.per100gRanking).toEqual([
      { rank: 1, name: "Nasi beras merah", value: 0.3 },
      { rank: 2, name: "Nasi", value: 0.2 },
    ]);
    expect(r.items.map((i) => i.per100g.kcal)).toEqual([149, 180]);
  });

  test("ties share a rank", () => {
    const r = compareFoods(["melon", "melon", "semangka"], { by: "fiber" });
    expect(r.per100gRanking?.map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  test("ranking by sugar says we have no sugar data and ranks nothing", () => {
    const r = compareFoods(["pepaya", "melon"], { by: "sugar" });
    expect(r.per100gRanking).toBeNull();
    expect(r.perPortionRanking).toBeNull();
    expect(r.notes.join(" ")).toContain("no sugar");
    expect(r.items.every((i) => i.per100g.sugar === null)).toBe(true);
  });
});

describe("fitsToday", () => {
  const remaining = { kcal: 500, protein: 20, carbs: 80, fat: 15, fiber: 6 };

  test("amounts and what is left, with over flags", () => {
    const fit = fitsToday(food("nasi putih"), 150, remaining);
    expect(fit.amounts).toEqual({ kcal: 270, protein: 4.5, carbs: 59.7, fat: 0.5, fiber: 0.3 });
    expect(fit.after).toEqual({ kcal: 230, protein: 15.5, carbs: 20.3, fat: 14.5, fiber: 5.7 });
    expect(fit.over.kcal).toBe(false);
    const big = fitsToday(food("nasi putih"), 400, remaining);
    expect(big.after.kcal).toBe(-220);
    expect(big.over.kcal).toBe(true);
    expect(big.over.carbs).toBe(true);
    expect(big.over.fiber).toBe(false);
  });

  test("a nutrient that is unknown (withheld macros, no target) is null, never 0 or false", () => {
    const fit = fitsToday(food("pepaya"), 150, remaining);
    expect(fit.amounts).toEqual({ kcal: 69, protein: null, carbs: null, fat: null, fiber: 2.4 });
    expect(fit.after).toEqual({ kcal: 431, protein: null, carbs: null, fat: null, fiber: 3.6 });
    expect(fit.over).toEqual({ kcal: false, protein: null, carbs: null, fat: null, fiber: false });
    const noTarget = fitsToday(food("melon"), 100, { ...remaining, fiber: null });
    expect(noTarget.after.fiber).toBeNull();
    expect(noTarget.over.fiber).toBeNull();
  });

  test("amountsFor scales per 100 g", () => {
    expect(amountsFor(food("melon"), 250)).toEqual({ kcal: 93, protein: 1.5, carbs: 19.5, fat: 1, fiber: 2.5 });
  });
});

describe("searchFoods", () => {
  test("pepaya finds the fruit first, at most 8 candidates", () => {
    const hits = searchFoods("pepaya");
    expect(hits[0]).toMatchObject({ code: "ER073", name: "Pepaya, segar" });
    expect(hits.length).toBeLessThanOrEqual(8);
    expect(searchFoods("nasi", 3).length).toBeLessThanOrEqual(3);
    expect(searchFoods("nasi", 100).length).toBeLessThanOrEqual(8);
  });

  test("a made-up word has no candidates; english names go through the ingredient names", () => {
    expect(searchFoods("zzzzqqq")).toEqual([]);
    expect(searchFoods("")).toEqual([]);
    expect(searchFoods("watermelon")[0]?.code).toBe("ER105");
  });
});
