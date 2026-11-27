// "Biasa aman buatmu": the meals a user has eaten again and again, offered back when they still fit the slot. Two
// pure steps: `findKnownGood` (server) picks the habits from the user's own diary, `fitKnownGood` (web and native)
// keeps the ones that fit what is left of the slot's share of today's budget. A habit that does not fit is simply not
// shown; nothing is ever labelled as too much.
import type { Meal } from "./engine";
import { groupEvents, habitKey } from "./favorite-offer";
import type { LogEvent, OfferRow } from "./favorite-offer";
import { mealSplit } from "./snack-advice";

/** Different days a food or combo must have been logged on to count as a habit. */
export const KNOWN_GOOD_MIN_DAYS = 3;
/** The window those days are counted in, in days back from today. */
export const KNOWN_GOOD_WINDOW_DAYS = 60;
/** Habits the server sends; the clients filter them per slot. */
export const KNOWN_GOOD_MAX = 40;
/** Chips shown for one slot. */
export const KNOWN_GOOD_SHOWN = 3;

/** The food_log columns the selection reads. */
export type KnownGoodRow = OfferRow & {
  date: string;
  meal: string;
  grams: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  scanId: string | null;
};

/** A favorite as the selection needs it: its id, name, total kcal and component names. */
export type KnownGoodFavorite = { id: string; name: string; kcal: number; itemNames: string[] };

/**
 * A habit that can be logged again in one tap. `savedFoodId` set: it is a favorite, logged through savedFood.relog.
 * Otherwise a single food, logged through food.add with the fields of its newest row.
 */
export type KnownGoodMeal = {
  key: string;
  name: string;
  kcal: number;
  /** Distinct days it was logged on in the window. */
  days: number;
  /** Slots it was logged to. */
  meals: string[];
  scanId: string | null;
  savedFoodId: string | null;
  grams: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
};

/**
 * The user's habits, most-eaten first (newest on a tie): every food or combo logged on at least KNOWN_GOOD_MIN_DAYS
 * different days in `rows` (the caller passes the window, imports left out). A combo is offered only when it is a
 * favorite (there is no one-tap path for an unsaved plate); a habit matching a favorite is offered as that favorite.
 * Single foods the user hid from the recent chips (`hiddenKeys`) and zero-kcal habits (water) are left out.
 */
export function findKnownGood(
  rows: readonly KnownGoodRow[],
  favorites: readonly KnownGoodFavorite[],
  hiddenKeys: ReadonlySet<string> = new Set(),
  limit = KNOWN_GOOD_MAX,
): KnownGoodMeal[] {
  const favoriteByKey = new Map<string, KnownGoodFavorite>();
  for (const favorite of favorites) {
    const key = habitKey(favorite.itemNames);
    if (key !== "" && !favoriteByKey.has(key)) favoriteByKey.set(key, favorite);
  }

  const byKey = new Map<string, { days: Set<string>; meals: Set<string>; latest: LogEvent<KnownGoodRow> }>();
  for (const event of groupEvents(rows)) {
    const key = habitKey(event.names);
    if (key === "") continue;
    const first = event.rows[0]!;
    const habit = byKey.get(key);
    if (!habit) {
      byKey.set(key, { days: new Set([first.date]), meals: new Set([first.meal]), latest: event });
      continue;
    }
    habit.days.add(first.date);
    habit.meals.add(first.meal);
    if (event.newest > habit.latest.newest) habit.latest = event;
  }

  const found: Array<KnownGoodMeal & { newest: number }> = [];
  for (const [key, habit] of byKey) {
    if (habit.days.size < KNOWN_GOOD_MIN_DAYS) continue;
    const base = { key, days: habit.days.size, meals: [...habit.meals].sort(), newest: habit.latest.newest };
    const favorite = favoriteByKey.get(key);
    if (favorite) {
      if (!(favorite.kcal > 0)) continue;
      const scanId = habit.latest.rows.find((row) => row.scanId)?.scanId ?? null;
      found.push({
        ...base,
        name: favorite.name,
        kcal: Math.round(favorite.kcal),
        scanId,
        savedFoodId: favorite.id,
        grams: null,
        protein: null,
        carbs: null,
        fat: null,
        fiber: null,
      });
      continue;
    }
    if (habit.latest.rows.length !== 1 || hiddenKeys.has(key)) continue;
    const row = habit.latest.rows[0]!;
    if (!(row.kcal > 0)) continue;
    found.push({
      ...base,
      name: row.name,
      kcal: Math.round(row.kcal),
      scanId: row.scanId,
      savedFoodId: null,
      grams: row.grams,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      fiber: row.fiber,
    });
  }
  return found
    .sort((a, b) => b.days - a.days || b.newest - a.newest)
    .slice(0, limit)
    .map(({ newest: _newest, ...meal }) => meal);
}

export type KnownGoodDay = {
  /** The day's eat budget (day.summary targets.eatKcal); null/0 = no plan, nothing fits. */
  eatKcal: number | null | undefined;
  eatenKcal: number;
  eatenByMeal: Partial<Record<Meal, number>>;
  ramadan: boolean;
};

/**
 * Room for `meal` on the day: its share of the budget (the plan's meal split) less what that slot already holds, and
 * never more than what is left of the whole day. 0 when there is no budget.
 */
export function knownGoodRoom(meal: Meal, day: KnownGoodDay): number {
  const eatKcal = day.eatKcal ?? 0;
  if (!(eatKcal > 0)) return 0;
  const slot = mealSplit(day.ramadan)[meal] * eatKcal - (day.eatenByMeal[meal] ?? 0);
  return Math.max(0, Math.min(slot, eatKcal - day.eatenKcal));
}

/** The habits usually eaten in `meal` that fit its room today, in the server's order, at most `limit`. */
export function fitKnownGood(
  meals: readonly KnownGoodMeal[],
  meal: Meal,
  day: KnownGoodDay,
  limit = KNOWN_GOOD_SHOWN,
): KnownGoodMeal[] {
  const room = knownGoodRoom(meal, day);
  if (room <= 0) return [];
  return meals.filter((habit) => habit.meals.includes(meal) && habit.kcal <= room).slice(0, limit);
}
