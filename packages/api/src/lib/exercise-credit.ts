// "Sisa" adds back real activity. The eat target is BMR less the plan's deficit (engine.ts computeTargets): no daily
// movement is assumed, so what the person really moved is added on top. This file is the one place that decides how
// much. Pure: no i18n, no database. Settings live in the account preferences (rogo-prefs.ts) and are read by the server
// (exercise-credit-store.ts). Contract for humans: docs/energy-model.md.

/** 500 / 1000 / 1500 kcal a day, or no cap. */
export const ADD_BACK_CAPS = [500, 1000, 1500, "none"] as const;
export type AddBackCap = (typeof ADD_BACK_CAPS)[number];

/** Share of the day's activity that is counted, in percent. */
export const ADD_BACK_PCT = { min: 50, max: 100, step: 5 } as const;

/** "Aktivitas harian (perkiraan)": kcal for a day with no all-day data. None / light / moderate / active. */
export const ASSUMED_ACTIVITY_KCAL = [0, 150, 300, 500] as const;
export type AssumedActivityKcal = (typeof ASSUMED_ACTIVITY_KCAL)[number];

export interface AddBackSettings {
  enabled: boolean;
  pct: number;
  cap: AddBackCap;
  /** added to the base on days without all-day data; not multiplied by `pct` */
  assumedKcal: AssumedActivityKcal;
}

export const DEFAULT_ADD_BACK_SETTINGS: AddBackSettings = {
  enabled: true,
  pct: 75,
  cap: 1000,
  assumedKcal: 0,
};

/** The preference keys behind the settings (rogo-prefs.ts SPECS), one record each. */
export const ADD_BACK_PREF_KEYS = [
  "exercise.addBack.enabled",
  "exercise.addBack.pct",
  "exercise.addBack.cap",
  "exercise.assumedActive",
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
  "exercise.assumedActive": (value) => ASSUMED_ACTIVITY_KCAL.find((kcal) => kcal === value),
};

/** Settings from the stored preference values: a missing or malformed one falls back to its default. */
export function addBackSettings(values: Partial<Record<AddBackPrefKey, unknown>>): AddBackSettings {
  const pick = (key: AddBackPrefKey) => ADD_BACK_SANITIZERS[key](values[key]);
  return {
    enabled: (pick("exercise.addBack.enabled") as boolean | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.enabled,
    pct: (pick("exercise.addBack.pct") as number | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.pct,
    cap: (pick("exercise.addBack.cap") as AddBackCap | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.cap,
    assumedKcal: (pick("exercise.assumedActive") as AssumedActivityKcal | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.assumedKcal,
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
  /** recorded workouts of the watch and health stores: replaced by the all-day total when there is one, counted when not */
  deviceWorkoutKcal: number;
  /** recorded workouts that are never inside the all-day total (manual, Strava, JoyoFit strength without the watch's total) */
  otherWorkoutKcal: number;
  /** the day's activity: (all-day total, else the device workouts) + other workouts; what pct is taken of */
  activeKcal: number;
  /** added to the base on a day without all-day data (not multiplied by pct); 0 on a day with it */
  assumedKcal: number;
  /** what is added to the day's budget for activity; 0 while the setting is off */
  countedKcal: number;
  /** the cap cut the amount */
  capped: boolean;
}

/**
 * activeKcal = (allDay, or the device workouts when there is no all-day total) + other workouts;
 * counted = min(cap, pct x activeKcal). A valid all-day total is trusted over the separate workout entries of the watch
 * and the health stores: it already contains them and is the better measure (an imported workout can carry
 * an inflated estimate). Without one the workouts count and the assumed activity of the setting is added to the
 * base instead.
 */
export function exerciseCredit(input: {
  settings: AddBackSettings;
  rows: readonly CreditExerciseRow[];
  readings: readonly AllDayReading[];
  /** the day's step count; null when no step source synced */
  steps: number | null;
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
  const share = (activeKcal * settings.pct) / 100;
  const limit = settings.cap === "none" ? Infinity : settings.cap;
  return {
    enabled: settings.enabled,
    pct: settings.pct,
    cap: settings.cap,
    allDayKcal: allDay ? Math.round(allDay.kcal) : null,
    allDaySource: allDay?.source ?? null,
    deviceWorkoutKcal: Math.round(deviceWorkoutKcal),
    otherWorkoutKcal: Math.round(otherWorkoutKcal),
    activeKcal: Math.round(activeKcal),
    assumedKcal: allDay ? 0 : settings.assumedKcal,
    countedKcal: settings.enabled ? Math.round(Math.min(limit, share)) : 0,
    capped: settings.enabled && share > limit,
  };
}

/** The day's budget: the plan's base eat target plus the assumed activity (days without all-day data) and the counted activity. */
export function budgetKcal(baseEatKcal: number, credit: Pick<ExerciseCredit, "assumedKcal" | "countedKcal">): number {
  return baseEatKcal + credit.assumedKcal + credit.countedKcal;
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
  const share = (activeKcal * credit.pct) / 100;
  const limit = credit.cap === "none" ? Infinity : credit.cap;
  return {
    ...credit,
    otherWorkoutKcal,
    activeKcal,
    countedKcal: credit.enabled ? Math.round(Math.min(limit, share)) : 0,
    capped: credit.enabled && share > limit,
  };
}

/** Whether the one-time "how Sisa is counted changed" notice shows: an account made before the change, not yet closed. */
export function showAddBackNotice(input: { accountCreatedAtMs: number; dismissed: boolean }): boolean {
  return !input.dismissed && input.accountCreatedAtMs < ADD_BACK_NOTICE_BEFORE_MS;
}

/** Accounts created before this moment (the deploy of the second change) see the notice. */
export const ADD_BACK_NOTICE_BEFORE_MS = Date.UTC(2026, 9, 18, 13, 30, 0);
