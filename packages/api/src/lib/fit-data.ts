// Read-only views of one person's JoyoRogo + JoyoFit data, as plain JSON an AI assistant can read: the MCP connector
// (apps/server/src/mcp.ts) and the in-app coach chat both answer from here. No transport, no auth and no paywall in
// this file: callers pass the user id they already authenticated and decided may read.
//
// Conventions of every result:
// - Days are calendar days 'YYYY-MM-DD' in the person's day zone (Jakarta +07:00, Kuala Lumpur / Singapore +08:00); times
//   are ISO 8601 with that zone's offset.
// - Units sit in the key name: Kcal, G (grams), Kg, Cm, Bpm, M (metres), Sec, Min, Ms, Pct.
// - Rows imported from Strava never appear (Strava's API terms keep that data out of AI); nothing here exposes
//   photos, GPS tracks or other people's data.

import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dailyActivity, exerciseLog, foodLog, sleepLog, waistLog, weightLog } from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";
import { workoutCustomExercise, workoutSession, workoutSet } from "@joyorogo/db/schema/plans";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";

import { dayOfMs, isoInZone } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

import { readChunked } from "./d1";
import { ageFromBirthYear, jakartaToday, shiftDate } from "./engine";
import { budgetKcal, exerciseCredit } from "./exercise-credit";
import type { AddBackSettings } from "./exercise-credit";
import { addBackPrefQuery, dayReadings, readAddBackPrefs } from "./exercise-credit-store";
import { exerciseById } from "./exercises";
import { gestationalAge, maternalFromRow } from "./maternal";
import { readCalibrationPrefs } from "./calibration-store";
import { buildPlan, planQueries, proteinGoalG } from "./plan";
import { pickNightSleep } from "./sleep-night";
import type { StickersBucket } from "./sticker";
import { dayBounds } from "./tiers";
import { getBlob } from "./watch-workout-store";
import { readDoc, WatchWorkoutDocError } from "./watch-workout";
import type { WorkoutAnalysis } from "./workout-analysis";

export const FIT_LIMITS = {
  foodDays: 31,
  totalsDays: 366,
  weightDays: 730,
  recoveryDays: 92,
  sleepNightDays: 90,
  workoutDays: 366,
  workoutItems: 50,
} as const;

export class FitDataError extends Error {
  constructor(
    readonly code: "bad_date" | "bad_range" | "not_found" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isRealDay(value: string): boolean {
  return DAY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && shiftDate(value, 0) === value;
}

/**
 * A validated [from, to] window. `to` defaults to today in `zone` and `from` to `defaultDays` days ending at `to`; a window
 * longer than `maxDays` is refused (the caller names the limit so the model can ask again with a shorter one).
 */
export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  opts: { maxDays: number; defaultDays: number; zone: DayZone; today?: string },
): { from: string; to: string; days: number } {
  const today = opts.today ?? jakartaToday(undefined, opts.zone);
  const end = to ?? today;
  if (!isRealDay(end)) throw new FitDataError("bad_date", `"to" must be a real day as YYYY-MM-DD, got "${end}".`);
  const start = from ?? shiftDate(end, -(opts.defaultDays - 1));
  if (!isRealDay(start)) throw new FitDataError("bad_date", `"from" must be a real day as YYYY-MM-DD, got "${start}".`);
  if (start > end) throw new FitDataError("bad_range", `"from" (${start}) is after "to" (${end}).`);
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > opts.maxDays) {
    throw new FitDataError("bad_range", `The window is ${days} days; at most ${opts.maxDays} days per call. Ask for a shorter window.`);
  }
  return { from: start, to: end, days };
}

const round = (value: number, digits = 0): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const roundOrNull = (value: number | null | undefined, digits = 0): number | null =>
  value === null || value === undefined ? null : round(value, digits);

// --- Profile and targets ------------------------------------------------------------------------------------

export type CoachMode = "lose" | "maintain" | "gain" | "hamil";

export interface ProfileView {
  today: string;
  hasProfile: boolean;
  /** `hamil` while the profile is pregnant or breastfeeding: no deficit, no weight target. */
  mode: CoachMode | null;
  ageYears?: number;
  gender?: string;
  heightCm?: number;
  activityLevel?: string;
  weight?: {
    startKg: number;
    currentKg: number;
    targetKg: number | null;
    targetDate: string | null;
    /** The weight the plan to gain started from; only in `gain` mode. */
    gainStartKg: number | null;
  };
  dailyTargets?: {
    eatKcal: number;
    burnKcal: number;
    bmrKcal: number;
    /** BMR x activityFactor; the thermic effect of food is inside the factor */
    tdeeKcal: number;
    /** The factor of the person's activityLevel (standard factors; Hamil / Menyusui have their own) */
    activityFactor: number;
    /** Movement the factor already contains: measured activity raises the budget only beyond it */
    includedActivityKcal: number;
    proteinG: number;
    sleepHours: number;
    /** Planned kcal below maintenance per day (negative while gaining). */
    deficitKcal: number;
  };
  maternal?: {
    state: "pregnant" | "breastfeeding";
    pregnancyWeek: number | null;
    trimester: number | null;
    twins: boolean;
    breastfeedingType: string | null;
    babyAgeMonths: number | null;
  };
  fasting?: { pattern: string; eatingWindowStart: string };
  foodBudget?: { idr: number; period: string } | null;
  language?: string | null;
}

export async function getProfileView(
  db: Database,
  userId: string,
  zone: DayZone,
  today = jakartaToday(undefined, zone),
): Promise<ProfileView> {
  const [profRows, latest, weighIns, intake, exercise, prefRows] = await db.batch(planQueries(db, userId, today));
  const prof = profRows[0];
  if (!prof) return { today, hasProfile: false, mode: null };
  const plan = buildPlan(
    prof,
    { latestWeightKg: latest[0]?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(prefRows) },
    today,
  );
  const maternal = maternalFromRow(prof);
  const mode: CoachMode = maternal.mode !== "none" ? "hamil" : prof.goal;
  const gestation = maternal.mode === "pregnant" && maternal.pregnancyLmp ? gestationalAge(maternal.pregnancyLmp, today) : null;
  const babyAgeMonths =
    maternal.mode === "breastfeeding" && maternal.babyBirthDate
      ? Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${maternal.babyBirthDate}T00:00:00Z`)) / 86_400_000 / 30.4375))
      : null;
  const { targets } = plan;
  return {
    today,
    hasProfile: true,
    mode,
    ageYears: ageFromBirthYear(prof.birthYear, today),
    gender: prof.gender,
    heightCm: prof.heightCm,
    activityLevel: prof.activityLevel,
    weight: {
      startKg: prof.startWeightKg,
      currentKg: round(plan.weightNowKg, 1),
      // Pregnancy and breastfeeding have no weight target.
      targetKg: maternal.mode === "none" ? prof.targetWeightKg : null,
      targetDate: maternal.mode === "none" ? prof.targetDate : null,
      gainStartKg: mode === "gain" ? (prof.goalStartKg ?? null) : null,
    },
    dailyTargets: {
      eatKcal: round(targets.eatKcal),
      burnKcal: round(targets.burnKcal),
      bmrKcal: round(targets.bmr),
      tdeeKcal: round(targets.tdee),
      activityFactor: targets.factor,
      includedActivityKcal: round(targets.includedKcal),
      proteinG: proteinGoalG(plan, prof.heightCm),
      sleepHours: targets.sleepHours,
      deficitKcal: round(targets.deficitKcal),
    },
    ...(maternal.mode !== "none"
      ? {
          maternal: {
            state: maternal.mode,
            pregnancyWeek: gestation?.weeks ?? null,
            trimester: gestation?.trimester ?? null,
            twins: maternal.twins,
            breastfeedingType: maternal.feedingType,
            babyAgeMonths,
          },
        }
      : {}),
    fasting: { pattern: prof.fastingPattern, eatingWindowStart: prof.fastingWindowStart },
    foodBudget: prof.foodBudgetIdr ? { idr: prof.foodBudgetIdr, period: prof.foodBudgetPeriod } : null,
    language: prof.locale,
  };
}

// --- Food ---------------------------------------------------------------------------------------------------

export interface FoodItemView {
  meal: string;
  name: string;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  grams: number | null;
  /** `ai` for a photo scan, `manual` for typed entries. */
  source: string;
}

export interface FoodDayView {
  date: string;
  totalKcal: number;
  items: FoodItemView[];
}

const MEAL_ORDER = ["sarapan", "sahur", "makan_siang", "makan_malam", "berbuka", "snack"];

/** Every logged item per day (days without a log are left out), meals in eating order. */
export async function getFoodLog(db: Database, userId: string, from: string, to: string): Promise<FoodDayView[]> {
  const rows = await db
    .select({
      date: foodLog.date,
      meal: foodLog.meal,
      name: foodLog.name,
      kcal: foodLog.kcal,
      protein: foodLog.protein,
      carbs: foodLog.carbs,
      fat: foodLog.fat,
      fiber: foodLog.fiber,
      grams: foodLog.grams,
      source: foodLog.source,
    })
    .from(foodLog)
    .where(and(eq(foodLog.userId, userId), gte(foodLog.date, from), lte(foodLog.date, to)))
    .orderBy(asc(foodLog.date), asc(foodLog.createdAt));
  const days = new Map<string, FoodDayView>();
  for (const row of rows) {
    const day = days.get(row.date) ?? { date: row.date, totalKcal: 0, items: [] };
    day.totalKcal += row.kcal;
    day.items.push({
      meal: row.meal,
      name: row.name,
      kcal: round(row.kcal),
      proteinG: roundOrNull(row.protein, 1),
      carbsG: roundOrNull(row.carbs, 1),
      fatG: roundOrNull(row.fat, 1),
      fiberG: roundOrNull(row.fiber, 1),
      grams: roundOrNull(row.grams),
      source: row.source,
    });
    days.set(row.date, day);
  }
  return [...days.values()].map((day) => ({
    ...day,
    totalKcal: round(day.totalKcal),
    items: day.items.toSorted((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal)),
  }));
}

export interface DayTotalsView {
  date: string;
  /** False when nothing was logged: a skipped day, not a 0 kcal day. */
  logged: boolean;
  eatenKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  meals: number;
  /** Exercise logged by hand or imported from Health Connect / Apple Health (never Strava). */
  exerciseKcal: number;
  steps: number | null;
  /** The day's activity that counts: the watch's all-day active energy (or the health store's) and logged workouts, deduplicated (docs/energy-model.md). */
  activeKcal: number;
  /** Where the all-day energy came from; null when there was none. */
  activeSource: string | null;
  /** Kcal added to the day's budget for the activity that goes beyond the person's activity factor, under their "Kalori olahraga" settings (0 when off or nothing went beyond it). */
  exerciseAddedKcal: number;
  /** eatKcal target plus exerciseAddedKcal, minus eaten; negative = over. Null when nothing was logged or there is no profile. */
  remainingKcal: number | null;
}

export interface TotalsView {
  from: string;
  to: string;
  /** The plan as of today, applied to every day of the window (the adaptive TDEE moves slowly). Null without a profile. */
  targets: { eatKcal: number; proteinG: number; burnKcal: number; mode: CoachMode } | null;
  /** How recorded exercise is added to each day's budget (the person's settings; Strava rows never count here). */
  exerciseAddBack: AddBackSettings;
  days: DayTotalsView[];
  /** proteinG averages only the days with a known protein (null when none): a kcal-only day is unknown, not 0 g. */
  average: { eatenKcal: number; proteinG: number | null; loggedDays: number } | null;
}

/** Eaten and burned totals per day against the current targets; one row for every day of the window. */
export async function getDailyTotals(
  db: Database,
  userId: string,
  from: string,
  to: string,
  zone: DayZone,
): Promise<TotalsView> {
  const [food, exercise, activity, view, prefRows, scores] = await Promise.all([
    db
      .select({
        date: foodLog.date,
        kcal: sql<number>`sum(${foodLog.kcal})`,
        protein: sql<number | null>`sum(${foodLog.protein})`,
        carbs: sql<number | null>`sum(${foodLog.carbs})`,
        fat: sql<number | null>`sum(${foodLog.fat})`,
        fiber: sql<number | null>`sum(${foodLog.fiber})`,
        meals: sql<number>`count(*)`,
      })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, from), lte(foodLog.date, to)))
      .groupBy(foodLog.date),
    db
      .select({ date: exerciseLog.date, kcal: exerciseLog.kcal, source: exerciseLog.source, externalId: exerciseLog.externalId })
      .from(exerciseLog)
      .where(
        and(
          eq(exerciseLog.userId, userId),
          gte(exerciseLog.date, from),
          lte(exerciseLog.date, to),
          ne(exerciseLog.source, "strava"),
          ne(exerciseLog.source, "rest"),
        ),
      ),
    db
      .select({
        date: dailyActivity.date,
        steps: dailyActivity.steps,
        activeCalories: dailyActivity.activeCalories,
        source: dailyActivity.source,
      })
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, userId), gte(dailyActivity.date, from), lte(dailyActivity.date, to))),
    getProfileView(db, userId, zone),
    addBackPrefQuery(db, userId),
    db
      .select({ date: fitnessScore.date, activeKcal: fitnessScore.activeKcal })
      .from(fitnessScore)
      .where(and(eq(fitnessScore.userId, userId), gte(fitnessScore.date, from), lte(fitnessScore.date, to))),
  ]);
  const { settings } = readAddBackPrefs(prefRows);
  const foodByDay = new Map(food.map((row) => [row.date, row]));
  const exerciseByDay = Map.groupBy(exercise, (row) => row.date);
  const activityByDay = new Map(activity.map((row) => [row.date, row]));
  const scoreByDay = new Map(scores.map((row) => [row.date, row]));
  const eatTarget = view.dailyTargets?.eatKcal ?? null;
  const includedKcal = view.dailyTargets?.includedActivityKcal ?? 0;

  const days: DayTotalsView[] = [];
  let eatenSum = 0;
  let proteinSum = 0;
  let proteinDays = 0;
  let loggedDays = 0;
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const row = foodByDay.get(date);
    if (row) {
      loggedDays += 1;
      eatenSum += row.kcal;
      if (row.protein !== null) {
        proteinSum += row.protein;
        proteinDays += 1;
      }
    }
    const credit = exerciseCredit({
      settings,
      rows: exerciseByDay.get(date) ?? [],
      readings: dayReadings(activityByDay.get(date), scoreByDay.get(date)),
      steps: activityByDay.get(date)?.steps ?? null,
      includedKcal,
    });
    days.push({
      date,
      logged: row !== undefined,
      eatenKcal: row ? round(row.kcal) : null,
      proteinG: row ? roundOrNull(row.protein, 1) : null,
      carbsG: row ? roundOrNull(row.carbs, 1) : null,
      fatG: row ? roundOrNull(row.fat, 1) : null,
      fiberG: row ? roundOrNull(row.fiber, 1) : null,
      meals: row?.meals ?? 0,
      exerciseKcal: credit.deviceWorkoutKcal + credit.otherWorkoutKcal,
      steps: activityByDay.get(date)?.steps ?? null,
      activeKcal: credit.activeKcal,
      activeSource: credit.allDaySource,
      exerciseAddedKcal: credit.countedKcal,
      remainingKcal: row && eatTarget !== null ? round(budgetKcal(eatTarget, credit) - row.kcal) : null,
    });
  }
  return {
    from,
    to,
    targets:
      view.dailyTargets && view.mode
        ? {
            eatKcal: view.dailyTargets.eatKcal,
            proteinG: view.dailyTargets.proteinG,
            burnKcal: view.dailyTargets.burnKcal,
            mode: view.mode,
          }
        : null,
    exerciseAddBack: settings,
    days,
    average: loggedDays > 0 ? { eatenKcal: round(eatenSum / loggedDays), proteinG: proteinDays > 0 ? round(proteinSum / proteinDays) : null, loggedDays } : null,
  };
}

// --- Weight -------------------------------------------------------------------------------------------------

export interface WeightView {
  from: string;
  to: string;
  entries: { date: string; weightKg: number }[];
  latest: { date: string; weightKg: number } | null;
  goal: {
    mode: CoachMode;
    startKg: number;
    targetKg: number | null;
    targetDate: string | null;
    /** kg still to go to the target (negative = already past it); null without a target. */
    remainingKg: number | null;
  } | null;
  trend: {
    /** Smoothed weight on the latest weigh-in (the number to believe, not the scale's daily noise). */
    smoothedKg: number;
    /** kg per week over the last 28 days, negative = losing. Null until 10 days of weigh-ins. */
    weeklyRateKg: number | null;
    /** The day the trend reaches the target at the current rate; null when not heading there. */
    projectedDate: string | null;
  } | null;
  waist: { date: string; waistCm: number }[];
}

export async function getWeightView(
  db: Database,
  userId: string,
  from: string,
  to: string,
  zone: DayZone,
): Promise<WeightView> {
  const today = jakartaToday(undefined, zone);
  const [entries, latest, waist, view, trendRows] = await Promise.all([
    db
      .select({ date: weightLog.date, weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(and(eq(weightLog.userId, userId), gte(weightLog.date, from), lte(weightLog.date, to)))
      .orderBy(asc(weightLog.date)),
    db
      .select({ date: weightLog.date, weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(eq(weightLog.userId, userId))
      .orderBy(desc(weightLog.date))
      .limit(1),
    db
      .select({ date: waistLog.date, waistCm: waistLog.waistCm })
      .from(waistLog)
      .where(and(eq(waistLog.userId, userId), gte(waistLog.date, from), lte(waistLog.date, to)))
      .orderBy(asc(waistLog.date)),
    getProfileView(db, userId, zone, today),
    db.batch(planQueries(db, userId, today)),
  ]);
  const [profRows, latestRows, weighIns, intake, exercise, prefRows] = trendRows;
  const prof = profRows[0];
  const plan = prof
    ? buildPlan(
        prof,
        { latestWeightKg: latestRows[0]?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(prefRows) },
        today,
      )
    : null;
  const mode = view.mode;
  const targetKg = view.weight?.targetKg ?? null;
  const current = latest[0]?.weightKg ?? view.weight?.startKg ?? null;
  return {
    from,
    to,
    entries: entries.map((row) => ({ date: row.date, weightKg: round(row.weightKg, 1) })),
    latest: latest[0] ? { date: latest[0].date, weightKg: round(latest[0].weightKg, 1) } : null,
    goal:
      view.weight && mode
        ? {
            mode,
            startKg: view.weight.startKg,
            targetKg,
            targetDate: view.weight.targetDate,
            remainingKg: targetKg !== null && current !== null ? round(targetKg - current, 1) : null,
          }
        : null,
    trend: plan?.trend
      ? {
          smoothedKg: round(plan.trend.weightKg, 1),
          weeklyRateKg: roundOrNull(plan.trend.weeklyRateKg, 2),
          projectedDate: plan.trend.projectedDate,
        }
      : null,
    waist: waist.map((row) => ({ date: row.date, waistCm: round(row.waistCm, 1) })),
  };
}

// --- Sleep, recovery, readiness and metrics -----------------------------------------------------------------

export interface RecoveryDayView {
  date: string;
  /** Hours asleep on the night that ended on the morning of this day. */
  sleepHours: number | null;
  /** Where sleepHours comes from: JoyoFit (watch) or the app's own log (manual, Health Connect, Apple Health). */
  sleepSource: string | null;
  /** Last night's sleep as a share of the sleep JoyoFit estimates the person needs; can pass 100. */
  sleepPct: number | null;
  /** HRV against the person's own baseline, 1 to 99. */
  recoveryPct: number | null;
  /** Heart-rate load of the day on JoyoFit's 0 to 21 scale. */
  strain: number | null;
  /** JoyoFit's readiness word: Primed, Balanced, Strained or Run down. */
  readiness: string | null;
  restingHrBpm: number | null;
  hrvMs: number | null;
  /** balanced, unbalanced or low: the last 7 nights against the 60-day baseline. */
  hrvStatus: string | null;
  vo2maxMlKgMin: number | null;
  /** productive, maintaining, recovery, overreaching or detraining. */
  trainingStatus: string | null;
  /** Acute (7 day) to chronic (28 day) training load; above about 1.5 is a spike. */
  loadRatio: number | null;
  recoveryHoursLeft: number | null;
  steps: number | null;
  distanceKm: number | null;
  activeKcal: number | null;
  exerciseMin: number | null;
}

/** One row per day that has any sleep, score or activity number, newest first. */
export async function getRecoveryDays(db: Database, userId: string, from: string, to: string): Promise<RecoveryDayView[]> {
  const [scores, sleeps, activity] = await Promise.all([
    db
      .select()
      .from(fitnessScore)
      .where(and(eq(fitnessScore.userId, userId), gte(fitnessScore.date, from), lte(fitnessScore.date, to))),
    // The app keys a night under the day it started (see routers/sleep.ts), so the night that ended on `date` is `date - 1`.
    db
      .select({ date: sleepLog.date, hours: sleepLog.hours, source: sleepLog.source })
      .from(sleepLog)
      .where(and(eq(sleepLog.userId, userId), gte(sleepLog.date, shiftDate(from, -1)), lte(sleepLog.date, shiftDate(to, -1)))),
    db
      .select()
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, userId), gte(dailyActivity.date, from), lte(dailyActivity.date, to))),
  ]);
  const scoreByDay = new Map(scores.map((row) => [row.date, row]));
  const sleepByDay = new Map(sleeps.map((row) => [shiftDate(row.date, 1), row]));
  const activityByDay = new Map(activity.map((row) => [row.date, row]));
  const days = new Set([...scoreByDay.keys(), ...sleepByDay.keys(), ...activityByDay.keys()]);
  return [...days]
    .filter((date) => date >= from && date <= to)
    .toSorted((a, b) => (a < b ? 1 : -1))
    .map((date) => {
      const score = scoreByDay.get(date);
      const slept = sleepByDay.get(date);
      const act = activityByDay.get(date);
      const night = pickNightSleep(slept, score?.sleepHours);
      return {
        date,
        sleepHours: night ? round(night.hours, 2) : null,
        sleepSource: night?.source ?? null,
        sleepPct: score?.sleepPct ?? null,
        recoveryPct: score?.recoveryPct ?? null,
        strain: roundOrNull(score?.strain, 1),
        readiness: score?.readiness ?? null,
        restingHrBpm: score?.restingHr ?? null,
        hrvMs: roundOrNull(score?.hrvMs, 1),
        hrvStatus: score?.hrvStatus ?? null,
        vo2maxMlKgMin: roundOrNull(score?.vo2max, 1),
        trainingStatus: score?.trainingStatus ?? null,
        loadRatio: roundOrNull(score?.loadRatio, 2),
        recoveryHoursLeft: score?.recoveryHours ?? null,
        steps: act?.steps ?? null,
        distanceKm: act ? round(act.distanceMeters / 1000, 2) : null,
        activeKcal: act ? round(act.activeCalories) : null,
        exerciseMin: act ? round(act.exerciseMinutes) : null,
      };
    });
}

// --- Workouts -----------------------------------------------------------------------------------------------

/** `watch:<start>` for a JoyoFit watch workout (start in unix seconds), `strength:<id>` for a gym session. */
export type WorkoutRef = { kind: "watch"; start: number } | { kind: "strength"; id: string };

export function parseWorkoutRef(id: string): WorkoutRef | null {
  const watch = /^watch:(\d{1,10})$/.exec(id);
  if (watch) return { kind: "watch", start: Number(watch[1]) };
  const strength = /^strength:([A-Za-z0-9-]{8,64})$/.exec(id);
  if (strength) return { kind: "strength", id: strength[1] as string };
  return null;
}

export interface WorkoutListItem {
  /** Pass to get_workout. */
  id: string;
  source: "joyofit_watch" | "strength_session";
  date: string;
  startedAt: string | null;
  name: string;
  /** run, walk, ride, swim or other for watch workouts; "strength" for gym sessions. */
  kind: string;
  durationMin: number | null;
  distanceKm: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  kcal: number | null;
  /** Strength sessions only. */
  exercises?: number;
  sets?: number;
  volumeKg?: number;
}

export async function listWorkouts(
  db: Database,
  userId: string,
  from: string,
  to: string,
  limit: number,
  zone: DayZone,
): Promise<WorkoutListItem[]> {
  const startSec = Math.floor(dayBounds(from, zone).startMs / 1000);
  const endSec = Math.floor(dayBounds(to, zone).endMs / 1000);
  const [watch, sessions] = await Promise.all([
    db
      .select()
      .from(watchWorkout)
      .where(
        and(
          eq(watchWorkout.userId, userId),
          isNull(watchWorkout.deletedAt),
          gte(watchWorkout.start, startSec),
          sql`${watchWorkout.start} < ${endSec}`,
        ),
      )
      .orderBy(desc(watchWorkout.start))
      .limit(limit),
    db
      .select()
      .from(workoutSession)
      .where(and(eq(workoutSession.userId, userId), gte(workoutSession.date, from), lte(workoutSession.date, to)))
      .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
      .limit(limit),
  ]);
  const sets = await readChunked(
    sessions.map((s) => s.id),
    (slice) =>
      db
        .select({
          sessionId: workoutSet.sessionId,
          exerciseId: workoutSet.exerciseId,
          reps: workoutSet.reps,
          weightKg: workoutSet.weightKg,
          setType: workoutSet.setType,
        })
        .from(workoutSet)
        .where(inArray(workoutSet.sessionId, slice)),
  );
  const bySession = new Map<string, typeof sets>();
  for (const set of sets) bySession.set(set.sessionId, [...(bySession.get(set.sessionId) ?? []), set]);

  const items: (WorkoutListItem & { sort: number })[] = [
    ...watch.map((row) => ({
      id: `watch:${row.start}`,
      source: "joyofit_watch" as const,
      date: dayOfMs(row.start * 1000, zone),
      startedAt: isoInZone(row.start * 1000, zone),
      name: row.sportName,
      kind: row.sportKind,
      durationMin: round(row.elapsedSec / 60, 1),
      distanceKm: row.distanceM ? round(row.distanceM / 1000, 2) : null,
      avgHrBpm: row.avgHr,
      maxHrBpm: row.maxHr,
      kcal: row.calories > 0 ? row.calories : null,
      sort: row.start * 1000,
    })),
    ...sessions.map((session) => {
      const own = bySession.get(session.id) ?? [];
      const working = own.filter((s) => s.setType !== "warmup");
      return {
        id: `strength:${session.id}`,
        source: "strength_session" as const,
        date: session.date,
        startedAt: session.startedAt ? isoInZone(session.startedAt.getTime(), zone) : null,
        name: session.name,
        kind: "strength",
        durationMin: roundOrNull(session.durationMin, 1),
        distanceKm: null,
        avgHrBpm: null,
        maxHrBpm: null,
        kcal: null,
        exercises: new Set(own.map((s) => s.exerciseId)).size,
        sets: own.length,
        volumeKg: round(working.reduce((total, s) => total + (s.weightKg ?? 0) * (s.reps ?? 0), 0)),
        sort: (session.startedAt ?? session.createdAt).getTime(),
      };
    }),
  ];
  return items
    .toSorted((a, b) => b.sort - a.sort)
    .slice(0, limit)
    .map(({ sort: _sort, ...item }) => item);
}

export interface WatchWorkoutView {
  id: string;
  source: "joyofit_watch";
  startedAt: string;
  date: string;
  sport: { name: string; kind: string };
  elapsedMin: number;
  movingMin: number;
  distanceKm: number | null;
  elevation: { gainM: number; lossM: number; minM: number; maxM: number } | null;
  calories: { kcal: number; fatG: number | null; carbG: number | null } | null;
  stats: WorkoutAnalysis["stats"];
  /** Seconds in heart-rate zones 1 to 5 (50 to 100 percent of the maximum heart rate). */
  hrZones: { maxHrBpm: number; boundsBpm: number[]; secInZone: number[]; secBelowZone1: number; maxHrSource: string } | null;
  paceZones: WorkoutAnalysis["paceZones"];
  bestEfforts: WorkoutAnalysis["bestEfforts"];
  /** JoyoFit's relative effort of the workout: strain 0 to 21, TRIMP and a word. */
  effort: WorkoutAnalysis["effort"];
  /** Training load: acute 7 day and chronic 28 day TRIMP, their ratio and the watch's own training-effect numbers. */
  load: WorkoutAnalysis["load"];
  splits: WorkoutAnalysis["splits"];
  laps: WorkoutAnalysis["laps"];
  /** Similar earlier workouts, newest first. */
  comparison: WorkoutAnalysis["comparison"];
  hasAnalysis: boolean;
}

/**
 * The analysis summary of one cloud watch workout. The per-second series and the GPS route are left out on purpose
 * (size, and a route is the most identifying thing a workout holds).
 */
export async function getWatchWorkoutView(
  db: Database,
  bucket: StickersBucket,
  userId: string,
  start: number,
  zone: DayZone,
): Promise<WatchWorkoutView> {
  const [row] = await db
    .select()
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), eq(watchWorkout.start, start), isNull(watchWorkout.deletedAt)))
    .limit(1);
  if (!row) throw new FitDataError("not_found", "No such workout.");
  const base = {
    id: `watch:${row.start}`,
    source: "joyofit_watch" as const,
    startedAt: isoInZone(row.start * 1000, zone),
    date: dayOfMs(row.start * 1000, zone),
  };
  const bytes = await getBlob(db, bucket, userId, start);
  let analysis: WorkoutAnalysis | null = null;
  if (bytes) {
    try {
      analysis = (await readDoc(new Uint8Array(bytes))).analysis;
    } catch (error) {
      // An older or newer stored document than this server reads: the list numbers are still right.
      if (!(error instanceof WatchWorkoutDocError)) throw error;
    }
  }
  const emptyStats: WorkoutAnalysis["stats"] = {
    avgHr: row.avgHr,
    maxHr: row.maxHr,
    minHr: null,
    avgPaceSecKm: null,
    bestPaceSecKm: null,
    avgSpeedMs: null,
    maxSpeedMs: null,
    avgCad: null,
    maxCad: null,
    avgPower: null,
    maxPower: null,
    normalizedPower: null,
    avgStrideM: null,
  };
  return {
    ...base,
    sport: { name: row.sportName, kind: row.sportKind },
    elapsedMin: round(row.elapsedSec / 60, 1),
    movingMin: round(row.movingSec / 60, 1),
    distanceKm: row.distanceM ? round(row.distanceM / 1000, 2) : null,
    elevation: analysis?.elevation ?? (row.elevGainM !== null ? { gainM: row.elevGainM, lossM: row.elevLossM ?? 0, minM: 0, maxM: 0 } : null),
    calories: analysis?.calories ?? (row.calories > 0 ? { kcal: row.calories, fatG: null, carbG: null } : null),
    stats: analysis?.stats ?? emptyStats,
    hrZones: analysis?.hrZones
      ? {
          maxHrBpm: analysis.hrZones.maxHr,
          boundsBpm: analysis.hrZones.bounds,
          secInZone: analysis.hrZones.sec,
          secBelowZone1: analysis.hrZones.belowSec,
          maxHrSource: analysis.hrZones.source,
        }
      : null,
    paceZones: analysis?.paceZones ?? null,
    bestEfforts: analysis?.bestEfforts ?? [],
    effort: analysis?.effort ?? null,
    load: analysis?.load ?? null,
    splits: analysis?.splits ?? [],
    laps: analysis?.laps ?? [],
    comparison: analysis?.comparison ?? null,
    hasAnalysis: analysis !== null,
  };
}

export interface StrengthSessionView {
  id: string;
  source: "strength_session";
  date: string;
  startedAt: string | null;
  name: string;
  durationMin: number | null;
  note: string | null;
  totalVolumeKg: number;
  exercises: {
    name: string;
    muscle: string | null;
    note: string | null;
    sets: {
      type: string;
      reps: number | null;
      weightKg: number | null;
      durationSec: number | null;
      /** Rate of perceived exertion 1 to 10 when the person entered it. */
      rpe: number | null;
    }[];
  }[];
}

export async function getStrengthSessionView(
  db: Database,
  userId: string,
  id: string,
  zone: DayZone,
): Promise<StrengthSessionView> {
  const [session] = await db
    .select()
    .from(workoutSession)
    .where(and(eq(workoutSession.id, id), eq(workoutSession.userId, userId)))
    .limit(1);
  if (!session) throw new FitDataError("not_found", "No such workout.");
  const [sets, custom] = await Promise.all([
    db.select().from(workoutSet).where(eq(workoutSet.sessionId, id)).orderBy(asc(workoutSet.position)),
    db
      .select({ id: workoutCustomExercise.id, name: workoutCustomExercise.name, muscle: workoutCustomExercise.muscle })
      .from(workoutCustomExercise)
      .where(eq(workoutCustomExercise.userId, userId)),
  ]);
  const customById = new Map(custom.map((row) => [row.id, row]));
  const exercises = new Map<string, StrengthSessionView["exercises"][number]>();
  let volume = 0;
  for (const set of sets) {
    const catalog = exerciseById(set.exerciseId);
    const own = customById.get(set.exerciseId);
    const entry = exercises.get(set.exerciseId) ?? {
      name: catalog?.name ?? own?.name ?? set.exerciseId,
      muscle: catalog?.muscle ?? own?.muscle ?? null,
      note: set.note,
      sets: [],
    };
    entry.sets.push({
      type: set.setType,
      reps: set.reps,
      weightKg: set.weightKg,
      durationSec: set.durationSec,
      rpe: set.rpe,
    });
    if (set.setType !== "warmup") volume += (set.weightKg ?? 0) * (set.reps ?? 0);
    exercises.set(set.exerciseId, entry);
  }
  return {
    id: `strength:${session.id}`,
    source: "strength_session",
    date: session.date,
    startedAt: session.startedAt ? isoInZone(session.startedAt.getTime(), zone) : null,
    name: session.name,
    durationMin: roundOrNull(session.durationMin, 1),
    note: session.note,
    totalVolumeKg: round(volume),
    exercises: [...exercises.values()],
  };
}
