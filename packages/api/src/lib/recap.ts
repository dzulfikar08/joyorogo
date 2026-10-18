// Weekly recap math: WIB weeks starting Monday, built from rows the stats
// router reads. Pure and tiny on purpose; the web app imports the label
// helpers into route modules.

import { getActiveLocale } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import type { TrendPoint } from "./engine";
import { shiftDate, streakFromDates } from "./engine";
import { shortDateRange } from "./format";
import { gainDayHit } from "./gain";

/** A logged day counts as on target up to 5% over the kcal target. */
export const ON_TARGET_TOLERANCE = 1.05;
/** Below half the target a day is more likely a forgotten log than a real day. */
export const MIN_COMPLETE_DAY = 0.5;

/** Monday (WIB calendar day) of the week containing `date`. */
export function weekStartOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

/** Week the recap screen opens on: last week on Monday (the new one has no complete day yet), else this week. */
export function defaultRecapWeek(today: string): string {
  const thisWeek = weekStartOf(today);
  return thisWeek === today ? shiftDate(thisWeek, -7) : thisWeek;
}

export type DayStatus = "on_target" | "over" | "under" | "empty" | "pending";

export type RecapDay = {
  date: string;
  status: DayStatus;
  eatenKcal: number;
  exerciseKcal: number;
};

export type RecapFoodDay = { date: string; kcal: number; protein: number | null };
export type RecapExerciseDay = {
  date: string;
  kcal: number;
  minutes: number;
  sessions: number;
};

export type WeekRecap = {
  weekStart: string;
  weekEnd: string;
  /** The whole week is behind us (its Sunday is before today). */
  complete: boolean;
  /** Days judged so far: every day before today, at most 7. */
  evaluatedDays: number;
  /** Judged days with at least one food row. */
  loggedDays: number;
  /** True when nothing was logged all week (food, exercise or weight). */
  empty: boolean;
  targetKcal: number;
  avgKcal: number | null;
  daysOnTarget: number;
  exercise: { kcal: number; minutes: number; sessions: number; activeDays: number };
  /** Change of the smoothed (EMA) weight trend across the week; null without weigh-ins. */
  weight: {
    startKg: number;
    endKg: number;
    changeKg: number;
    weighIns: number;
  } | null;
  streakDays: number;
  /** Naikin BB week: a day counts from 90% of the target, "over" does not exist, and the clients word the weight change as a gain. */
  gain: boolean;
  /** On-target day nearest the kcal target; null when no day was on target. */
  bestDay: { date: string; eatenKcal: number; proteinG: number | null } | null;
  protein: { avgG: number; targetG: number; days: number } | null;
  days: RecapDay[];
};

export type WeekRecapInput = {
  weekStart: string;
  today: string;
  targetKcal: number;
  proteinTargetG: number;
  food: RecapFoodDay[];
  exercise: RecapExerciseDay[];
  /** Weight-trend points, oldest first, up to the end of the week. */
  trendPoints: TrendPoint[];
  /** Distinct WIB days with a food or weight log, for the streak. */
  loggedDates: string[];
  /** A Naikin BB plan: day status and the streak follow the gain rules (lib/gain). */
  gain?: { streakDays: number };
};

export function dayStatus(eatenKcal: number, targetKcal: number, gain = false): DayStatus {
  if (eatenKcal <= 0) return "empty";
  // Naikin BB: under-eating is the miss, so a day is on target from 90% and never "over".
  if (gain) return gainDayHit(eatenKcal, targetKcal) ? "on_target" : "under";
  if (eatenKcal < targetKcal * MIN_COMPLETE_DAY) return "under";
  return eatenKcal <= targetKcal * ON_TARGET_TOLERANCE ? "on_target" : "over";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildWeekRecap(input: WeekRecapInput): WeekRecap {
  const { weekStart, today, targetKcal } = input;
  const weekEnd = shiftDate(weekStart, 6);
  const foodByDate = new Map(input.food.map((row) => [row.date, row]));
  const exerciseByDate = new Map(input.exercise.map((row) => [row.date, row]));

  const days: RecapDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = shiftDate(weekStart, i);
    const eatenKcal = Math.round(foodByDate.get(date)?.kcal ?? 0);
    days.push({
      date,
      status: date < today ? dayStatus(eatenKcal, targetKcal, input.gain !== undefined) : "pending",
      eatenKcal,
      exerciseKcal: Math.round(exerciseByDate.get(date)?.kcal ?? 0),
    });
  }

  const judged = days.filter((day) => day.status !== "pending");
  const logged = judged.filter((day) => day.status !== "empty");
  const avgKcal =
    logged.length > 0
      ? Math.round(logged.reduce((sum, day) => sum + day.eatenKcal, 0) / logged.length)
      : null;
  const onTarget = judged.filter((day) => day.status === "on_target");

  const bestDay = onTarget.reduce<RecapDay | null>((best, day) => {
    if (!best) return day;
    const gap = Math.abs(day.eatenKcal - targetKcal);
    const bestGap = Math.abs(best.eatenKcal - targetKcal);
    if (gap !== bestGap) return gap < bestGap ? day : best;
    const protein = foodByDate.get(day.date)?.protein ?? 0;
    return protein > (foodByDate.get(best.date)?.protein ?? 0) ? day : best;
  }, null);

  const proteinDays = logged
    .map((day) => foodByDate.get(day.date)?.protein ?? null)
    .filter((protein): protein is number => protein !== null && protein > 0);

  const weekExercise = days.map((day) => exerciseByDate.get(day.date)).filter((row) => row != null);
  const exercise = {
    kcal: Math.round(weekExercise.reduce((sum, row) => sum + row.kcal, 0)),
    minutes: Math.round(weekExercise.reduce((sum, row) => sum + row.minutes, 0)),
    sessions: weekExercise.reduce((sum, row) => sum + row.sessions, 0),
    activeDays: weekExercise.filter((row) => row.sessions > 0).length,
  };

  const inWeek = input.trendPoints.filter((p) => p.date >= weekStart && p.date <= weekEnd);
  const before = input.trendPoints.findLast((p) => p.date < weekStart);
  const last = inWeek.at(-1);
  // Baseline is the trend carried in from before the week; for a first week of
  // weighing it is the first weigh-in itself, so one reading gives no change.
  const baseline = before ?? inWeek[0];
  const weight =
    last && baseline && last !== baseline
      ? {
          startKg: round1(baseline.trendKg),
          endKg: round1(last.trendKg),
          changeKg: round1(last.trendKg - baseline.trendKg),
          weighIns: inWeek.length,
        }
      : null;

  const streakRef = weekEnd < today ? weekEnd : today;
  const streakDays =
    input.gain?.streakDays ??
    streakFromDates(
      input.loggedDates.filter((date) => date <= streakRef),
      streakRef,
    );

  return {
    weekStart,
    weekEnd,
    complete: weekEnd < today,
    evaluatedDays: judged.length,
    loggedDays: logged.length,
    empty:
      input.food.length === 0 && exercise.sessions === 0 && inWeek.length === 0,
    targetKcal,
    avgKcal,
    daysOnTarget: onTarget.length,
    exercise,
    weight,
    streakDays,
    gain: input.gain !== undefined,
    bestDay: bestDay
      ? {
          date: bestDay.date,
          eatenKcal: bestDay.eatenKcal,
          proteinG:
            foodByDate.get(bestDay.date)?.protein != null
              ? Math.round(foodByDate.get(bestDay.date)!.protein!)
              : null,
        }
      : null,
    protein:
      proteinDays.length > 0
        ? {
            avgG: Math.round(proteinDays.reduce((sum, g) => sum + g, 0) / proteinDays.length),
            targetG: input.proteinTargetG,
            days: proteinDays.length,
          }
        : null,
    days,
  };
}

// Hand-written like lib/format.ts: Hermes Intl is unreliable for day names.
const WEEKDAYS: Record<Locale, string[]> = {
  id: ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

/** "12–18 Okt" / "Oct 12–18", or "29 Sep–5 Okt" / "Sep 29–Oct 5" across a month boundary. */
export function weekRangeLabel(weekStart: string, locale: Locale = getActiveLocale()): string {
  return shortDateRange(weekStart, shiftDate(weekStart, 6), locale);
}

export function weekdayName(date: string, locale: Locale = getActiveLocale()): string {
  return WEEKDAYS[locale][new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

/** Short weekday for chart axes: "Sen", "Sel", ... / "Mon", "Tue", ... */
export function weekdayShort(date: string, locale: Locale = getActiveLocale()): string {
  return weekdayName(date, locale).slice(0, 3);
}

/** Fields of the story card's "recap" kind, shared by the web and native cards. */
export type RecapShare = {
  name: string;
  avgKcal: number;
  targetKcal: number;
  daysOnTarget: number;
  loggedDays: number;
  proteinAvgG: number | null;
  proteinTargetG: number | null;
  streakDays: number;
  exerciseKcal: number;
  exerciseMin: number;
  weightChangeKg: number | null;
  bestDay: { label: string; kcal: number } | null;
  /** Naikin BB week: the card words the weight change as a gain and drops the "over" reading. */
  gain: boolean;
};

/** Story-card numbers for a recap; null when nothing was logged to share. */
export function recapShare(recap: WeekRecap): RecapShare | null {
  if (recap.avgKcal === null) return null;
  return {
    name: weekRangeLabel(recap.weekStart),
    avgKcal: recap.avgKcal,
    targetKcal: recap.targetKcal,
    daysOnTarget: recap.daysOnTarget,
    loggedDays: recap.loggedDays,
    proteinAvgG: recap.protein?.avgG ?? null,
    proteinTargetG: recap.protein?.targetG ?? null,
    streakDays: recap.streakDays,
    exerciseKcal: recap.exercise.kcal,
    exerciseMin: recap.exercise.minutes,
    weightChangeKg: recap.weight?.changeKg ?? null,
    bestDay: recap.bestDay
      ? { label: weekdayName(recap.bestDay.date), kcal: recap.bestDay.eatenKcal }
      : null,
    gain: recap.gain,
  };
}
