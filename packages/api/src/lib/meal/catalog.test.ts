import { describe, expect, test } from "bun:test";

import { TKPI_2019 } from "../tkpi2019-data";
import { catalogProblems, computePortion, ingredientNutrition, ingredientSource, INGREDIENTS, recipeAllergens, recipeById, RECIPES, recipeTags, snapGrams } from "./catalog";

const TKPI = new Map(TKPI_2019.map((row) => [row[0], row]));

describe("recipe catalog", () => {
  test("is sound: ids, steps, languages, TKPI codes, plausible portions", () => {
    expect(catalogProblems()).toEqual([]);
  });

  test("has at least 150 dishes, every kind of meal represented", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(150);
    for (const kind of ["breakfast", "main", "snack"] as const) {
      expect(RECIPES.filter((r) => r.meals.includes(kind)).length).toBeGreaterThanOrEqual(20);
    }
  });

  test("no recipe or ingredient points at a missing TKPI code", () => {
    for (const [key, def] of Object.entries(INGREDIENTS)) {
      if (def.usda) continue;
      expect(TKPI.has(def.code), `${key} -> ${def.code}`).toBe(true);
    }
    for (const recipe of RECIPES) {
      for (const [key] of recipe.ing) expect(INGREDIENTS[key], `${recipe.id} uses ${key}`).toBeDefined();
    }
  });

  test("nutrition is the TKPI/USDA sum of the listed grams, nothing else", () => {
    for (const recipe of RECIPES) {
      let kcal = 0;
      let protein = 0;
      for (const line of computePortion(recipe).lines) {
        const usda = INGREDIENTS[line.key]?.usda;
        const row = TKPI.get(INGREDIENTS[line.key]?.code ?? "");
        kcal += ((usda ? usda.kcal : (row?.[3] ?? 0)) * line.grams) / 100;
        protein += ((usda ? usda.proteinG : (row?.[4] ?? 0)) * line.grams) / 100;
      }
      const { nutrition } = computePortion(recipe);
      expect(nutrition.kcal).toBe(Math.round(kcal));
      expect(nutrition.proteinG).toBeCloseTo(protein, 0);
    }
  });

  test("skinless breast comes from USDA FDC 171077 and every breast dish uses it, not the skin-on TKPI row", () => {
    const def = INGREDIENTS["ayam-dada-tanpa-kulit"];
    expect(def?.usda).toMatchObject({ fdcId: 171077, kcal: 120, proteinG: 22.5, fatG: 2.62, carbsG: 0 });
    expect(ingredientSource("ayam-dada-tanpa-kulit")).toEqual({ kind: "usda", ref: "FDC 171077" });
    expect(ingredientSource("nasi")).toEqual({ kind: "tkpi", ref: "AP001" });
    const n = ingredientNutrition("ayam-dada-tanpa-kulit", 150);
    expect(n.kcal).toBeCloseTo(180, 5);
    expect(n.proteinG).toBeCloseTo(33.75, 5);
    expect(n.fatG).toBeCloseTo(3.93, 5);
    const breast = RECIPES.filter((r) => r.ing.some(([k]) => k === "ayam-dada-tanpa-kulit"));
    expect(breast.length).toBeGreaterThanOrEqual(20);
    for (const r of breast) expect(r.ing.some(([k]) => k === "ayam"), r.id).toBe(false);
    // the TKPI skin-on row stays for thigh and mixed pieces
    expect(INGREDIENTS.ayam?.code).toBe("FR005");
  });

  test("a single ingredient follows the table: 200 g rice is twice the 100 g row", () => {
    const row = TKPI.get("AP001");
    const n = ingredientNutrition("nasi", 200);
    expect(n.kcal).toBeCloseTo(((row?.[3] ?? 0) * 200) / 100, 5);
    expect(n.proteinG).toBeCloseTo(((row?.[4] ?? 0) * 200) / 100, 5);
  });

  test("allergens come from the ingredients, not from the recipe author", () => {
    const withEgg = RECIPES.find((r) => r.ing.some(([k]) => k === "telur-ayam"));
    expect(withEgg && recipeAllergens(withEgg)).toContain("telur");
    const withFish = RECIPES.find((r) => r.ing.some(([k]) => k === "ikan-kembung"));
    expect(withFish && recipeAllergens(withFish)).toContain("seafood");
    const withBread = RECIPES.find((r) => r.ing.some(([k]) => k === "roti-tawar" || k === "roti-gandum"));
    expect(withBread && recipeAllergens(withBread)).toContain("gluten");
  });

  test("carb scaling only moves carb ingredients: half the rice is exactly the rice kcal saved", () => {
    const recipe = RECIPES.find((r) => r.ing.some(([k]) => k === "nasi" || k === "nasi-merah"));
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const full = computePortion(recipe);
    const half = computePortion(recipe, 1, 0.5);
    expect(half.nutrition.kcal).toBeLessThan(full.nutrition.kcal);
    const rice = full.lines.find((l) => l.key === "nasi" || l.key === "nasi-merah");
    const halfRice = half.lines.find((l) => l.key === rice?.key);
    expect(halfRice?.grams).toBeLessThan(rice?.grams ?? 0);
    const others = full.lines.filter((l) => l.key !== rice?.key).map((l) => l.grams);
    expect(half.lines.filter((l) => l.key !== rice?.key).map((l) => l.grams)).toEqual(others);
  });

  test("countable ingredients snap to half pieces, others to 5 g", () => {
    expect(snapGrams("telur-ayam", 82)).toBe(83); // 1.5 eggs of 55 g
    expect(snapGrams("nasi", 137)).toBe(135);
    expect(snapGrams("bawang-putih", 7.4)).toBe(7);
  });

  test("tags are computed: high protein and budget", () => {
    const lean = RECIPES.filter((r) => recipeTags(r).includes("highProtein"));
    expect(lean.length).toBeGreaterThanOrEqual(30);
    expect(RECIPES.filter((r) => recipeTags(r).includes("budget")).length).toBeGreaterThanOrEqual(30);
    expect(RECIPES.filter((r) => r.warung).length).toBeGreaterThanOrEqual(30);
    expect(RECIPES.filter((r) => r.home).length).toBeGreaterThanOrEqual(100);
  });

  test("lookups by id work and ids are unique", () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    const first = RECIPES[0];
    expect(first && recipeById(first.id)).toBe(first);
  });
});
