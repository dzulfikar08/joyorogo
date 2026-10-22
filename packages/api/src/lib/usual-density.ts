// "Seperti biasanya": the same food, the same kcal per gram. The model answers a different number for the
// same dish on different days (putih telur 50, 52, 104 kcal; ayam goreng 2.3 to 2.6 kcal/g), while a user who has
// logged that food before already has a number for it. After the model answers, an item whose name matches one of
// the user's own logged rows takes that row's kcal per gram at the item's own grams. Post-hoc only, never a prompt
// change: the model's number is kept on the item (`usualDensity.modelKcal`) and the user can edit the row as always.
//
// Match = the same normalised name (normalizeFoodName), nothing fuzzier: "nasi goreng" never borrows from "nasi
// putih". A history row counts when it has a weight and kcal above 0; the newest one wins ("last", not an average,
// so the value the user last accepted is the one they see again).
import { normalizeFoodName } from "./food-patterns";

/** Only rows of the last this-many days. */
export const USUAL_WINDOW_DAYS = 120;
/** The usual density may be at most this many times the model's, or this fraction of it; beyond that it is a different dish. */
export const USUAL_MAX_RATIO = 2;
/** Model and usual kcal within this share are the same number: nothing to change, nothing to say. */
const SAME_KCAL = 0.02;

/** The food_log columns the history needs. */
export type UsualRow = {
  name: string;
  grams: number | null;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
};

/** One food's usual numbers per gram, from the user's newest matching row. */
export type UsualFood = {
  kcalPerGram: number;
  /** Per gram; null where that row never had the macro. */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  /** Rows that matched the name in the window. */
  n: number;
};

/** What the scan answer says about an item that took the user's usual number (client-safe, plain data). */
export type UsualDensityNote = {
  /** kcal the model answered for the same grams, before the usual number replaced it. */
  modelKcal: number;
  /** How many of the user's logged rows carry this food. */
  n: number;
};

/** The user's usual numbers per normalised food name. */
export type UsualMap = Map<string, UsualFood>;

/** Builds the map from rows ordered newest first. */
export function buildUsualMap(rowsNewestFirst: readonly UsualRow[]): UsualMap {
  const map: UsualMap = new Map();
  for (const row of rowsNewestFirst) {
    if (row.grams === null || !(row.grams > 0) || !(row.kcal > 0)) continue;
    const key = normalizeFoodName(row.name);
    if (key === "") continue;
    const seen = map.get(key);
    if (seen) {
      seen.n += 1;
      continue;
    }
    const per = (value: number | null) => (value === null ? null : value / row.grams!);
    map.set(key, {
      kcalPerGram: row.kcal / row.grams,
      protein: per(row.protein),
      carbs: per(row.carbs),
      fat: per(row.fat),
      fiber: per(row.fiber),
      n: 1,
    });
  }
  return map;
}

type DensityItem = {
  name: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  cup?: unknown;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The item at the user's usual kcal per gram, with `usualDensity` naming the model's own kcal; the item itself
 * when the user has no row for the food, the number is the model's already, or the usual density is too far from
 * the model's to be the same dish. Macros follow the user's own row when it carries all three (protein, carbs, fat),
 * else the model's macros scale with the kcal.
 */
export function withUsualDensity<T extends DensityItem>(
  item: T,
  usual: UsualMap,
): T & { usualDensity?: UsualDensityNote } {
  const grams = item.grams;
  if (grams === undefined || !(grams > 0) || !(item.kcal > 0) || item.cup !== undefined) return item;
  const food = usual.get(normalizeFoodName(item.name));
  if (!food) return item;
  const kcal = Math.round(food.kcalPerGram * grams);
  if (kcal <= 0 || Math.abs(kcal - item.kcal) <= SAME_KCAL * item.kcal) return item;
  const ratio = kcal / item.kcal;
  if (ratio > USUAL_MAX_RATIO || ratio < 1 / USUAL_MAX_RATIO) return item;
  const own = food.protein !== null && food.carbs !== null && food.fat !== null;
  const macro = (perGram: number | null, model: number | undefined) =>
    perGram !== null ? round1(perGram * grams) : model !== undefined ? round1(model * ratio) : undefined;
  const next = {
    ...item,
    kcal,
    usualDensity: { modelKcal: Math.round(item.kcal), n: food.n },
  } as T & { usualDensity: UsualDensityNote };
  const protein = macro(own ? food.protein : null, item.protein);
  const carbs = macro(own ? food.carbs : null, item.carbs);
  const fat = macro(own ? food.fat : null, item.fat);
  const fiber = macro(food.fiber, item.fiber);
  if (protein !== undefined) next.protein = protein;
  if (carbs !== undefined) next.carbs = carbs;
  if (fat !== undefined) next.fat = fat;
  if (fiber !== undefined) next.fiber = fiber;
  return next;
}
