import { daysBetween, shiftDate } from "./engine";
import type { DayKcal, WeighIn } from "./engine";
import { measureCalibration } from "./calibration";
import { weekStartOf } from "./recap";

// "Pakai TDEE sendiri": the person types their own maintenance kcal. It replaces BMR x the activity factor (and the
// calibrated TDEE) as the TDEE the plan is built on; the goal pace, the exercise add-back, the maternal addition and the
// minimum-intake floors all apply on top of it exactly as for the computed one. The automatic calibration never moves
// the number: it can only suggest (after two weeks in a row more than 10% off), and the person decides. Pure: no i18n,
// no database. Contract for humans: docs/energy-model.md.

/** Validation range of the typed TDEE (kcal). */
export const MANUAL_TDEE_MIN_KCAL = 1000;
export const MANUAL_TDEE_MAX_KCAL = 6000;
/** A warning (never a block) when the typed TDEE is above the computed TDEE x this. */
export const MANUAL_TDEE_WARN_ABOVE_FACTOR = 1.5;
/** The calibration suggests a change once the measurement is further than this share from the typed TDEE. */
export const MANUAL_TDEE_SUGGEST_SHIFT = 0.1;
/** ...for this many weekly measurements in a row (the last Monday's and the one before). */
export const MANUAL_TDEE_SUGGEST_WEEKS = 2;
/** After "Biarkan" the suggestion stays away this many days. */
export const MANUAL_TDEE_DISMISS_DAYS = 28;

export type ManualTdeeWarning = "BELOW_BMR" | "ABOVE_RANGE";

/** What deserves a second look in a typed TDEE; the value is still accepted. */
export function manualTdeeWarning(manualKcal: number, bmrKcal: number, computedKcal: number): ManualTdeeWarning | null {
  if (manualKcal < bmrKcal) return "BELOW_BMR";
  if (manualKcal > computedKcal * MANUAL_TDEE_WARN_ABOVE_FACTOR) return "ABOVE_RANGE";
  return null;
}

export type ManualTdeeSuggestion = {
  /** what the logs and the weight trend say the body burns in a day (last Monday's measurement) */
  kcal: number;
  /** consecutive weekly measurements that were more than 10% from the typed TDEE */
  weeks: number;
};

export type ManualTdeeInfo = {
  /** the typed TDEE the plan is built on; null while the computed one is used */
  kcal: number | null;
  /** the TDEE the plan would use without it: the calibrated one when active, else BMR x the level's factor */
  computedKcal: number;
  /** BMR the plan is built on (the warning's floor) */
  bmrKcal: number;
  /** typed minus computed; null while not set */
  diffKcal: number | null;
  warning: ManualTdeeWarning | null;
  /** the calibration's gentle suggestion; never applied by itself. Null when there is none, or after "Biarkan". */
  suggestion: ManualTdeeSuggestion | null;
};

/** The two weekly measurements (last Monday's, the Monday before) against the typed TDEE. */
export function manualTdeeSuggestion(input: {
  manualKcal: number;
  date: string;
  /** the calibration switch: with it off nothing is measured for the person */
  calibrationEnabled: boolean;
  dismissedOn: string | null;
  weighIns: WeighIn[];
  intake: DayKcal[];
  exercise: DayKcal[];
}): ManualTdeeSuggestion | null {
  if (!input.calibrationEnabled) return null;
  if (input.dismissedOn !== null && daysBetween(input.dismissedOn, input.date) < MANUAL_TDEE_DISMISS_DAYS) return null;
  const anchor = weekStartOf(input.date);
  const measures: number[] = [];
  for (let week = 0; week < MANUAL_TDEE_SUGGEST_WEEKS; week++) {
    const measure = measureCalibration({ ...input, date: shiftDate(anchor, -7 * week) });
    if (measure === null) return null;
    measures.push(Math.round(measure.lifeKcal));
  }
  const off = measures.map((kcal) => (kcal - input.manualKcal) / input.manualKcal);
  const above = off.every((share) => share > MANUAL_TDEE_SUGGEST_SHIFT);
  const below = off.every((share) => share < -MANUAL_TDEE_SUGGEST_SHIFT);
  if (!above && !below) return null;
  const kcal = Math.min(MANUAL_TDEE_MAX_KCAL, Math.max(MANUAL_TDEE_MIN_KCAL, measures[0]!));
  return { kcal, weeks: MANUAL_TDEE_SUGGEST_WEEKS };
}

export function resolveManualTdee(input: {
  manualKcal: number | null;
  computedKcal: number;
  bmrKcal: number;
  date: string;
  calibrationEnabled: boolean;
  dismissedOn: string | null;
  weighIns: WeighIn[];
  intake: DayKcal[];
  exercise: DayKcal[];
}): ManualTdeeInfo {
  const computedKcal = Math.round(input.computedKcal);
  const bmrKcal = Math.round(input.bmrKcal);
  if (input.manualKcal === null) {
    return { kcal: null, computedKcal, bmrKcal, diffKcal: null, warning: null, suggestion: null };
  }
  return {
    kcal: input.manualKcal,
    computedKcal,
    bmrKcal,
    diffKcal: input.manualKcal - computedKcal,
    warning: manualTdeeWarning(input.manualKcal, bmrKcal, computedKcal),
    suggestion: manualTdeeSuggestion({ ...input, manualKcal: input.manualKcal }),
  };
}
