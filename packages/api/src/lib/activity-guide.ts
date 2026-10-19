import {
  ACTIVITY_FACTOR,
  ACTIVITY_LEVELS,
  ADAPTIVE_WINDOW_DAYS,
  computeTargets,
  eatFloorKcal,
  shiftDate,
} from "./engine";
import type { ActivityLevel, DayKcal, ProfileInput, WeighIn } from "./engine";
import { measureCalibration } from "./calibration";
import { computeMaternalTargets } from "./maternal";
import type { MaternalState } from "./maternal";

// "Lebih akurat": two recommendations for the activity level, shown where the person picks it. Both are only
// recommendations (the person taps "Pakai"); nothing is applied on its own. Pure: the router (routers/profile) loads
// the rows. Contract for humans: docs/energy-model.md.

// --- What each level means for this person ------------------------------------------------------------------------

export type ActivityOption = {
  level: ActivityLevel;
  /** the factor this person's plan uses for the level (Hamil / Menyusui use their own, MATERNAL_ACTIVITY_FACTOR) */
  factor: number;
  tdeeKcal: number;
  /** the base eat target the level would give (before counted activity) */
  targetKcal: number;
  /** the movement the level's factor already contains */
  includedKcal: number;
  /** the minimum eating floor decides the target: a higher level would not raise it (normal plan only) */
  floored: boolean;
};

/** The plan the person would have on each of the five levels, everything else unchanged. */
export function activityOptions(
  profile: ProfileInput,
  maternal: MaternalState | null,
  weightNow: number,
  today?: string,
): ActivityOption[] {
  return ACTIVITY_LEVELS.map((level) => {
    const input = { ...profile, activityLevel: level };
    const targets =
      maternal !== null && maternal.mode !== "none"
        ? computeMaternalTargets(input, maternal, { today, weightNow })
        : computeTargets(input, { today, weightNow });
    return {
      level,
      factor: targets.factor,
      tdeeKcal: targets.tdee,
      targetKcal: targets.eatKcal,
      includedKcal: targets.includedKcal,
      floored: targets.maternal === null && targets.gain === null && targets.eatKcal === eatFloorKcal(profile.gender),
    };
  });
}

// --- From steps ---------------------------------------------------------------------------------------------------

/** The step history looked at, in days before today (today is partial, so it is left out). */
export const STEPS_WINDOW_DAYS = 14;
/** Days with steps needed in that window before steps recommend anything. */
export const STEPS_MIN_DAYS = 5;

/**
 * Tudor-Locke & Bassett 2004 step index, mapped to the levels: under 5000 sedentary, 5000-7499 "low active" (light),
 * 7500-9999 "somewhat active" (moderate), 10000-12499 "active", 12500 and up "highly active" (very active).
 */
export const STEP_LEVEL_BOUNDS: readonly { level: ActivityLevel; minSteps: number }[] = [
  { level: "sedentary", minSteps: 0 },
  { level: "light", minSteps: 5000 },
  { level: "moderate", minSteps: 7500 },
  { level: "active", minSteps: 10000 },
  { level: "very_active", minSteps: 12500 },
];

/** The level an average daily step count stands for. */
export function levelFromSteps(avgSteps: number): ActivityLevel {
  let level: ActivityLevel = "sedentary";
  for (const bound of STEP_LEVEL_BOUNDS) if (avgSteps >= bound.minSteps) level = bound.level;
  return level;
}

export type StepsRecommendation = {
  level: ActivityLevel;
  /** average steps a day over the days that had steps */
  avgSteps: number;
  /** how many days that average is over */
  days: number;
};

/**
 * From the account's `daily_activity` rows: the average steps of the days with steps in the 14 days before `today`,
 * once at least 5 such days exist. Null otherwise (no data, no recommendation: no new permission is ever asked for it).
 */
export function stepsRecommendation(
  rows: readonly { date: string; steps: number | null }[],
  today: string,
): StepsRecommendation | null {
  const from = shiftDate(today, -STEPS_WINDOW_DAYS);
  const days = rows.filter(
    (row) => row.date >= from && row.date < today && typeof row.steps === "number" && row.steps > 0,
  );
  if (days.length < STEPS_MIN_DAYS) return null;
  const avgSteps = days.reduce((sum, row) => sum + (row.steps ?? 0), 0) / days.length;
  return { level: levelFromSteps(avgSteps), avgSteps: Math.round(avgSteps), days: days.length };
}

// --- From the weight trend ----------------------------------------------------------------------------------------

// The gate (21-day weigh-in span, 20 of 28 days logged) and the measurement live in lib/calibration, shared with the
// automatic calibration of the target; this recommendation is what the person gets while that is switched off.

/** The level whose factor is nearest to `factor`. */
export function levelFromFactor(factor: number): ActivityLevel {
  return ACTIVITY_LEVELS.reduce((best, level) =>
    Math.abs(ACTIVITY_FACTOR[level] - factor) < Math.abs(ACTIVITY_FACTOR[best] - factor) ? level : best,
  );
}

export type CalibrationRecommendation = {
  level: ActivityLevel;
  /** (measured TDEE - average counted workout kcal a day) / BMR, to 2 decimals */
  impliedFactor: number;
  /** what the logs and the weight trend say the body burns in a day outside logged workouts */
  measuredKcal: number;
  /** BMR x the factor of the current level: the same thing by formula */
  formulaKcal: number;
  /** the average of the day's logged workouts over the window, taken out of the measured total */
  avgWorkoutKcal: number;
  loggedDays: number;
  windowDays: number;
};

/**
 * The level the weight trend supports, or null until the data is good enough (lib/calibration measureCalibration: the
 * gate and the measurement, workouts taken out once). implied factor = measured daily-life TDEE / BMR.
 */
export function calibrationRecommendation(input: {
  date: string;
  weighIns: WeighIn[];
  intake: DayKcal[];
  /** logged workout kcal per day (rest and Strava rows left out by the caller) */
  exercise: DayKcal[];
  bmrKcal: number;
  currentLevel: ActivityLevel;
}): CalibrationRecommendation | null {
  const measure = measureCalibration(input);
  if (measure === null || input.bmrKcal <= 0) return null;
  const impliedFactor = measure.lifeKcal / input.bmrKcal;
  return {
    level: levelFromFactor(impliedFactor),
    impliedFactor: Math.round(impliedFactor * 100) / 100,
    measuredKcal: Math.round(measure.lifeKcal),
    formulaKcal: Math.round(input.bmrKcal * ACTIVITY_FACTOR[input.currentLevel]),
    avgWorkoutKcal: Math.round(measure.avgWorkoutKcal),
    loggedDays: measure.loggedDays,
    windowDays: ADAPTIVE_WINDOW_DAYS,
  };
}
