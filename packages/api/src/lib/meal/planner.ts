// The deterministic day planner. Pure: everything it needs comes in as arguments, so the same inputs (and seed) give
// the same day on every call. Algorithm and constants are documented in docs/meal-plan.md.
//
//   1. Candidates: every catalog recipe in a handful of portion sizes (whole portion x0.5..x1.5, carbs x0.5..x1.5 =
//      "nasi 1/2 porsi"), plus the foods the person already eats (their own logged numbers). Allergens, dislikes and
//      the cook/buy choice are hard filters; "no same main more than twice a week" is a hard cap.
//   2. Each slot gets a shortlist: the candidates closest to the slot's share of the day's budget, scored for protein
//      density, history, lighter-version and budget fit, plus a small seeded jitter so another seed gives another day.
//   3. The days' combinations of the shortlists are searched exhaustively and scored on the WHOLE day: kcal within the
//      budget (asymmetric: over costs more than under), protein at or above the target, carbs/fat inside their ranges.

import type { Meal } from "../engine";
import { computePortion, INGREDIENTS, recipeAllergens, recipeById, RECIPES } from "./catalog";
import type { Portion } from "./catalog";
import { habitKinds } from "./history";
import type { HabitFood, HistoryIndex } from "./history";
import { hasPhrase, nameHitsAllergen, normName, unit } from "./text";
import type { Allergen, MealKind, Nutrition, PlannedItem, PlannedSlot, RecipeDef } from "./types";

/** Where the food comes from: only dishes practical at home, only dishes found ready-made, or both. */
export type CookPref = "cook" | "buy" | "mixed";

/** Whether one planned meal is suggested as something to cook or to buy ready-made. */
export type MealMode = "cook" | "buy";

/**
 * Reads a stored or sent cook preference. Rows and old app versions from before the three-way choice hold
 * 'any' (now 'mixed') and 'warung' (now 'buy'); anything unknown is 'mixed'.
 */
export function normalizeCookPref(value: unknown): CookPref {
  if (value === "cook") return "cook";
  if (value === "buy" || value === "warung") return "buy";
  return "mixed";
}

/** A dish that takes this many minutes or less is worth cooking when the person has no strong preference. */
export const QUICK_COOK_MINUTES = 20;

/**
 * Cook or buy suggestion for one meal. A dish only practical at home is cooked, one only found ready-made is bought;
 * a dish that is both follows the preference, and with 'mixed' is cooked when it is quick. A food the person logs
 * themselves has no recipe, so it is a buy suggestion.
 */
export function mealMode(recipe: Pick<RecipeDef, "home" | "warung" | "minutes"> | null, cookPref: CookPref): MealMode {
  if (!recipe) return "buy";
  if (recipe.home && !recipe.warung) return "cook";
  if (recipe.warung && !recipe.home) return "buy";
  if (cookPref === "cook") return "cook";
  if (cookPref === "buy") return "buy";
  return recipe.minutes <= QUICK_COOK_MINUTES ? "cook" : "buy";
}

export type PlanPrefs = {
  allergens: Allergen[];
  dislikes: string[];
  budgetFriendly: boolean;
  cookPref: CookPref;
};

export const DEFAULT_PREFS: PlanPrefs = { allergens: [], dislikes: [], budgetFriendly: false, cookPref: "mixed" };

/** Which kinds of recipe each slot accepts. */
export const SLOT_KINDS: Record<Meal, MealKind[]> = {
  sarapan: ["breakfast"],
  sahur: ["breakfast", "main"],
  makan_siang: ["main"],
  makan_malam: ["main"],
  berbuka: ["main", "snack"],
  snack: ["snack"],
};

/** Share of the day's budget per slot in a normal day. Ramadan and fasting windows pass their own. */
export const NORMAL_SHARES: Partial<Record<Meal, number>> = { sarapan: 0.25, makan_siang: 0.35, makan_malam: 0.3, snack: 0.1 };

/** Carbs and fat as a share of the day's kcal (AMDR-style ranges; protein is a floor, not a range). */
export const CARB_RANGE: [number, number] = [0.4, 0.6];
export const FAT_RANGE: [number, number] = [0.2, 0.35];

/** Hits the budget when within this share of it (the promise of the feature). */
export const BUDGET_TOLERANCE = 0.05;

/** Times one dish may appear in a 7-day plan. */
export const WEEK_CAP: Record<MealKind, number> = { main: 2, breakfast: 3, snack: 3 };

const SCALES = [0.5, 0.75, 1, 1.25, 1.5];
const CARB_SCALES = [0.5, 0.75, 1, 1.5];
const SHORTLIST = 16;

export const zeroNutrition = (): Nutrition => ({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });

export function addNutrition(a: Nutrition, b: Nutrition): Nutrition {
  return {
    kcal: a.kcal + b.kcal,
    proteinG: a.proteinG + b.proteinG,
    carbsG: a.carbsG + b.carbsG,
    fatG: a.fatG + b.fatG,
    fiberG: a.fiberG + b.fiberG,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function roundNutrition(n: Nutrition): Nutrition {
  return { kcal: Math.round(n.kcal), proteinG: round1(n.proteinG), carbsG: round1(n.carbsG), fatG: round1(n.fatG), fiberG: round1(n.fiberG) };
}

// --- Candidates ---------------------------------------------------------------------------------------------

type Variant = { scale: number; carbScale: number; portion: Portion };

const VARIANTS = new Map<string, Variant[]>();

/** The portion sizes worth offering for a recipe, duplicates (same amounts after snapping) removed. */
function variantsOf(recipe: RecipeDef): Variant[] {
  const cached = VARIANTS.get(recipe.id);
  if (cached) return cached;
  const hasCarb = recipe.ing.some(([key]) => INGREDIENTS[key]?.role === "carb");
  const out: Variant[] = [];
  const seen = new Set<string>();
  for (const scale of SCALES) {
    for (const carbScale of hasCarb ? CARB_SCALES : [1]) {
      // keep the extremes sane: a half portion with half the carbs, or 1.5x with 1.5x carbs, is a different dish size
      if ((scale < 0.75 && carbScale < 1) || (scale > 1.25 && carbScale > 1)) continue;
      const portion = computePortion(recipe, scale, carbScale);
      const sig = portion.lines.map((l) => l.grams).join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ scale, carbScale, portion });
    }
  }
  VARIANTS.set(recipe.id, out);
  return out;
}

export type Candidate = {
  ref: string;
  item: PlannedItem;
  n: Nutrition;
  kinds: MealKind[];
  /** the main protein ingredient or the habit's name: two items of the same kind in a day are discouraged */
  mainKey: string;
  cost: 1 | 2 | 3;
  /** negative = preferred (history / lighter version) */
  pref: number;
  weekKind: MealKind;
  isHabit: boolean;
};

function mainKeyOf(recipe: RecipeDef): string {
  let best = "";
  let bestKcal = -1;
  for (const [key, grams] of recipe.ing) {
    const def = INGREDIENTS[key];
    if (def?.role !== "protein") continue;
    if (grams > bestKcal) {
      bestKcal = grams;
      best = key;
    }
  }
  return best || recipe.id;
}

export function recipeAllowed(recipe: RecipeDef, prefs: PlanPrefs): boolean {
  if (prefs.cookPref === "cook" && !recipe.home) return false;
  if (prefs.cookPref === "buy" && !recipe.warung) return false;
  if (recipeAllergens(recipe).some((a) => prefs.allergens.includes(a))) return false;
  if (prefs.dislikes.length > 0) {
    const text = new Set<string>([normName(recipe.name.id), normName(recipe.name.en)]);
    for (const [key, grams] of recipe.ing) {
      const def = INGREDIENTS[key];
      if (!def) continue;
      if (def.role === "flavor" && grams < 15) continue;
      text.add(normName(def.name.id));
      text.add(normName(def.name.en));
    }
    for (const word of prefs.dislikes) {
      const w = normName(word);
      if (w && [...text].some((t) => hasPhrase(t, w) || t.includes(w))) return false;
    }
  }
  return true;
}

export function habitAllowed(food: HabitFood, prefs: PlanPrefs): boolean {
  if (nameHitsAllergen(food.norm, prefs.allergens)) return false;
  return !prefs.dislikes.some((d) => {
    const w = normName(d);
    return w.length > 0 && food.norm.includes(w);
  });
}

/** Is a saved plan item still fine for these preferences? (A swapped-in meal is dropped when it now breaks an allergy.) */
export function itemAllowed(item: PlannedItem, prefs: PlanPrefs): boolean {
  if (item.habit) {
    return habitAllowed({ name: item.habit.name, norm: normName(item.habit.name), times: item.habit.times, kcal: item.habit.kcal, proteinG: item.habit.proteinG, carbsG: item.habit.carbsG, fatG: item.habit.fatG, grams: item.habit.grams, slots: [] }, prefs);
  }
  const recipe = recipeById(item.ref.slice(2));
  return recipe ? recipeAllowed(recipe, prefs) : false;
}

export const recipeRef = (id: string) => `r:${id}`;
export const habitRef = (norm: string) => `h:${norm}`;

/** Bonus (as a negative cost) for dishes the person already eats and for lighter versions of what they eat. */
function preferenceOf(recipe: RecipeDef, index: HistoryIndex): number {
  let pref = 0;
  const eaten = index.affinity.get(recipe.id);
  if (eaten) pref -= 10 + 3 * Math.min(eaten.times, 8);
  const lighter = index.better.get(recipe.id);
  if (lighter) pref -= 8 + 2 * Math.min(lighter.times, 8);
  return pref;
}

/** All candidates for the given kinds, filtered by the person's preferences. Cached per call by the caller. */
export function buildCandidates(prefs: PlanPrefs, index: HistoryIndex, recipes: RecipeDef[] = RECIPES): Candidate[] {
  const out: Candidate[] = [];
  for (const recipe of recipes) {
    if (!recipeAllowed(recipe, prefs)) continue;
    const pref = preferenceOf(recipe, index);
    const mainKey = mainKeyOf(recipe);
    const weekKind: MealKind = recipe.meals.includes("main") ? "main" : recipe.meals.includes("breakfast") ? "breakfast" : "snack";
    for (const v of variantsOf(recipe)) {
      out.push({
        ref: recipeRef(recipe.id),
        item: { ref: recipeRef(recipe.id), scale: v.scale, carbScale: v.carbScale },
        n: v.portion.nutrition,
        kinds: recipe.meals,
        mainKey,
        cost: recipe.cost,
        pref,
        weekKind,
        isHabit: false,
      });
    }
  }
  for (const food of index.unmatched) {
    if (!habitAllowed(food, prefs)) continue;
    const kinds = habitKinds(food);
    for (const scale of [0.5, 0.75, 1]) {
      const n: Nutrition = {
        kcal: Math.round(food.kcal * scale),
        proteinG: round1(food.proteinG * scale),
        carbsG: round1(food.carbsG * scale),
        fatG: round1(food.fatG * scale),
        fiberG: 0,
      };
      out.push({
        ref: habitRef(food.norm),
        item: {
          ref: habitRef(food.norm),
          scale,
          carbScale: 1,
          habit: { name: food.name, kcal: food.kcal, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, grams: food.grams, times: food.times },
        },
        n,
        kinds,
        mainKey: `habit:${food.norm}`,
        cost: 2,
        pref: -(12 + 3 * Math.min(food.times, 8)),
        weekKind: kinds[0] ?? "main",
        isHabit: true,
      });
    }
  }
  return out;
}

// --- The day -------------------------------------------------------------------------------------------------

export type DayInput = {
  date: string;
  /** reproducible jitter: same seed + same inputs = same day */
  seed: string;
  budgetKcal: number;
  proteinG: number;
  /** slots to fill, with their share of the remaining budget (normalised here) */
  slots: { slot: Meal; share: number }[];
  /** already eaten today, plus pinned items that stay: counts toward the day, not planned again */
  fixed: Nutrition;
  prefs: PlanPrefs;
  candidates: Candidate[];
  /** uses of each ref in the other days of the plan */
  weekUsage: Map<string, number>;
  /** refs of the previous day: avoided to keep consecutive days different */
  prevRefs: Set<string>;
  /** refs not to be picked this day (swapped away, or already used by a pinned item) */
  blocked?: Set<string>;
  /** caps may be loosened when nothing else fits; set by the caller's retry */
  capBonus?: number;
};

export type DayPlan = {
  slots: PlannedSlot[];
  total: Nutrition;
  /** score of the day (lower is better); exposed for tests */
  cost: number;
};

/** `s` ranks the shortlist; `ic` is the item's own cost in the day search (computed once, the jitter hash is not free). */
type Scored = { c: Candidate; s: number; ic: number };

function dayCostOf(kcal: number, proteinTotal: number, carbsG: number, fatG: number, fiberG: number, budgetKcal: number, proteinG: number): number {
  const err = budgetKcal > 0 ? (kcal - budgetKcal) / budgetKcal : 0;
  const over = Math.max(0, err) * 100;
  const under = Math.max(0, -err) * 100;
  // over the budget is the worse miss: heavy from +3%, under from -5%
  let cost = over * 1.4 + Math.max(0, over - 3) * 30 + under + Math.max(0, under - 5) * 18;
  const gap = proteinG > 0 ? Math.max(0, (proteinG - proteinTotal) / proteinG) * 100 : 0;
  cost += gap * 3.5;
  if (kcal > 0) {
    const carb = (carbsG * 4) / kcal;
    const fat = (fatG * 9) / kcal;
    cost += 100 * Math.max(0, CARB_RANGE[0] - carb, carb - CARB_RANGE[1]);
    cost += 150 * Math.max(0, FAT_RANGE[0] - fat, fat - FAT_RANGE[1]);
  }
  // far more protein than asked is not a goal either: it only makes the portions odd
  if (proteinG > 0) cost += Math.max(0, proteinTotal / proteinG - 1.25) * 150;
  cost -= 0.15 * Math.min(fiberG, 30);
  return cost;
}

const dayCost = (total: Nutrition, budgetKcal: number, proteinG: number): number =>
  dayCostOf(total.kcal, total.proteinG, total.carbsG, total.fatG, total.fiberG, budgetKcal, proteinG);

/** A normal portion is the default: every quarter step away from it costs a little, so sizes change only when it helps. */
function portionPenalty(item: PlannedItem): number {
  return (Math.abs(item.scale - 1) / 0.25) * 3 + (Math.abs(item.carbScale - 1) / 0.25) * 2;
}

const itemCost = (c: Candidate, input: DayInput, slot: Meal): number => {
  let cost = c.pref + portionPenalty(c.item);
  if (input.prefs.budgetFriendly) cost += c.cost === 3 ? 12 : c.cost === 2 ? 4 : 0;
  if (input.prevRefs.has(c.ref)) cost += 25;
  const used = input.weekUsage.get(c.ref) ?? 0;
  if (used > 0) cost += 6 * used;
  cost += 6 * unit(`${input.seed}|${input.date}|${slot}|${c.item.scale}|${c.item.carbScale}|${c.ref}`);
  return cost;
};

function shortlist(slot: Meal, budget: number, proteinPerKcal: number, input: DayInput): Scored[] {
  const kinds = SLOT_KINDS[slot];
  const bestPerRef = new Map<string, Scored[]>();
  for (const c of input.candidates) {
    if (!c.kinds.some((k) => kinds.includes(k))) continue;
    if (input.blocked?.has(c.ref)) continue;
    const cap = WEEK_CAP[c.weekKind] + (input.capBonus ?? 0);
    if ((input.weekUsage.get(c.ref) ?? 0) >= cap) continue;
    if (c.n.kcal < budget * 0.45 || c.n.kcal > budget * 1.7) continue;
    const fit = Math.abs(c.n.kcal - budget) / budget;
    const need = budget * proteinPerKcal;
    const protGap = need > 0 ? Math.max(0, need - c.n.proteinG) / need : 0;
    const ic = itemCost(c, input, slot);
    const s = 40 * fit + 28 * protGap + ic;
    const list = bestPerRef.get(c.ref);
    if (list) list.push({ c, s, ic });
    else bestPerRef.set(c.ref, [{ c, s, ic }]);
  }
  // up to 3 portion sizes per dish, so the search can fine-tune the day without one dish crowding the list
  const flat: Scored[] = [];
  for (const list of bestPerRef.values()) flat.push(...list.toSorted((a, b) => a.s - b.s).slice(0, 3));
  return flat.toSorted((a, b) => a.s - b.s || a.c.item.ref.localeCompare(b.c.item.ref)).slice(0, SHORTLIST);
}

/**
 * Plan the open slots of one day. Returns the chosen items in `input.slots` order (a slot nobody fits is left out).
 */
export function planDay(input: DayInput): DayPlan {
  const { slots } = input;
  const shareSum = slots.reduce((sum, s) => sum + s.share, 0);
  const remainingKcal = Math.max(0, input.budgetKcal - input.fixed.kcal);
  const remainingProtein = Math.max(0, input.proteinG - input.fixed.proteinG);
  const proteinPerKcal = remainingKcal > 0 ? remainingProtein / remainingKcal : 0;
  if (slots.length === 0 || shareSum <= 0 || remainingKcal < 60) {
    return { slots: [], total: input.fixed, cost: dayCost(input.fixed, input.budgetKcal, input.proteinG) };
  }
  const lists = slots.map(({ slot, share }) => ({ slot, list: shortlist(slot, (remainingKcal * share) / shareSum, proteinPerKcal, input) }));
  const filled = lists.filter((l) => l.list.length > 0);
  if (filled.length === 0) return { slots: [], total: input.fixed, cost: dayCost(input.fixed, input.budgetKcal, input.proteinG) };

  // Kcal bounds of what is still to come, to drop combinations that cannot land near the budget. They only decide what is
  // searched: a combination inside the window scores exactly as without them, and if nothing lands inside it the search
  // runs again without them.
  const minK = filled.map((e) => Math.min(...e.list.map((x) => x.c.n.kcal)));
  const maxK = filled.map((e) => Math.max(...e.list.map((x) => x.c.n.kcal)));
  const sufMin = new Array<number>(filled.length + 1).fill(0);
  const sufMax = new Array<number>(filled.length + 1).fill(0);
  for (let i = filled.length - 1; i >= 0; i--) {
    sufMin[i] = (sufMin[i + 1] ?? 0) + (minK[i] ?? 0);
    sufMax[i] = (sufMax[i + 1] ?? 0) + (maxK[i] ?? 0);
  }
  const { kcal: k0, proteinG: p0, carbsG: c0, fatG: f0, fiberG: b0 } = input.fixed;

  const run = (prune: boolean): { cost: number; pick: Scored[] } | null => {
    let best: { cost: number; pick: Scored[] } | null = null;
    const pick: Scored[] = [];
    const usedRefs = new Set<string>();
    const mainKeys = new Map<string, number>();
    let habits = 0;
    const rec = (i: number, kcal: number, prot: number, carbs: number, fat: number, fiber: number, base: number) => {
      if (i === filled.length) {
        const cost = dayCostOf(kcal, prot, carbs, fat, fiber, input.budgetKcal, input.proteinG) + base;
        if (!best || cost < best.cost) best = { cost, pick: [...pick] };
        return;
      }
      if (prune && (kcal + (sufMin[i] ?? 0) > input.budgetKcal * 1.12 || kcal + (sufMax[i] ?? 0) < input.budgetKcal * 0.88)) return;
      const entry = filled[i];
      if (!entry) return;
      for (const scored of entry.list) {
        const c = scored.c;
        if (usedRefs.has(c.ref)) continue;
        if (c.isHabit && habits >= 2) continue;
        const repeats = mainKeys.get(c.mainKey) ?? 0;
        usedRefs.add(c.ref);
        mainKeys.set(c.mainKey, repeats + 1);
        if (c.isHabit) habits++;
        pick.push(scored);
        rec(i + 1, kcal + c.n.kcal, prot + c.n.proteinG, carbs + c.n.carbsG, fat + c.n.fatG, fiber + c.n.fiberG, base + scored.ic + repeats * 14);
        pick.pop();
        if (c.isHabit) habits--;
        mainKeys.set(c.mainKey, repeats);
        usedRefs.delete(c.ref);
      }
    };
    rec(0, k0, p0, c0, f0, b0, 0);
    return best;
  };
  const chosen = run(true) ?? run(false);
  if (!chosen) return { slots: [], total: input.fixed, cost: dayCost(input.fixed, input.budgetKcal, input.proteinG) };
  const out: PlannedSlot[] = [];
  let total = input.fixed;
  filled.forEach((entry, i) => {
    const c = chosen.pick[i]?.c;
    if (!c) return;
    out.push({ slot: entry.slot, item: { ...c.item } });
    total = addNutrition(total, c.n);
  });
  // keep the caller's slot order
  out.sort((a, b) => slots.findIndex((s) => s.slot === a.slot) - slots.findIndex((s) => s.slot === b.slot));
  return { slots: out, total, cost: chosen.cost };
}

/** Nutrition of a planned item, from TKPI (recipes) or the person's own logged numbers (habit foods). */
export function itemNutrition(item: PlannedItem): Nutrition {
  if (item.habit) {
    return {
      kcal: Math.round(item.habit.kcal * item.scale),
      proteinG: round1(item.habit.proteinG * item.scale),
      carbsG: round1(item.habit.carbsG * item.scale),
      fatG: round1(item.habit.fatG * item.scale),
      fiberG: 0,
    };
  }
  const recipe = item.ref.startsWith("r:") ? recipeById(item.ref.slice(2)) : undefined;
  if (!recipe) return zeroNutrition();
  return computePortion(recipe, item.scale, item.carbScale).nutrition;
}

/** Does the day meet its promise: kcal within the tolerance of the budget, protein at or above the target? */
export function dayMeets(total: Nutrition, budgetKcal: number, proteinG: number): { kcal: boolean; protein: boolean } {
  return {
    kcal: budgetKcal <= 0 || Math.abs(total.kcal - budgetKcal) / budgetKcal <= BUDGET_TOLERANCE,
    protein: total.proteinG >= proteinG,
  };
}

// --- Swaps ---------------------------------------------------------------------------------------------------

/** How close an alternative must be to the item it replaces. */
export const SWAP_KCAL_TOLERANCE = 0.2;
export const SWAP_PROTEIN_FLOOR = 0.8;

export type Alternative = { item: PlannedItem; n: Nutrition; distance: number };

/**
 * Alternatives for one slot: same kind of meal, kcal within 20% and at least 80% of the protein (or no more than 3 g
 * short), closest first (kcal and protein distance, then preference), never the current item or one in `exclude`.
 */
export function alternativesFor(args: {
  slot: Meal;
  current: PlannedItem;
  candidates: Candidate[];
  exclude: Set<string>;
  seed: string;
  limit: number;
}): Alternative[] {
  const cur = itemNutrition(args.current);
  const kinds = SLOT_KINDS[args.slot];
  const best = new Map<string, Alternative & { score: number }>();
  for (const c of args.candidates) {
    if (c.ref === args.current.ref || args.exclude.has(c.ref)) continue;
    if (!c.kinds.some((k) => kinds.includes(k))) continue;
    if (Math.abs(c.n.kcal - cur.kcal) > cur.kcal * SWAP_KCAL_TOLERANCE) continue;
    if (c.n.proteinG < Math.min(cur.proteinG * SWAP_PROTEIN_FLOOR, cur.proteinG - 3)) continue;
    const distance = Math.abs(c.n.kcal - cur.kcal) / Math.max(cur.kcal, 1) + Math.abs(c.n.proteinG - cur.proteinG) / Math.max(cur.proteinG, 8);
    const score = distance * 20 + c.pref + 3 * unit(`${args.seed}|swap|${c.ref}`);
    const prior = best.get(c.ref);
    if (!prior || score < prior.score) best.set(c.ref, { item: c.item, n: c.n, distance, score });
  }
  return [...best.values()]
    .toSorted((a, b) => a.score - b.score || a.item.ref.localeCompare(b.item.ref))
    .slice(0, args.limit)
    .map(({ item, n, distance }) => ({ item, n, distance }));
}
