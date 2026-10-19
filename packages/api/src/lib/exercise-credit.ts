// "Sisa" adds back real activity, but only what goes beyond the activity factor. The eat target is TDEE = BMR x the
// person's activity factor, less the plan's deficit (engine.ts computeTargets): the factor already contains an average
// day of movement, so measured activity can only RAISE the budget, by what exceeds that included movement (a phone
// left on a desk that logs 10 kcal changes nothing). This file is the one place that decides how much. Pure: no i18n,
// no database. Settings live in the account preferences (rogo-prefs.ts) and are read by the server
// (exercise-credit-store.ts). Contract for humans: docs/energy-model.md.

/** 500 / 1000 / 1500 kcal a day, or no cap. */
export const ADD_BACK_CAPS = [500, 1000, 1500, "none"] as const;
export type AddBackCap = (typeof ADD_BACK_CAPS)[number];

/** Share of the day's activity that is counted, in percent. */
export const ADD_BACK_PCT = { min: 50, max: 100, step: 5 } as const;

export interface AddBackSettings {
  enabled: boolean;
  pct: number;
  cap: AddBackCap;
}

export const DEFAULT_ADD_BACK_SETTINGS: AddBackSettings = {
  enabled: true,
  pct: 75,
  cap: 1000,
};

/** The preference keys behind the settings (rogo-prefs.ts SPECS), one record each. */
export const ADD_BACK_PREF_KEYS = [
  "exercise.addBack.enabled",
  "exercise.addBack.pct",
  "exercise.addBack.cap",
] as const;
export type AddBackPrefKey = (typeof ADD_BACK_PREF_KEYS)[number];

const isPct = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= ADD_BACK_PCT.min &&
  value <= ADD_BACK_PCT.max &&
  (value - ADD_BACK_PCT.min) % ADD_BACK_PCT.step === 0;

/** Per-key sanitizers: the value or undefined when it is not one this build accepts. */
export const ADD_BACK_SANITIZERS: Record<AddBackPrefKey, (value: unknown) => unknown | undefined> = {
  "exercise.addBack.enabled": (value) => (typeof value === "boolean" ? value : undefined),
  "exercise.addBack.pct": (value) => (isPct(value) ? value : undefined),
  "exercise.addBack.cap": (value) => ADD_BACK_CAPS.find((cap) => cap === value),
};

/** Settings from the stored preference values: a missing or malformed one falls back to its default. */
export function addBackSettings(values: Partial<Record<AddBackPrefKey, unknown>>): AddBackSettings {
  const pick = (key: AddBackPrefKey) => ADD_BACK_SANITIZERS[key](values[key]);
  return {
    enabled: (pick("exercise.addBack.enabled") as boolean | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.enabled,
    pct: (pick("exercise.addBack.pct") as number | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.pct,
    cap: (pick("exercise.addBack.cap") as AddBackCap | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.cap,
  };
}

/** Where a day's all-day active energy came from. */
export const ALL_DAY_SOURCES = ["joyofit", "health_connect", "apple_health"] as const;
export type AllDaySource = (typeof ALL_DAY_SOURCES)[number];

/** A total above this is a glitch (a Huawei or Health Connect double write), not a person: it is ignored. */
export const ALL_DAY_MAX_KCAL = 6000;
/** A day with at least this many steps cannot have less than STEP_FLOOR_KCAL_PER_STEP of active energy. */
const STEP_CHECK_FROM = 3000;
const STEP_FLOOR_KCAL_PER_STEP = 0.01;

export interface AllDayReading {
  source: AllDaySource;
  kcal: number | null | undefined;
}

/**
 * The day's trusted all-day active energy: the largest valid reading. Two readings are two views of the same energy (the
 * watch and the health store it also writes to), so they are never added. A reading is not valid when it is empty, above
 * ALL_DAY_MAX_KCAL, or absurdly low for the day's steps (0 active on a day with 15 000 steps).
 */
export function allDayActive(readings: readonly AllDayReading[], steps: number | null): { kcal: number; source: AllDaySource } | null {
  let best: { kcal: number; source: AllDaySource } | null = null;
  for (const { source, kcal } of readings) {
    if (typeof kcal !== "number" || !Number.isFinite(kcal) || kcal <= 0 || kcal > ALL_DAY_MAX_KCAL) continue;
    if (steps !== null && steps >= STEP_CHECK_FROM && kcal < steps * STEP_FLOOR_KCAL_PER_STEP) continue;
    if (best === null || kcal > best.kcal) best = { kcal, source };
  }
  return best;
}

export interface CreditExerciseRow {
  kcal: number;
  /** 'rest' rows mark a planned day off, never movement */
  source?: string | null;
  /** `watch:<start>`, `strength:<id>`, `phone:<start>` for JoyoFit rows */
  externalId?: string | null;
}

/**
 * Whether a recorded workout is already inside the day's all-day total, so the total replaces it. The watch's workouts
 * (`joyofit` `watch:` rows) and the health store's imports are. JoyoFit strength and phone recordings are inside only
 * when the all-day total is the watch's own: with a health-store total (a phone, or another watch) a strength session
 * logged in JoyoFit is not in it. 'manual' and 'strava' are never inside: the person typed them, or Strava recorded
 * them without the watch.
 */
function insideAllDay(row: CreditExerciseRow, allDaySource: AllDaySource | null): boolean {
  if (row.source === "health_connect" || row.source === "apple_health") return true;
  if (row.source !== "joyofit") return false;
  return (row.externalId ?? "").startsWith("watch:") || allDaySource === "joyofit" || allDaySource === null;
}

export interface ExerciseCredit {
  enabled: boolean;
  pct: number;
  cap: AddBackCap;
  /** the day's trusted all-day active energy; null when there is none */
  allDayKcal: number | null;
  allDaySource: AllDaySource | null;
  /** the movement the person's activity factor already contains (Targets.includedKcal); the all-day total counts only beyond it */
  includedKcal: number;
  /** recorded workouts of the watch and health stores: inside the all-day total when there is one, counted on top of the factor when not */
  deviceWorkoutKcal: number;
  /** recorded workouts that are never inside the all-day total (manual, Strava, JoyoFit strength without the watch's total) */
  otherWorkoutKcal: number;
  /** COMPAT, old clients (native builds up to 1932, web tabs opened before the TDEE deploy) read it on Beranda and in snack advice. Always 0 now. */
  assumedKcal: 0;
  /** the day's measured activity: (all-day total, else the device workouts) + other workouts; the "terbakar" of the exercise screens */
  activeKcal: number;
  /** the part of the day's activity that goes beyond the factor: what pct is taken of */
  extraKcal: number;
  /** what is added to the day's budget for activity; 0 while the setting is off */
  countedKcal: number;
  /** the cap cut the amount */
  capped: boolean;
}

/** pct of `extraKcal`, cut at `cap`; 0 while the setting is off. */
function countedOf(extraKcal: number, credit: Pick<ExerciseCredit, "enabled" | "pct" | "cap">) {
  const share = (extraKcal * credit.pct) / 100;
  const limit = credit.cap === "none" ? Infinity : credit.cap;
  return {
    countedKcal: credit.enabled ? Math.round(Math.min(limit, share)) : 0,
    capped: credit.enabled && share > limit,
  };
}

/**
 * The activity that raises the budget:
 *   extra = max(0, allDay - included) + workouts that are not inside the all-day total
 * and, on a day without a valid all-day reading, the recorded device workouts (the factor is the person's daily life
 * without logged workouts, so those are on top of it) + the other workouts.
 * counted = min(cap, pct x extra). A valid all-day total is trusted over the separate workout entries of the watch and
 * the health stores: it already contains them and is the better measure (an imported workout can carry an inflated
 * estimate). Activity never lowers the base: below `includedKcal` the all-day total adds nothing.
 */
export function exerciseCredit(input: {
  settings: AddBackSettings;
  rows: readonly CreditExerciseRow[];
  readings: readonly AllDayReading[];
  /** the day's step count; null when no step source synced */
  steps: number | null;
  /** Targets.includedKcal of the plan the credit is added to */
  includedKcal: number;
}): ExerciseCredit {
  const { settings } = input;
  const allDay = allDayActive(input.readings, input.steps);
  let deviceWorkoutKcal = 0;
  let otherWorkoutKcal = 0;
  for (const row of input.rows) {
    if (row.source === "rest") continue;
    if (insideAllDay(row, allDay?.source ?? null)) deviceWorkoutKcal += row.kcal;
    else otherWorkoutKcal += row.kcal;
  }
  const activeKcal = (allDay?.kcal ?? deviceWorkoutKcal) + otherWorkoutKcal;
  const extraKcal = (allDay ? Math.max(0, allDay.kcal - input.includedKcal) : deviceWorkoutKcal) + otherWorkoutKcal;
  return {
    enabled: settings.enabled,
    pct: settings.pct,
    cap: settings.cap,
    allDayKcal: allDay ? Math.round(allDay.kcal) : null,
    allDaySource: allDay?.source ?? null,
    includedKcal: Math.round(input.includedKcal),
    assumedKcal: 0,
    deviceWorkoutKcal: Math.round(deviceWorkoutKcal),
    otherWorkoutKcal: Math.round(otherWorkoutKcal),
    activeKcal: Math.round(activeKcal),
    extraKcal: Math.round(extraKcal),
    ...countedOf(extraKcal, settings),
  };
}

/** The day's budget: the plan's base eat target plus the counted activity beyond the factor. */
export function budgetKcal(baseEatKcal: number, credit: Pick<ExerciseCredit, "countedKcal">): number {
  return baseEatKcal + credit.countedKcal;
}

/**
 * The "terbakar" of the exercise screens' ring: the day's activity as the budget reads it (the all-day total plus the
 * workouts it does not contain), not the sum of the listed rows. The rows overlap the all-day total and an imported one
 * can carry an inflated estimate (15 Okt: two listed walks of 471 and 650 kcal, 254 measured). Without the day's credit
 * (still loading, no profile yet) it is the sum of the rows.
 */
export function dayActiveKcal(credit: Pick<ExerciseCredit, "activeKcal"> | null | undefined, rowsKcal: number): number {
  return credit ? credit.activeKcal : rowsKcal;
}

/**
 * The credit after a workout of `deltaKcal` was added (or removed, negative) by hand: what a client shows between an
 * optimistic edit and the refetch. A manual row always adds on top; the server recomputes the exact figure.
 */
export function shiftWorkoutKcal(credit: ExerciseCredit, deltaKcal: number): ExerciseCredit {
  const otherWorkoutKcal = Math.max(0, credit.otherWorkoutKcal + deltaKcal);
  const activeKcal = (credit.allDayKcal ?? credit.deviceWorkoutKcal) + otherWorkoutKcal;
  const extraKcal =
    (credit.allDayKcal === null ? credit.deviceWorkoutKcal : Math.max(0, credit.allDayKcal - credit.includedKcal)) +
    otherWorkoutKcal;
  return { ...credit, otherWorkoutKcal, activeKcal, extraKcal, ...countedOf(extraKcal, credit) };
}
