// "Sisa" adds back exercise. The eat target is built on a sedentary TDEE (engine.ts computeTargets), so the movement
// of the day is not in it; the part of the recorded exercise the person chooses to count is added on top. This file
// is the one place that decides how much. Pure: no i18n, no database. Settings live in the account preferences
// (rogo-prefs.ts) and are read by the server (exercise-credit-store.ts). Contract for humans: docs/energy-model.md.

export const ADD_BACK_SOURCES = ["workouts", "workouts+steps"] as const;
export type AddBackSource = (typeof ADD_BACK_SOURCES)[number];

/** 500 / 1000 / 1500 kcal a day, or no cap. */
export const ADD_BACK_CAPS = [500, 1000, 1500, "none"] as const;
export type AddBackCap = (typeof ADD_BACK_CAPS)[number];

/** Share of the exercise that is counted, in percent. */
export const ADD_BACK_PCT = { min: 50, max: 100, step: 5 } as const;
/** Steps a day below which walking is not counted as exercise. */
export const ADD_BACK_STEP_THRESHOLD = { min: 3000, max: 10000, step: 500 } as const;

export interface AddBackSettings {
  enabled: boolean;
  pct: number;
  source: AddBackSource;
  stepThreshold: number;
  cap: AddBackCap;
}

export const DEFAULT_ADD_BACK_SETTINGS: AddBackSettings = {
  enabled: true,
  pct: 75,
  source: "workouts",
  stepThreshold: 5000,
  cap: 1000,
};

/** The preference keys behind the settings (rogo-prefs.ts SPECS), one record each. */
export const ADD_BACK_PREF_KEYS = [
  "exercise.addBack.enabled",
  "exercise.addBack.pct",
  "exercise.addBack.source",
  "exercise.addBack.stepThreshold",
  "exercise.addBack.cap",
] as const;
export type AddBackPrefKey = (typeof ADD_BACK_PREF_KEYS)[number];

const isStepOf = (value: unknown, range: { min: number; max: number; step: number }): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= range.min &&
  value <= range.max &&
  (value - range.min) % range.step === 0;

/** Per-key sanitizers: the value or undefined when it is not one this build accepts. */
export const ADD_BACK_SANITIZERS: Record<AddBackPrefKey, (value: unknown) => unknown | undefined> = {
  "exercise.addBack.enabled": (value) => (typeof value === "boolean" ? value : undefined),
  "exercise.addBack.pct": (value) => (isStepOf(value, ADD_BACK_PCT) ? value : undefined),
  "exercise.addBack.source": (value) => ADD_BACK_SOURCES.find((source) => source === value),
  "exercise.addBack.stepThreshold": (value) => (isStepOf(value, ADD_BACK_STEP_THRESHOLD) ? value : undefined),
  "exercise.addBack.cap": (value) => ADD_BACK_CAPS.find((cap) => cap === value),
};

/** Settings from the stored preference values: a missing or malformed one falls back to its default. */
export function addBackSettings(values: Partial<Record<AddBackPrefKey, unknown>>): AddBackSettings {
  const pick = <K extends AddBackPrefKey>(key: K) => ADD_BACK_SANITIZERS[key](values[key]);
  const enabled = pick("exercise.addBack.enabled");
  const pct = pick("exercise.addBack.pct");
  const source = pick("exercise.addBack.source");
  const stepThreshold = pick("exercise.addBack.stepThreshold");
  const cap = pick("exercise.addBack.cap");
  return {
    enabled: (enabled as boolean | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.enabled,
    pct: (pct as number | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.pct,
    source: (source as AddBackSource | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.source,
    stepThreshold: (stepThreshold as number | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.stepThreshold,
    cap: (cap as AddBackCap | undefined) ?? DEFAULT_ADD_BACK_SETTINGS.cap,
  };
}

/**
 * Net kcal one step costs per kg of body weight. Walking on the flat costs about 0.5 kcal per kg per km
 * (ACSM walking equation at 3 km/h: ~0.1 ml O2/kg/m above rest, 5 kcal per litre); a step is 0.7 to 0.8 m,
 * so 0.0004 kcal/kg/step. 0.0005 rounds up for brisker walking and stairs.
 */
export const STEP_KCAL_PER_KG = 0.0005;

/**
 * Steps per minute a recorded walking or running workout already contains, by exercise type (lib/met.ts). The
 * steps counter does not know which steps belong to a workout; subtracting these keeps a recorded walk from being
 * counted twice. Workouts of other types (cycling, gym, swim) and rows without a type or duration subtract nothing.
 */
export const WORKOUT_CADENCE_SPM: Record<string, number> = { jalan: 100, jalan_cepat: 115, lari: 160 };

export interface CreditExerciseRow {
  kcal: number;
  /** 'rest' rows mark a planned day off, never movement */
  source?: string | null;
  type?: string | null;
  durationMin?: number | null;
}

export interface ExerciseCredit {
  enabled: boolean;
  pct: number;
  source: AddBackSource;
  stepThreshold: number;
  cap: AddBackCap;
  /** recorded exercise of the day (every source but 'rest') */
  workoutKcal: number;
  /** the steps above the threshold as kcal; 0 unless the source includes steps */
  stepKcal: number;
  /** steps that count: the day's steps minus those inside recorded walks and runs, above the threshold */
  countedSteps: number;
  /** what is added to the day's budget; 0 while the setting is off */
  countedKcal: number;
  /** the cap cut the amount */
  capped: boolean;
}

/** Recorded exercise (plus steps above the threshold when asked) times the share, capped. */
export function exerciseCredit(input: {
  settings: AddBackSettings;
  rows: readonly CreditExerciseRow[];
  /** the day's step count; null when no step source synced */
  steps: number | null;
  weightKg: number;
}): ExerciseCredit {
  const { settings } = input;
  const workouts = input.rows.filter((row) => row.source !== "rest");
  const workoutKcal = workouts.reduce((sum, row) => sum + row.kcal, 0);

  let stepKcal = 0;
  let countedSteps = 0;
  if (settings.source === "workouts+steps" && input.steps !== null) {
    const inWorkouts = workouts.reduce(
      (sum, row) => sum + (WORKOUT_CADENCE_SPM[row.type ?? ""] ?? 0) * (row.durationMin ?? 0),
      0,
    );
    countedSteps = Math.max(0, Math.round(input.steps - inWorkouts) - settings.stepThreshold);
    stepKcal = countedSteps * STEP_KCAL_PER_KG * input.weightKg;
  }

  return applyShare({
    ...settings,
    workoutKcal: Math.round(workoutKcal),
    stepKcal: Math.round(stepKcal),
    countedSteps,
  });
}

type CreditInputs = Omit<ExerciseCredit, "countedKcal" | "capped">;

/** The share of workouts plus step kcal, capped: the one place `countedKcal` and `capped` are decided. */
function applyShare(credit: CreditInputs): ExerciseCredit {
  const share = ((credit.workoutKcal + credit.stepKcal) * credit.pct) / 100;
  const limit = credit.cap === "none" ? Infinity : credit.cap;
  return {
    ...credit,
    countedKcal: credit.enabled ? Math.round(Math.min(limit, share)) : 0,
    capped: credit.enabled && share > limit,
  };
}

/**
 * The credit after a workout of `deltaKcal` was added (or removed, negative): what a client shows between an
 * optimistic edit and the refetch. Step kcal stay as they were; the server recomputes the exact figure.
 */
export function shiftWorkoutKcal(credit: ExerciseCredit, deltaKcal: number): ExerciseCredit {
  return applyShare({ ...credit, workoutKcal: Math.max(0, credit.workoutKcal + deltaKcal) });
}

/**
 * The day's budget: the base eat target plus the counted exercise. Sisa is this minus what was eaten
 * (engine.ts remainingKcal). Hamil / Menyusui and Naikin BB use the same sum: more movement only ever raises it.
 */
export function dayBudgetKcal(baseEatKcal: number, credit: Pick<ExerciseCredit, "countedKcal">): number {
  return baseEatKcal + credit.countedKcal;
}

/** Whether the one-time "how Sisa is counted changed" notice shows: an account made before the change, not yet closed. */
export function showAddBackNotice(input: { accountCreatedAtMs: number; dismissed: boolean }): boolean {
  return !input.dismissed && input.accountCreatedAtMs < ADD_BACK_NOTICE_BEFORE_MS;
}

/** Accounts created before this moment (the deploy of the change) see the notice. */
export const ADD_BACK_NOTICE_BEFORE_MS = Date.UTC(2026, 9, 18, 12, 30, 0);
