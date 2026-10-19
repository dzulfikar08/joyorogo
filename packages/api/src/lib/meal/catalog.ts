// The recipe catalog: merges the ingredient registry and the recipe parts, and computes every portion's nutrition from
// the TKPI 2019 rows the ingredients point at. Nothing here is typed by hand: change a gram and the numbers follow.

import { TKPI_2019 } from "../tkpi2019-data";
import type { Tkpi2019Row } from "../tkpi2019-data";
import { BASE_INGREDIENTS } from "./ingredients";
import { EXTRA_INGREDIENTS_1, RECIPES_1 } from "./recipes-1";
import { EXTRA_INGREDIENTS_2, RECIPES_2 } from "./recipes-2";
import { EXTRA_INGREDIENTS_3, RECIPES_3 } from "./recipes-3";
import type { Allergen, IngredientDef, Nutrition, PortionLine, RecipeDef, RecipeTag } from "./types";

const TKPI_BY_CODE = new Map<string, Tkpi2019Row>(TKPI_2019.map((row) => [row[0], row]));

function mergeUnique<T>(parts: Record<string, T>[], what: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (key in out) throw new Error(`duplicate ${what} key: ${key}`);
      out[key] = value;
    }
  }
  return out;
}

export const INGREDIENTS: Record<string, IngredientDef> = mergeUnique(
  [BASE_INGREDIENTS, EXTRA_INGREDIENTS_1, EXTRA_INGREDIENTS_2, EXTRA_INGREDIENTS_3],
  "ingredient",
);

export const RECIPES: RecipeDef[] = [...RECIPES_1, ...RECIPES_2, ...RECIPES_3];

const BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

export function recipeById(id: string): RecipeDef | undefined {
  return BY_ID.get(id);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Nutrition of `grams` of one ingredient, straight from its TKPI row (a null column counts as 0: "not detected"). */
export function ingredientNutrition(key: string, grams: number): Nutrition {
  const def = INGREDIENTS[key];
  if (!def) throw new Error(`unknown ingredient: ${key}`);
  const k = grams / 100;
  if (def.usda) {
    const u = def.usda;
    return { kcal: u.kcal * k, proteinG: u.proteinG * k, fatG: u.fatG * k, carbsG: u.carbsG * k, fiberG: u.fiberG * k };
  }
  const row = TKPI_BY_CODE.get(def.code);
  if (!row) throw new Error(`unknown TKPI code: ${key} -> ${def.code}`);
  const [, , , kcal, protein, fat, carbs, fiber] = row;
  return {
    kcal: (kcal ?? 0) * k,
    proteinG: (protein ?? 0) * k,
    fatG: (fat ?? 0) * k,
    carbsG: (carbs ?? 0) * k,
    fiberG: (fiber ?? 0) * k,
  };
}

export type NutritionSource = { kind: "tkpi"; ref: string } | { kind: "usda"; ref: string };

/** Where an ingredient's numbers come from: a TKPI 2019 code, or a USDA FoodData Central record. */
export function ingredientSource(key: string): NutritionSource {
  const def = INGREDIENTS[key];
  return def?.usda ? { kind: "usda", ref: `FDC ${def.usda.fdcId}` } : { kind: "tkpi", ref: def?.code ?? "" };
}

/** Round a scaled amount to something a person can measure: half pieces for countable items, else 5 g (1 g under 25 g). */
export function snapGrams(key: string, grams: number): number {
  const unit = INGREDIENTS[key]?.unit;
  if (unit) {
    const pieces = Math.max(0.5, Math.round((grams / unit.grams) * 2) / 2);
    return Math.round(pieces * unit.grams);
  }
  if (grams >= 25) return Math.round(grams / 5) * 5;
  return Math.max(1, Math.round(grams));
}

export type Portion = {
  lines: PortionLine[];
  grams: number;
  nutrition: Nutrition;
};

/**
 * One portion of `recipe`: every ingredient × `scale`, carb ingredients × `carbScale` as well. Amounts are snapped
 * (snapGrams) and the nutrition is summed from the snapped amounts, so the numbers on screen are exactly what the
 * listed grams contain.
 */
export function computePortion(recipe: RecipeDef, scale = 1, carbScale = 1): Portion {
  const lines: PortionLine[] = [];
  const sum: Nutrition = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  let grams = 0;
  for (const [key, base] of recipe.ing) {
    const factor = scale * (INGREDIENTS[key]?.role === "carb" ? carbScale : 1);
    const g = snapGrams(key, base * factor);
    lines.push({ key, grams: g });
    grams += g;
    const n = ingredientNutrition(key, g);
    sum.kcal += n.kcal;
    sum.proteinG += n.proteinG;
    sum.carbsG += n.carbsG;
    sum.fatG += n.fatG;
    sum.fiberG += n.fiberG;
  }
  return {
    lines,
    grams,
    nutrition: {
      kcal: Math.round(sum.kcal),
      proteinG: round1(sum.proteinG),
      carbsG: round1(sum.carbsG),
      fatG: round1(sum.fatG),
      fiberG: round1(sum.fiberG),
    },
  };
}

/** Allergens of a recipe: the union over its ingredients, so a recipe can never forget one. */
export function recipeAllergens(recipe: RecipeDef): Allergen[] {
  const set = new Set<Allergen>();
  for (const [key] of recipe.ing) for (const a of INGREDIENTS[key]?.allergens ?? []) set.add(a);
  return [...set];
}

/** Tags worked out from the numbers of the base portion (plus the recipe's own flags). */
export function recipeTags(recipe: RecipeDef, nutrition: Nutrition = computePortion(recipe).nutrition): RecipeTag[] {
  const tags: RecipeTag[] = [];
  const proteinShare = nutrition.kcal > 0 ? (nutrition.proteinG * 4) / nutrition.kcal : 0;
  const fatShare = nutrition.kcal > 0 ? (nutrition.fatG * 9) / nutrition.kcal : 0;
  const isSnack = !recipe.meals.includes("main") && !recipe.meals.includes("breakfast");
  if (nutrition.proteinG >= (isSnack ? 10 : 25) || proteinShare >= 0.3) tags.push("highProtein");
  if (recipe.cost === 1) tags.push("budget");
  if (recipe.warung) tags.push("warung");
  if (recipe.home) tags.push("home");
  if (recipe.minutes <= 15) tags.push("quick");
  if (fatShare <= 0.25) tags.push("lowFat");
  if (nutrition.fiberG >= 6) tags.push("highFiber");
  return tags;
}

/** Total protein/kcal ranges a portion of each kind may have; outside means a typo in the grams. */
const KCAL_RANGE = { breakfast: [150, 750], main: [200, 950], snack: [25, 450] } as const;

/** Everything wrong with the catalog, as text. Empty = sound. Used by the tests and by authors while writing recipes. */
export function catalogProblems(recipes: RecipeDef[] = RECIPES): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const [key, def] of Object.entries(INGREDIENTS)) {
    if (def.usda) {
      const u = def.usda;
      if (!(u.fdcId > 0) || !u.description || ![u.kcal, u.proteinG, u.fatG, u.carbsG, u.fiberG].every((n) => Number.isFinite(n) && n >= 0)) {
        problems.push(`ingredient ${key}: incomplete USDA record`);
      }
      if (def.code !== `FDC${u.fdcId}`) problems.push(`ingredient ${key}: code must be FDC${u.fdcId}`);
    } else if (!TKPI_BY_CODE.has(def.code)) problems.push(`ingredient ${key}: TKPI code ${def.code} does not exist`);
    else if (TKPI_BY_CODE.get(def.code)?.[3] == null) problems.push(`ingredient ${key}: TKPI ${def.code} has no kcal`);
    if (!def.name.id || !def.name.en) problems.push(`ingredient ${key}: missing name`);
    if (def.shop && def.shop.ratio <= 0) problems.push(`ingredient ${key}: shop ratio must be > 0`);
  }
  for (const r of recipes) {
    const at = `recipe ${r.id}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id)) problems.push(`${at}: id must be kebab-case`);
    if (ids.has(r.id)) problems.push(`${at}: duplicate id`);
    ids.add(r.id);
    if (!r.name.id || !r.name.en) problems.push(`${at}: missing name`);
    if (r.meals.length === 0) problems.push(`${at}: no meals`);
    if (r.ing.length < 2) problems.push(`${at}: needs at least 2 ingredients`);
    if (r.steps.length < 3 || r.steps.length > 7) problems.push(`${at}: 3-7 steps expected, got ${r.steps.length}`);
    for (const [i, s] of r.steps.entries()) if (!s.id || !s.en) problems.push(`${at}: step ${i + 1} missing a language`);
    if (r.minutes < 1 || r.minutes > 240) problems.push(`${at}: minutes out of range`);
    if (!r.warung && !r.home) problems.push(`${at}: neither warung nor home`);
    const seen = new Set<string>();
    for (const [key, grams] of r.ing) {
      if (!INGREDIENTS[key]) problems.push(`${at}: unknown ingredient ${key}`);
      if (!(grams > 0) || grams > 800) problems.push(`${at}: ${key} grams out of range (${grams})`);
      if (seen.has(key)) problems.push(`${at}: ingredient ${key} listed twice`);
      seen.add(key);
    }
    if (problems.some((p) => p.startsWith(`${at}:`) && p.includes("unknown ingredient"))) continue;
    const { nutrition } = computePortion(r);
    const [lo, hi] = KCAL_RANGE[r.meals.includes("main") ? "main" : r.meals.includes("breakfast") ? "breakfast" : "snack"];
    if (nutrition.kcal < lo || nutrition.kcal > hi) problems.push(`${at}: ${nutrition.kcal} kcal outside ${lo}-${hi} for its meal kind`);
    const atwater = nutrition.proteinG * 4 + nutrition.carbsG * 4 + nutrition.fatG * 9;
    if (nutrition.kcal > 0 && atwater > nutrition.kcal * 1.5) problems.push(`${at}: macros (${Math.round(atwater)} kcal) disagree with kcal ${nutrition.kcal}`);
  }
  return problems;
}
