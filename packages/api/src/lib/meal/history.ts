// What a person already eats, read from their food_log: the planner prefers these foods (they prove the food is
// available to them and liked) and offers lighter versions of the ones they eat often.

import type { Meal } from "../engine";
import { computePortion, RECIPES } from "./catalog";
import { hasPhrase, normName } from "./text";
import type { MealKind, RecipeDef } from "./types";

/** One logged plate (or lone food row) of the last ~60 days, components already summed. */
export type LoggedPlate = {
  name: string;
  meal: Meal;
  date: string;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  grams: number | null;
};

export type HabitFood = {
  name: string;
  norm: string;
  /** distinct logged plates with this name */
  times: number;
  /** average of the logged plates: the person's own numbers */
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  grams: number | null;
  /** slots it is usually eaten in, most frequent first */
  slots: Meal[];
};

/** A food must have been eaten this many times in the window to count as a habit. */
export const MIN_HABIT_TIMES = 3;
/** Below this a logged thing is a drink or a bite, not something to plan a meal around. */
const MIN_HABIT_KCAL = 60;
const MAX_HABIT_KCAL = 1100;
/** A dish is only a "lighter version" of a habit when it is at least this many kcal lighter. */
const MIN_SAVED_KCAL = 80;

/** Groups logged plates by normalised name into habit foods (frequent first). Plates without a protein figure are skipped. */
export function habitFoods(plates: LoggedPlate[]): HabitFood[] {
  const groups = new Map<string, LoggedPlate[]>();
  for (const plate of plates) {
    const norm = normName(plate.name);
    if (norm.length < 3) continue;
    const list = groups.get(norm);
    if (list) list.push(plate);
    else groups.set(norm, [plate]);
  }
  const foods: HabitFood[] = [];
  for (const [norm, list] of groups) {
    if (list.length < MIN_HABIT_TIMES) continue;
    const withProtein = list.filter((p) => p.proteinG !== null);
    if (withProtein.length < MIN_HABIT_TIMES) continue;
    const avg = (pick: (p: LoggedPlate) => number | null, rows: LoggedPlate[]) => {
      const values = rows.map(pick).filter((v): v is number => v !== null);
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
    };
    const kcal = avg((p) => p.kcal, list) ?? 0;
    if (kcal < MIN_HABIT_KCAL || kcal > MAX_HABIT_KCAL) continue;
    const slotCount = new Map<Meal, number>();
    for (const p of list) slotCount.set(p.meal, (slotCount.get(p.meal) ?? 0) + 1);
    const grams = avg((p) => p.grams, list);
    foods.push({
      name: list[0]?.name.trim() ?? norm,
      norm,
      times: list.length,
      kcal: Math.round(kcal),
      proteinG: Math.round((avg((p) => p.proteinG, withProtein) ?? 0) * 10) / 10,
      carbsG: Math.round((avg((p) => p.carbsG, list) ?? 0) * 10) / 10,
      fatG: Math.round((avg((p) => p.fatG, list) ?? 0) * 10) / 10,
      grams: grams === null ? null : Math.round(grams),
      slots: [...slotCount.entries()].toSorted((a, b) => b[1] - a[1]).map(([slot]) => slot),
    });
  }
  return foods.toSorted((a, b) => b.times - a.times || a.norm.localeCompare(b.norm));
}

const namesOf = (recipe: RecipeDef): string[] => [normName(recipe.name.id), ...(recipe.aka ?? []).map(normName)];

/**
 * Does a logged name stand for this dish? Equal names, or a two-word-or-longer name contained whole-word in the other
 * ("nasi goreng spesial" is "nasi goreng"; "bakpao udang" is not "udang").
 */
function nameMatches(logged: string, dish: string): boolean {
  if (logged === dish) return true;
  const words = (s: string) => s.split(" ").length;
  if (words(dish) >= 2 && hasPhrase(logged, dish)) return true;
  return words(logged) >= 2 && hasPhrase(dish, logged);
}

export type HistoryIndex = {
  habits: HabitFood[];
  /** recipe id -> how often the person eats this dish (summed over the logged names that match it) */
  affinity: Map<string, { times: number; names: string[] }>;
  /** recipe id -> the most frequent habit food it is a lighter version of */
  better: Map<string, HabitFood>;
  /** habit foods no catalog dish stands for: usable as plan items with the person's own numbers */
  unmatched: HabitFood[];
};

export function buildHistoryIndex(habits: HabitFood[], recipes: RecipeDef[] = RECIPES): HistoryIndex {
  const affinity = new Map<string, { times: number; names: string[] }>();
  const better = new Map<string, HabitFood>();
  const matched = new Set<string>();
  for (const recipe of recipes) {
    const names = namesOf(recipe);
    for (const habit of habits) {
      if (names.some((n) => nameMatches(habit.norm, n))) {
        matched.add(habit.norm);
        const entry = affinity.get(recipe.id) ?? { times: 0, names: [] };
        entry.times += habit.times;
        entry.names.push(habit.name);
        affinity.set(recipe.id, entry);
      }
    }
    const kcal = recipe.betterOf ? computePortion(recipe).nutrition.kcal : 0;
    for (const kw of recipe.betterOf ?? []) {
      const key = normName(kw);
      for (const habit of habits) {
        // only a real lighter version: clearly fewer kcal than the person's own average of that food
        if (!hasPhrase(habit.norm, key) || names.some((n) => nameMatches(habit.norm, n)) || habit.kcal - kcal < MIN_SAVED_KCAL) continue;
        const current = better.get(recipe.id);
        if (!current || habit.times > current.times) better.set(recipe.id, habit);
      }
    }
  }
  return { habits, affinity, better, unmatched: habits.filter((h) => !matched.has(h.norm)) };
}

/** Which kinds of meal a habit food can stand in for, from the slots it is logged in. */
export function habitKinds(food: HabitFood): MealKind[] {
  const kinds = new Set<MealKind>();
  for (const slot of food.slots.slice(0, 2)) {
    if (slot === "sarapan" || slot === "sahur") kinds.add("breakfast");
    else if (slot === "snack") kinds.add("snack");
    else kinds.add("main");
  }
  return [...kinds];
}
