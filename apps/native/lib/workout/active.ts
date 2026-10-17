import * as FileSystem from "expo-file-system/legacy";
import { useSyncExternalStore } from "react";

/** Catalog exercise kinds; drives which columns a set row shows. */
export type ExerciseType =
  | "weight_reps"
  | "bodyweight_reps"
  | "assisted"
  | "duration"
  | "distance_duration";

export type SetType = "normal" | "warmup" | "drop" | "failure";

/** One set row in the active workout. Inputs stay strings while editing. */
export type ActiveSet = {
  type: SetType;
  weightKg: string;
  reps: string;
  durationSec: string;
  done: boolean;
};

export type ActiveExercise = {
  exerciseId: string;
  name: string;
  type: ExerciseType;
  note: string;
  /** Shared superset id with the NEXT exercise; null = standalone. */
  supersetGroup: number | null;
  restSec: number | null;
  sets: ActiveSet[];
};

export type ActiveWorkout = {
  name: string;
  note: string;
  /** Epoch ms when the user tapped start. */
  startedAt: number;
  exercises: ActiveExercise[];
};

/** Next type when the SET cell is tapped: normal → warmup → drop → failure. */
export function nextSetType(type: SetType): SetType {
  if (type === "normal") return "warmup";
  if (type === "warmup") return "drop";
  if (type === "drop") return "failure";
  return "normal";
}

export function emptySet(type: SetType = "normal"): ActiveSet {
  return { type, weightKg: "", reps: "", durationSec: "", done: false };
}

export function newExercise(
  exercise: { id: string; name: string; type: ExerciseType },
  sets: ActiveSet[] = [emptySet()],
): ActiveExercise {
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    type: exercise.type,
    note: "",
    supersetGroup: null,
    restSec: 90,
    sets,
  };
}

// --- Store ------------------------------------------------------------------

let state: ActiveWorkout | null = null;
const listeners = new Set<() => void>();

const STORE_URI = `${FileSystem.documentDirectory ?? ""}latihan-aktif.json`;

/** Fire-and-forget persistence; the in-memory draft always keeps working. */
function persist() {
  if (state === null) {
    void FileSystem.deleteAsync(STORE_URI, { idempotent: true }).catch(() => {});
  } else {
    void FileSystem.writeAsStringAsync(STORE_URI, JSON.stringify(state)).catch(() => {});
  }
}

function emit() {
  persist();
  for (const listener of listeners) listener();
}

export function getActiveWorkout(): ActiveWorkout | null {
  return state;
}

export function setActiveWorkout(next: ActiveWorkout | null) {
  state = next;
  emit();
}

export function patchActiveWorkout(patch: (prev: ActiveWorkout) => ActiveWorkout) {
  if (state === null) return;
  state = patch(state);
  emit();
}

/** Restore the in-progress draft left over from a previous app run. */
export async function loadActiveWorkout(): Promise<ActiveWorkout | null> {
  if (state !== null) return state;
  try {
    const raw = await FileSystem.readAsStringAsync(STORE_URI);
    const parsed = JSON.parse(raw) as ActiveWorkout | null;
    if (parsed && Array.isArray(parsed.exercises)) state = parsed;
  } catch {
    state = null;
  }
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding; call once per screen that edits the draft. */
export function useActiveWorkout(): ActiveWorkout | null {
  return useSyncExternalStore(subscribe, getActiveWorkout);
}

// --- Derived numbers --------------------------------------------------------

export function setWeightKg(set: ActiveSet): number {
  const n = Number(set.weightKg.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setReps(set: ActiveSet): number {
  const n = Number(set.reps.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function setDurationSec(set: ActiveSet): number {
  const n = Number(set.durationSec.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function setVolume(set: ActiveSet): number {
  if (!set.done || set.type === "warmup") return 0;
  return setWeightKg(set) * setReps(set);
}

/** Total kg lifted across checked working sets. */
export function workoutVolume(workout: ActiveWorkout): number {
  return workout.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.reduce((s, set) => s + setVolume(set), 0),
    0,
  );
}

export function completedSetCount(workout: ActiveWorkout): number {
  return workout.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => set.done).length,
    0,
  );
}

export function uncheckedSetCount(workout: ActiveWorkout): number {
  return workout.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => !set.done).length,
    0,
  );
}

/** Epley estimated 1RM; the same formula the backend uses for PRs. */
export function epley1rm(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return weightKg * (1 + reps / 30);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Columns a set row shows for the given exercise type. */
export function showsWeight(type: ExerciseType): boolean {
  return type === "weight_reps" || type === "assisted";
}

export function showsDuration(type: ExerciseType): boolean {
  return type === "duration" || type === "distance_duration";
}
