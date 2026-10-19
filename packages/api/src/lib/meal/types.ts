// Shared shapes of the "Rencana makan" feature: the recipe catalog (data), the planner (pure) and the API payloads.
// Pure types only, so clients can import them without pulling the catalog.

import type { Meal } from "../engine";

export type L10n = { id: string; en: string };

export const ALLERGENS = ["seafood", "kacang", "telur", "susu", "gluten", "kedelai"] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Where an ingredient is bought: groups the shopping list. */
export const SHOP_CATS = ["karbo", "protein", "sayur", "buah", "susu", "bumbu"] as const;
export type ShopCat = (typeof SHOP_CATS)[number];

/** What an ingredient does on the plate. Only `carb` is scaled by the planner's "nasi 1/2 porsi" step. */
export type IngredientRole = "carb" | "protein" | "veg" | "fruit" | "dairy" | "fat" | "flavor";

/**
 * Nutrition of an ingredient TKPI has no row for (it has no skinless chicken breast), taken from one USDA FoodData Central
 * SR Legacy record (public domain), per 100 g. The record is checked against the FDC API; `description` is its exact name.
 */
export type UsdaSource = {
  fdcId: number;
  description: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
};

export type IngredientDef = {
  /**
   * TKPI 2019 code (lib/tkpi2019-data); the nutrition of every gram of this ingredient comes from that row. For an ingredient
   * with `usda` it is `FDC<id>` and the USDA record is the source instead.
   */
  code: string;
  /** set only when TKPI has no suitable row: the numbers then come from this USDA record */
  usda?: UsdaSource;
  name: L10n;
  cat: ShopCat;
  role: IngredientRole;
  allergens?: Allergen[];
  /** A countable piece ("butir", "potong"): the planner snaps to half pieces and the shopping list counts them. */
  unit?: { name: L10n; grams: number };
  /**
   * What is actually bought when the TKPI row is a cooked one: `ratio` grams of `name` per gram of this row
   * (cooked rice 180 kcal/100 g is 0.4 g of raw rice per g).
   */
  shop?: { name: L10n; ratio: number };
};

/** breakfast fits sarapan/sahur, main fits makan siang/malam/berbuka (and sahur), snack fits snack/berbuka (takjil). */
export const MEAL_KINDS = ["breakfast", "main", "snack"] as const;
export type MealKind = (typeof MEAL_KINDS)[number];

export type RecipeDef = {
  /** kebab-case, unique, stable (stored in saved plans) */
  id: string;
  name: L10n;
  meals: MealKind[];
  /** [ingredient key, grams of that TKPI row in ONE portion]. Nutrition is computed from these, never typed. */
  ing: [string, number][];
  /** 1 = budget (about Rp15.000 or less a portion), 2 = ordinary, 3 = pricey (fish fillet, beef, shrimp) */
  cost: 1 | 2 | 3;
  /** hands-on + cooking minutes when made at home */
  minutes: number;
  /** easy to find ready-made at a warung / rumah makan */
  warung: boolean;
  /** practical to cook at home */
  home: boolean;
  /** 3-6 short steps */
  steps: L10n[];
  /** one practical tip (optional) */
  tip?: L10n;
  /** names people log for this very dish (lowercase, no punctuation): matched against food_log to find habits */
  aka?: string[];
  /**
   * Habit foods this is a lighter version of (lowercase names, e.g. "ayam goreng", "nasi goreng"): when someone
   * eats that often, this recipe is offered as the better version.
   */
  betterOf?: string[];
};

export type RecipeTag = "highProtein" | "budget" | "warung" | "home" | "quick" | "lowFat" | "highFiber";

/** Nutrition of a portion, all computed from TKPI. */
export type Nutrition = { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };

/** One ingredient line of a computed portion. */
export type PortionLine = { key: string; grams: number };

export type MealSlotKey = Meal;

export type PlannedItem = {
  /** 'r:<recipe id>' (catalog) or 'h:<n>' (a food the person already logs, numbers frozen in `habit`) */
  ref: string;
  /** whole-portion multiplier */
  scale: number;
  /** extra multiplier of the carb ingredients only (nasi 1/2 porsi) */
  carbScale: number;
  habit?: { name: string; kcal: number; proteinG: number; carbsG: number; fatG: number; grams: number | null; times: number };
  /** food_log row created by "Sudah makan" */
  logId?: string | null;
  /** the planner kept this item through a replan because the person swapped it in or ate it */
  pinned?: boolean;
};

export type PlannedSlot = { slot: Meal; item: PlannedItem };
export type PlannedDay = { date: string; slots: PlannedSlot[] };
