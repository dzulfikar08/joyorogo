import { ADAPTIVE_MIN_WEIGH_INS, ADAPTIVE_WINDOW_DAYS, adaptiveTdee, daysBetween, shiftDate } from "./engine";
import type { DayKcal, WeighIn } from "./engine";
import { weekStartOf } from "./recap";

// Automatic calibration: once the logs and the weigh-ins are good enough, the eat target is built on the TDEE the body
// actually showed (energy balance over 28 days) instead of BMR x the activity factor, held within +-15% of the formula.
// Pure: no i18n, no database. The weekly anchor, the gate and the clamp live here; plan.ts applies the result through
// computeTargets. The preference that turns it off is read by the server (calibration-store.ts). Contract for humans:
// docs/energy-model.md.

/** The synced preference that turns the calibration off (boolean; default on). */
export const CALIBRATION_PREF_KEY = "energy.calibration" as const;
/** The base target the person last saw while calibrated (kcal): what the Beranda notice compares against. */
export const CALIBRATION_SEEN_PREF_KEY = "energy.calibrationSeen" as const;
export const CALIBRATION_PREF_KEYS = [CALIBRATION_PREF_KEY, CALIBRATION_SEEN_PREF_KEY] as const;

export const DEFAULT_CALIBRATION_ENABLED = true;

/** First weigh-in to last weigh-in of the window must span at least this many days. */
export const CALIBRATION_MIN_SPAN_DAYS = 21;
/** Share of the 28 window days that must have food logged (a day under CALIBRATION_MIN_DAY_KCAL is not logged). */
export const CALIBRATION_MIN_LOGGED_SHARE = 0.7;
/** The days that share is: 20 of 28. */
export const CALIBRATION_MIN_LOGGED_DAYS = Math.ceil(CALIBRATION_MIN_LOGGED_SHARE * ADAPTIVE_WINDOW_DAYS);
/** A day logged under this is treated as not logged, not as fasting. */
export const CALIBRATION_MIN_DAY_KCAL = 800;
/** The calibrated TDEE never strays further than this share from BMR x the level's factor. */
export const CALIBRATION_MAX_SHIFT = 0.15;
/** The Beranda notice appears when the calibrated base target is at least this far from the one the person last saw. */
export const CALIBRATION_NOTICE_MIN_KCAL = 50;
/**
 * How far back the intake / workout rows must reach for a plan on `date`: the 28-day window of the weekly anchor (the
 * Monday on or before `date`), which starts up to 6 days earlier than the window ending today.
 */
export const CALIBRATION_HISTORY_DAYS = ADAPTIVE_WINDOW_DAYS + 6;

/** Sanitizer of CALIBRATION_SEEN_PREF_KEY: a whole kcal figure in a plausible range, else nothing. */
export const sanitizeSeenKcal = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 500 && value <= 10_000 ? value : undefined;

export type CalibrationMeasure = {
  /** what the logs and the weight trend say the body burns in a day outside logged workouts */
  lifeKcal: number;
  /** the average of the day's logged workouts over the window, taken out of the measured total */
  avgWorkoutKcal: number;
  loggedDays: number;
  spanDays: number;
};

/** The two numbers the gate looks at, over the 28 complete days before `date`. */
export function calibrationProgress(
  date: string,
  weighIns: readonly WeighIn[],
  intake: readonly DayKcal[],
): { loggedDays: number; spanDays: number; weighIns: number } {
  const start = shiftDate(date, -ADAPTIVE_WINDOW_DAYS);
  const inWindow = (d: string) => d >= start && d < date;
  const weights = weighIns.filter((w) => inWindow(w.date));
  return {
    loggedDays: intake.filter((d) => inWindow(d.date) && d.kcal >= CALIBRATION_MIN_DAY_KCAL).length,
    spanDays: weights.length > 0 ? daysBetween(weights[0]!.date, weights.at(-1)!.date) : 0,
    weighIns: weights.length,
  };
}

/**
 * The daily-life TDEE the weight trend supports over the 28 complete days before `date`, or null until the data is good
 * enough: adaptiveTdee needs enough food days and weigh-ins, and on top of that the weigh-ins must span 21 days and 20 of
 * the 28 days must be logged. life = measured TDEE (adaptiveTdee over the logs without subtracting workouts) minus the
 * average logged workout kcal a day, so the workouts come out exactly once. `exercise` leaves rest and Strava rows out
 * (the caller's query does: Strava's API terms keep its data out of weight and food analytics).
 */
export function measureCalibration(input: {
  date: string;
  weighIns: WeighIn[];
  intake: DayKcal[];
  exercise: DayKcal[];
}): CalibrationMeasure | null {
  const measured = adaptiveTdee({
    date: input.date,
    weighIns: input.weighIns,
    intake: input.intake,
    exercise: [],
    minDayKcal: CALIBRATION_MIN_DAY_KCAL,
  });
  if (measured === null) return null;
  const { loggedDays, spanDays } = calibrationProgress(input.date, input.weighIns, input.intake);
  if (spanDays < CALIBRATION_MIN_SPAN_DAYS || loggedDays < CALIBRATION_MIN_LOGGED_DAYS) return null;
  const start = shiftDate(input.date, -ADAPTIVE_WINDOW_DAYS);
  const avgWorkoutKcal =
    input.exercise.filter((d) => d.date >= start && d.date < input.date).reduce((sum, d) => sum + d.kcal, 0) /
    ADAPTIVE_WINDOW_DAYS;
  return { lifeKcal: measured - avgWorkoutKcal, avgWorkoutKcal, loggedDays, spanDays };
}

/**
 * collecting: not enough data yet (the progress shows how far). waiting: the data is there but the weekly measurement
 * (the Monday on or before today) did not have it, so it starts next Monday. active: the target is built on it. off:
 * the person turned it off.
 */
export type CalibrationStatus = "off" | "collecting" | "waiting" | "active";

export type CalibrationInfo = {
  enabled: boolean;
  status: CalibrationStatus;
  /** logged days / weigh-in span over the 28 complete days before today, against what is needed */
  loggedDays: number;
  loggedDaysNeeded: number;
  spanDays: number;
  spanDaysNeeded: number;
  /** weigh-ins in the window against the 6 adaptiveTdee needs (the gate on top of the span) */
  weighIns: number;
  weighInsNeeded: number;
  windowDays: number;
  /** the Monday the measurement is held from; it is not recomputed until the next one */
  anchorDate: string;
  nextDate: string;
  /** BMR x the level's factor at today's weight: the pure formula, whether or not it is used */
  formulaKcal: number;
  /** what the weekly measurement says; null until the data is good enough. Shown when off, as "if you turned it on" */
  measuredKcal: number | null;
  /** the TDEE the target is built on: measured inside the +-15% guard; null unless active */
  usedKcal: number | null;
  /** the measurement was pulled back to the +-15% guard */
  clamped: boolean;
  /** logged workouts a day (non-Strava) taken out of the measurement; null with no measurement */
  avgWorkoutKcal: number | null;
};

/**
 * Where the calibration stands on `date`, and the TDEE to build the target on (null: the formula).
 *
 * Stability rule: the measurement is taken as of the most recent Monday (the 28 complete days before that Monday) and
 * held until the next one, so the target does not move with every daily weigh-in on a sliding window. Inside the week
 * the number only follows the formula's own drift with the weight when it sits on the +-15% guard.
 */
export function resolveCalibration(input: {
  enabled: boolean;
  date: string;
  weighIns: WeighIn[];
  intake: DayKcal[];
  exercise: DayKcal[];
  /** BMR x the level's factor at today's weight (Targets.tdee of the formula plan) */
  formulaKcal: number;
}): { info: CalibrationInfo; tdeeKcal: number | null } {
  const anchorDate = weekStartOf(input.date);
  const { loggedDays, spanDays, weighIns } = calibrationProgress(input.date, input.weighIns, input.intake);
  const measure = measureCalibration({ ...input, date: anchorDate });
  const readyNow = anchorDate === input.date ? measure !== null : measureCalibration(input) !== null;

  const measuredKcal = measure ? Math.round(measure.lifeKcal) : null;
  const active = input.enabled && measure !== null;
  const floor = input.formulaKcal * (1 - CALIBRATION_MAX_SHIFT);
  const ceil = input.formulaKcal * (1 + CALIBRATION_MAX_SHIFT);
  const usedKcal = active && measuredKcal !== null ? Math.round(Math.min(ceil, Math.max(floor, measuredKcal))) : null;

  return {
    tdeeKcal: usedKcal,
    info: {
      enabled: input.enabled,
      status: !input.enabled ? "off" : active ? "active" : readyNow ? "waiting" : "collecting",
      loggedDays,
      loggedDaysNeeded: CALIBRATION_MIN_LOGGED_DAYS,
      spanDays,
      spanDaysNeeded: CALIBRATION_MIN_SPAN_DAYS,
      weighIns,
      weighInsNeeded: ADAPTIVE_MIN_WEIGH_INS,
      windowDays: ADAPTIVE_WINDOW_DAYS,
      anchorDate,
      nextDate: shiftDate(anchorDate, 7),
      formulaKcal: Math.round(input.formulaKcal),
      measuredKcal,
      usedKcal,
      clamped: usedKcal !== null && measuredKcal !== null && usedKcal !== measuredKcal,
      avgWorkoutKcal: measure ? Math.round(measure.avgWorkoutKcal) : null,
    },
  };
}

/** The line Beranda shows when the calibrated base target moved since the person last saw it. */
export type CalibrationNotice = { fromKcal: number; toKcal: number };

/**
 * `toKcal` is today's base target (before counted activity). `fromKcal` is the last figure the person acknowledged, or,
 * before any, the base target the pure formula gave (what Beranda showed until the calibration started). Only while the
 * calibration is active, and only from a 50 kcal difference.
 */
export function calibrationNotice(input: {
  calibration: CalibrationInfo | null;
  baseKcal: number;
  formulaBaseKcal: number;
  seenKcal: number | null;
}): CalibrationNotice | null {
  if (input.calibration?.status !== "active") return null;
  const fromKcal = input.seenKcal ?? input.formulaBaseKcal;
  return Math.abs(input.baseKcal - fromKcal) >= CALIBRATION_NOTICE_MIN_KCAL
    ? { fromKcal, toKcal: input.baseKcal }
    : null;
}
