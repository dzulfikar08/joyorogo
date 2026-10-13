// Pure strength-training logic: weekly effective sets per muscle, missed-muscle
// warnings, Epley 1RM estimates, personal records, the "deficit too big"
// strength trend, session kcal, and built-in routines. Dates are WIB
// 'YYYY-MM-DD'; no I/O here so every boundary is testable.

import type { EquipmentKey, MuscleKey } from "./exercises";
import { MUSCLE_LABELS, exerciseById, exercisesForMuscle } from "./exercises";
import { estimateKcal, metByKey } from "./met";
import { shiftDate } from "./engine";

export type WorkoutSetLike = {
  exerciseId: string;
  reps: number | null;
  weightKg: number | null;
};

export type WorkoutSessionLike = {
  date: string;
  sets: readonly WorkoutSetLike[];
};

/** How a set was logged; anything but warmup counts toward records. */
export const SET_TYPES = ["normal", "warmup", "drop", "failure"] as const;

export type SetType = (typeof SET_TYPES)[number];

/** Minimal set shape for record math — satisfied by workout_set rows and saveSession input. */
export type RecordSetLike = {
  setType?: string | null;
  reps: number | null;
  weightKg: number | null;
  durationSec?: number | null;
};

export type RecordSessionLike = {
  sets: readonly (RecordSetLike & { exerciseId: string })[];
};

/** Warmups are practise, timed holds carry no reps — neither earns a record. */
export function isCountedSet(
  set: RecordSetLike,
): set is RecordSetLike & { reps: number } {
  return set.setType !== "warmup" && set.reps !== null && set.reps >= 1;
}

// Roadmap: primary muscle earns 1 effective set, secondary 0.5.
export const PRIMARY_SET = 1;
export const SECONDARY_SET = 0.5;

export const UNTRAINED_WINDOW_DAYS = 7;
/** Warnings need a habit, not a single curious session. */
export const MIN_SESSIONS_FOR_WARNINGS = 2;
/** "Jauh di bawah otot lain": below a third of the median trained muscle. */
export const LOW_VOLUME_MEDIAN_DIVISOR = 3;
export const LOW_VOLUME_MIN_MUSCLES = 4;

/** Angkat beban MET from the shared compendium — same number as manual entry. */
export const STRENGTH_MET = metByKey("angkat_beban");

export function sessionKcal(durationMin: number, weightKg: number): number {
  return estimateKcal(STRENGTH_MET, weightKg, Math.max(0, durationMin));
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function roundSets(sets: number): number {
  return Math.round(sets * 10) / 10;
}

/** Effective sets per muscle across sessions dated within [from, to]. */
export function weeklySetsPerMuscle(
  sessions: readonly WorkoutSessionLike[],
  from: string,
  to: string,
): Record<MuscleKey, number> {
  const totals = {} as Record<MuscleKey, number>;
  for (const m of Object.keys(MUSCLE_LABELS) as MuscleKey[]) totals[m] = 0;

  for (const session of sessions) {
    if (!inRange(session.date, from, to)) continue;
    for (const set of session.sets) {
      if (!isCountedSet(set)) continue;
      const exercise = exerciseById(set.exerciseId);
      if (!exercise) continue;
      for (const muscle of exercise.primary) totals[muscle] += PRIMARY_SET;
      for (const muscle of exercise.secondary) totals[muscle] += SECONDARY_SET;
    }
  }

  for (const m of Object.keys(totals) as MuscleKey[]) totals[m] = roundSets(totals[m]);
  return totals;
}

export type MissedMuscleWarning = {
  muscle: MuscleKey;
  label: string;
  kind: "untrained_7d" | "low_volume";
  /** effective sets over the last 7 days */
  weeklySets: number;
  message: string;
  suggestions: { id: string; name: string; equipment: EquipmentKey }[];
};

function fmtSets(sets: number): string {
  return String(Number(sets.toFixed(1)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Roadmap warnings, in severity order: muscles not trained in the last 7 days
 * come first, then trained muscles whose weekly volume sits far below the
 * median of trained muscles. Silent until the user has at least two sessions
 * in the last 28 days — a first-ever session must not produce ten nags.
 */
export function missedMuscleWarnings(
  sessions: readonly WorkoutSessionLike[],
  today: string,
): MissedMuscleWarning[] {
  const from7 = shiftDate(today, -(UNTRAINED_WINDOW_DAYS - 1));
  const from28 = shiftDate(today, -27);
  const last7 = sessions.filter((s) => inRange(s.date, from7, today));
  const last28 = sessions.filter((s) => inRange(s.date, from28, today));
  if (last28.length < MIN_SESSIONS_FOR_WARNINGS) return [];

  const doneIds = new Set<string>();
  for (const s of last28) for (const set of s.sets) doneIds.add(set.exerciseId);

  const weekly = weeklySetsPerMuscle(last7, from7, today);
  const trained = (Object.keys(weekly) as MuscleKey[]).filter((m) => weekly[m] > 0);
  const medianTrained = median(trained.map((m) => weekly[m]));

  const suggestionsFor = (muscle: MuscleKey) =>
    exercisesForMuscle(muscle)
      // stable sort: user's own movements surface first, catalog order breaks ties
      .sort((a, b) => Number(doneIds.has(b.id)) - Number(doneIds.has(a.id)))
      .slice(0, 3)
      .map((e) => ({ id: e.id, name: e.name, equipment: e.equipment }));

  const warnings: MissedMuscleWarning[] = [];
  for (const m of Object.keys(MUSCLE_LABELS) as MuscleKey[]) {
    if (weekly[m] > 0) continue;
    warnings.push({
      muscle: m,
      label: MUSCLE_LABELS[m],
      kind: "untrained_7d",
      weeklySets: 0,
      message: `${MUSCLE_LABELS[m]} belum dilatih minggu ini`,
      suggestions: suggestionsFor(m),
    });
  }

  if (trained.length >= LOW_VOLUME_MIN_MUSCLES) {
    const low = trained
      .filter((m) => weekly[m] * LOW_VOLUME_MEDIAN_DIVISOR < medianTrained)
      .sort((a, b) => weekly[a] - weekly[b]);
    for (const m of low) {
      warnings.push({
        muscle: m,
        label: MUSCLE_LABELS[m],
        kind: "low_volume",
        weeklySets: weekly[m],
        message: `${MUSCLE_LABELS[m]} cuma ${fmtSets(weekly[m])} set minggu ini, jauh di bawah otot lain`,
        suggestions: suggestionsFor(m),
      });
    }
  }

  return warnings;
}

/** Epley: weight x (1 + reps / 30); a true single is exactly the weight lifted. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps < 1) return 0;
  if (reps === 1) return Math.round(weightKg * 10) / 10;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export type PRKind = "weight" | "one_rm" | "reps" | "set_volume";

export type WorkoutPR = {
  exerciseId: string;
  kind: PRKind;
  value: number;
  /** best before this set; null when the exercise had no prior set of this kind */
  previous: number | null;
};

export type SetMetrics = {
  /** heaviest weight lifted (weighted sets only) */
  weightKg: number | null;
  /** best Epley estimate (weighted sets only) */
  oneRm: number | null;
  /** most reps in one set (weighted or bodyweight) */
  reps: number | null;
  /** heaviest single-set volume, weight x reps (weighted sets only) */
  setVolume: number | null;
};

/** Best of every record kind across counted sets; null means never done. */
export function bestSetMetrics(sets: readonly RecordSetLike[]): SetMetrics {
  let weightKg: number | null = null;
  let oneRm: number | null = null;
  let reps: number | null = null;
  let setVolume: number | null = null;
  for (const set of sets) {
    if (!isCountedSet(set)) continue;
    const weight = set.weightKg;
    if (weight !== null && weight > 0) {
      if (weightKg === null || weight > weightKg) weightKg = weight;
      const oneRmValue = estimate1RM(weight, set.reps);
      if (oneRm === null || oneRmValue > oneRm) oneRm = oneRmValue;
      const volume = Math.round(weight * set.reps * 10) / 10;
      if (setVolume === null || volume > setVolume) setVolume = volume;
    }
    if (reps === null || set.reps > reps) reps = set.reps;
  }
  return { weightKg, oneRm, reps, setVolume };
}

const PR_KIND_ORDER: [PRKind, (m: SetMetrics) => number | null][] = [
  ["weight", (m) => m.weightKg],
  ["one_rm", (m) => m.oneRm],
  ["reps", (m) => m.reps],
  ["set_volume", (m) => m.setVolume],
];

/**
 * Records earned by `currentSets` of one exercise versus every counted set
 * done before. An exercise attempted for the very first time earns nothing —
 * there is nothing to beat. A tie never beats the old record; the first
 * weighted set after a bodyweight-only history is still a new record with
 * previous null.
 */
export function exercisePRs(
  exerciseId: string,
  priorSets: readonly RecordSetLike[],
  currentSets: readonly RecordSetLike[],
): WorkoutPR[] {
  const prior = bestSetMetrics(priorSets);
  if (prior.weightKg === null && prior.oneRm === null && prior.reps === null && prior.setVolume === null) {
    return [];
  }
  const current = bestSetMetrics(currentSets);
  const prs: WorkoutPR[] = [];
  for (const [kind, pick] of PR_KIND_ORDER) {
    const value = pick(current);
    if (value === null) continue;
    const previous = pick(prior);
    if (previous !== null && value <= previous) continue;
    prs.push({ exerciseId, kind, value, previous });
  }
  return prs;
}

/**
 * Records across a whole saved session, grouped per exercise in stable
 * exerciseId order. `priorSessions` must NOT include the session being saved.
 */
export function sessionPRs(
  priorSessions: readonly RecordSessionLike[],
  currentSets: readonly (RecordSetLike & { exerciseId: string })[],
): WorkoutPR[] {
  const prior = new Map<string, RecordSetLike[]>();
  for (const session of priorSessions) {
    for (const set of session.sets) {
      const list = prior.get(set.exerciseId);
      if (list) list.push(set);
      else prior.set(set.exerciseId, [set]);
    }
  }
  const grouped = new Map<string, RecordSetLike[]>();
  for (const set of currentSets) {
    const list = grouped.get(set.exerciseId);
    if (list) list.push(set);
    else grouped.set(set.exerciseId, [set]);
  }
  return [...grouped.keys()]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((exerciseId) => exercisePRs(exerciseId, prior.get(exerciseId) ?? [], grouped.get(exerciseId) ?? []));
}

export type BestSet = {
  date: string;
  reps: number;
  weightKg: number | null;
  /** null for bodyweight sets — kg was never recorded */
  e1rm: number | null;
};

export type ExercisePR = {
  exerciseId: string;
  name: string;
  sessions: number;
  lastDate: string | null;
  /** best estimated 1RM across weighted sets; null for bodyweight-only history */
  best1RM: BestSet | null;
  /** the set to beat: highest e1RM, or highest reps when unweighted */
  bestSet: BestSet | null;
};

function betterSet(a: BestSet | null, b: BestSet): BestSet {
  if (!a) return b;
  const rank = (s: BestSet) => (s.e1rm ?? 0) * 1000 + s.reps;
  return rank(b) > rank(a) ? b : a;
}

function better1RM(a: BestSet | null, b: BestSet): BestSet | null {
  if (b.e1rm === null) return a;
  if (!a) return b;
  return (b.e1rm ?? 0) > (a.e1rm ?? 0) ? b : a;
}

/** Personal records per exercise over the whole history, most recent first. */
export function personalRecords(sessions: readonly WorkoutSessionLike[]): ExercisePR[] {
  const entries = new Map<
    string,
    { name: string; lastDate: string | null; best1RM: BestSet | null; bestSet: BestSet | null }
  >();
  // exerciseId -> indexes of distinct sessions containing it
  const sessionIndexes = new Map<string, Set<number>>();

  sessions.forEach((session, index) => {
    const counted = new Set<string>();
    for (const set of session.sets) {
      if (!isCountedSet(set)) continue;
      const exercise = exerciseById(set.exerciseId);
      if (!exercise) continue;
      let entry = entries.get(set.exerciseId);
      if (!entry) {
        entry = { name: exercise.name, lastDate: null, best1RM: null, bestSet: null };
        entries.set(set.exerciseId, entry);
      }
      const candidate: BestSet = {
        date: session.date,
        reps: set.reps,
        weightKg: set.weightKg,
        e1rm:
          set.weightKg !== null && set.weightKg > 0 ? estimate1RM(set.weightKg, set.reps) : null,
      };
      entry.bestSet = betterSet(entry.bestSet, candidate);
      entry.best1RM = better1RM(entry.best1RM, candidate);
      if (entry.lastDate === null || session.date > entry.lastDate) entry.lastDate = session.date;
      if (!counted.has(set.exerciseId)) {
        counted.add(set.exerciseId);
        const indexes = sessionIndexes.get(set.exerciseId) ?? new Set<number>();
        indexes.add(index);
        sessionIndexes.set(set.exerciseId, indexes);
      }
    }
  });

  return [...entries.entries()]
    .map(([exerciseId, entry]) => ({
      exerciseId,
      name: entry.name,
      sessions: sessionIndexes.get(exerciseId)?.size ?? 0,
      lastDate: entry.lastDate,
      best1RM: entry.best1RM,
      bestSet: entry.bestSet,
    }))
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
}

export const MAIN_LIFT_IDS = [
  "squat",
  "bench_press",
  "deadlift",
  "overhead_press",
  "leg_press",
] as const;

export const TREND_RECENT_DAYS = 14;
export const TREND_PRIOR_DAYS = 14;
/** Meaningful strength drop: ≥5% best e1RM vs the prior fortnight. */
export const TREND_DROP_PCT = 5;
/** "Berat turun cepat": ≤ -0.4 kg/week on the smoothed trend. */
export const FAST_LOSS_KG_PER_WEEK = 0.4;

export type StrengthTrendHint = {
  exerciseId: string;
  name: string;
  recentE1rm: number;
  priorE1rm: number;
  dropPct: number;
  message: string;
};

function bestE1rmIn(
  sessions: readonly WorkoutSessionLike[],
  exerciseId: string,
  from: string,
  to: string,
): number {
  let best = 0;
  for (const session of sessions) {
    if (!inRange(session.date, from, to)) continue;
    for (const set of session.sets) {
      if (set.exerciseId !== exerciseId || !isCountedSet(set)) continue;
      if (set.weightKg === null || set.weightKg <= 0) continue;
      best = Math.max(best, estimate1RM(set.weightKg, set.reps));
    }
  }
  return best;
}

/**
 * Roadmap guard: when the best e1RM of a main lift dropped meaningfully over
 * the last two weeks versus the prior fortnight while body weight is falling
 * fast, the deficit is eating muscle — suggest slowing the cut.
 */
export function strengthTrendHint(
  sessions: readonly WorkoutSessionLike[],
  options: { today: string; weeklyWeightChangeKg?: number | null },
): StrengthTrendHint | null {
  const { today, weeklyWeightChangeKg } = options;
  if (weeklyWeightChangeKg === undefined || weeklyWeightChangeKg === null) return null;
  if (weeklyWeightChangeKg > -FAST_LOSS_KG_PER_WEEK) return null;

  const recentFrom = shiftDate(today, -(TREND_RECENT_DAYS - 1));
  const priorFrom = shiftDate(today, -(TREND_RECENT_DAYS + TREND_PRIOR_DAYS - 1));
  const priorTo = shiftDate(today, -TREND_RECENT_DAYS);

  let worst: StrengthTrendHint | null = null;
  for (const id of MAIN_LIFT_IDS) {
    const recent = bestE1rmIn(sessions, id, recentFrom, today);
    const prior = bestE1rmIn(sessions, id, priorFrom, priorTo);
    if (prior <= 0 || recent <= 0) continue;
    const dropPct = Math.round((1 - recent / prior) * 100);
    if (dropPct < TREND_DROP_PCT) continue;
    if (worst && worst.dropPct >= dropPct) continue;
    const exercise = exerciseById(id);
    worst = {
      exerciseId: id,
      name: exercise?.name ?? id,
      recentE1rm: recent,
      priorE1rm: prior,
      dropPct,
      message: `Kekuatan ${exercise?.name ?? id} turun ${dropPct}% dua minggu terakhir selagi berat turun cepat — tanda defisit terlalu besar. Perlambat saja target turunnya.`,
    };
  }
  return worst;
}

export type WorkoutTemplateExercise = {
  exerciseId: string;
  sets: number;
  targetReps: number;
};

export type WorkoutTemplate = {
  id: string;
  name: string;
  summary: string;
  exercises: WorkoutTemplateExercise[];
};

function tpl(
  id: string,
  name: string,
  summary: string,
  exercises: [string, number, number][],
): WorkoutTemplate {
  return {
    id,
    name,
    summary,
    exercises: exercises.map(([exerciseId, sets, targetReps]) => ({
      exerciseId,
      sets,
      targetReps,
    })),
  };
}

export const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  tpl("push", "Push (Dorong)", "Dada, bahu, triceps", [
    ["bench_press", 3, 8],
    ["overhead_press", 3, 8],
    ["incline_dumbbell_press", 3, 10],
    ["lateral_raise", 3, 12],
    ["triceps_pushdown", 3, 12],
  ]),
  tpl("pull", "Pull (Tarik)", "Punggung, biceps", [
    ["lat_pulldown", 3, 10],
    ["barbell_row", 3, 8],
    ["face_pull", 3, 15],
    ["dumbbell_curl", 3, 12],
    ["wrist_curl", 2, 15],
  ]),
  tpl("legs", "Legs (Kaki)", "Quadriceps, glutes, hamstring, betis", [
    ["squat", 3, 8],
    ["leg_press", 3, 10],
    ["romanian_deadlift", 3, 8],
    ["leg_curl", 3, 12],
    ["standing_calf_raise", 4, 15],
  ]),
  tpl("fullbody", "Full Body", "Semua otot dalam satu sesi", [
    ["squat", 3, 8],
    ["bench_press", 3, 8],
    ["barbell_row", 3, 8],
    ["overhead_press", 2, 10],
    ["leg_raise", 3, 15],
  ]),
];
