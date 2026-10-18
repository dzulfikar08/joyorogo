import { getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { shiftDate } from "./engine";
import { shiftWorkoutKcal } from "./exercise-credit";
import type { ExerciseCredit } from "./exercise-credit";

/**
 * Pure cache math for optimistic mutations, shared by the web and native
 * clients (no React, no react-query: platform helpers own the hooks and
 * toasts). Every function returns new objects so TanStack Query sees a
 * reference change, and every delta is an approximation of what the server
 * will recompute — the settle-time refetch is the source of truth.
 */

/** "Urungkan" / "Undo": label of the undo action on a toast. */
export function undoLabel(locale: Locale = getActiveLocale()): string {
  return getT(locale)("actions.undo");
}

export const UNDO_TOAST_MS = 6000;
/** Hidden rows are deleted for real only after the undo window passes. */
export const DELETE_COMMIT_MS = 5000;

const inWeek = (date: string, today: string) => date >= shiftDate(today, -6);

/** Minimal shape of a cached day.summary this module knows how to patch.
 * Optional fields: the no-profile branch of the router omits them. */
export type DaySummaryLike = {
  date: string;
  eatenKcal: number;
  eatenByMeal: Record<string, number>;
  burnedKcal: number;
  weekEatenKcal: number;
  weekBurnedKcal: number;
  weekMeals: number;
  weekProtein?: number;
  weekCarbs?: number;
  weekFat?: number;
  protein?: { eatenG: number; targetG: number } | null;
  sleepHoursLastNight?: number | null;
  latestWeightKg?: number | null;
  weightLoggedToday?: boolean;
  /** The day's eat budget (base plus counted exercise) and the counted part; both move with a logged workout. */
  targets?: { eatKcal: number; exerciseKcal: number } | null;
  exerciseCredit?: ExerciseCredit | null;
};

export type SummaryDelta = {
  /** WIB date the logged row belongs to; gates the same-day totals. */
  date: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  meal?: string;
  /** Food-row count delta (+1 add / -1 delete) for weekMeals. */
  meals?: number;
  /** Exercise kcal delta; also shifts burnedKcal. */
  burnKcal?: number;
  /** Sleep hours to set (not a delta) on the summary of date + 1. */
  sleepHours?: number | null;
};

/**
 * Patch one cached day summary with a food/exercise/sleep delta:
 * same-day totals (eaten, burned, eatenByMeal) when the cache's
 * date matches, rolling week totals whenever the row's date falls in the
 * cache's 7-day window. Returns the same object untouched when nothing
 * applies, so setQueryData updaters can return it as-is.
 */
export function applySummaryDelta<T extends DaySummaryLike>(
  summary: T,
  delta: SummaryDelta,
  today: string,
): T {
  const sameDay = summary.date === delta.date;
  const week = inWeek(delta.date, today);
  if (!sameDay && !week && delta.sleepHours === undefined) return summary;

  const s = { ...summary };
  if (sameDay && delta.kcal !== undefined) s.eatenKcal += delta.kcal;
  if (sameDay && delta.meal !== undefined && delta.kcal !== undefined) {
    s.eatenByMeal = { ...s.eatenByMeal, [delta.meal]: (s.eatenByMeal[delta.meal] ?? 0) + delta.kcal };
  }
  if (sameDay && delta.burnKcal !== undefined) {
    s.burnedKcal += delta.burnKcal;
    if (s.exerciseCredit && s.targets) {
      const next = shiftWorkoutKcal(s.exerciseCredit, delta.burnKcal);
      const added = next.countedKcal - s.exerciseCredit.countedKcal;
      s.exerciseCredit = next;
      s.targets = { ...s.targets, eatKcal: s.targets.eatKcal + added, exerciseKcal: s.targets.exerciseKcal + added };
    }
  }
  if (week && delta.kcal !== undefined) s.weekEatenKcal += delta.kcal;
  if (week && delta.burnKcal !== undefined) s.weekBurnedKcal += delta.burnKcal;
  if (week && delta.meals !== undefined && delta.meals !== 0) s.weekMeals += delta.meals;
  if (week && delta.protein !== undefined) s.weekProtein = Math.round((s.weekProtein ?? 0) + delta.protein);
  if (week && delta.carbs !== undefined) s.weekCarbs = Math.round((s.weekCarbs ?? 0) + delta.carbs);
  if (week && delta.fat !== undefined) s.weekFat = Math.round((s.weekFat ?? 0) + delta.fat);
  if (sameDay && delta.protein !== undefined && s.protein) {
    s.protein = { ...s.protein, eatenG: Math.max(0, Math.round(s.protein.eatenG + delta.protein)) };
  }

  if (delta.sleepHours !== undefined && summary.date === shiftDate(delta.date, 1)) {
    s.sleepHoursLastNight = delta.sleepHours;
  }
  return s;
}

/**
 * Optimistic weigh-in on a cached summary: the same-day cache gets the new
 * latest weight and the "logged today" flag. Trend smoothing (weightLostKg,
 * weekTrend, adaptive TDEE) is left to the settle-time refetch.
 */
export function applyWeightCheckIn<T extends DaySummaryLike>(
  summary: T,
  delta: { date: string; weightKg: number },
  today: string,
): T {
  if (summary.date !== delta.date) return summary;
  return {
    ...summary,
    latestWeightKg: delta.weightKg,
    weightLoggedToday: delta.date === today,
  };
}

export function upsertById<T extends { id: string }>(rows: T[], row: T): T[] {
  const index = rows.findIndex((r) => r.id === row.id);
  if (index === -1) return [...rows, row];
  const next = [...rows];
  next[index] = row;
  return next;
}

export function removeById<T extends { id: string }>(rows: T[], id: string): T[] {
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return rows;
  const next = [...rows];
  next.splice(index, 1);
  return next;
}

/** "Nasi goreng dihapus" / "Nasi goreng deleted": trims, falls back to `fallback` (default "Catatan" / "Entry") when blank. */
export function deletedMsg(
  name: string | null | undefined,
  fallback?: string,
  locale: Locale = getActiveLocale(),
): string {
  const t = getT(locale);
  const clean = name?.trim();
  return t("toast.deleted", {
    name: clean && clean.length > 0 ? clean : (fallback ?? t("toast.entryFallback")),
  });
}
