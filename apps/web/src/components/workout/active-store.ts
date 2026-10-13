import type { ExerciseType, Routine, SetType } from "@/lib/workout-contract";

/**
 * In-progress workout, persisted to localStorage so a refresh or app kill
 * resumes where the user left off.
 */

export type ActiveSet = {
  id: string;
  setType: SetType;
  reps: string;
  weightKg: string;
  durationSec: string;
  done: boolean;
};

export type ActiveExercise = {
  uid: string;
  exerciseId: string;
  note: string;
  /** Rest timer length in seconds; null = timer off. */
  restSec: number | null;
  supersetGroup: number | null;
  sets: ActiveSet[];
};

export type ActiveWorkout = {
  name: string;
  note: string;
  startedAt: string;
  exercises: ActiveExercise[];
};

const STORAGE_KEY = "jrg-active-workout";
const RECENT_KEY = "jrg-workout-recent";

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function loadActive(): ActiveWorkout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveWorkout;
    if (!parsed.startedAt || !Array.isArray(parsed.exercises)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveActive(workout: ActiveWorkout): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workout));
}

export function clearActive(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function emptyWorkout(): ActiveWorkout {
  return { name: "", note: "", startedAt: new Date().toISOString(), exercises: [] };
}

export function makeSet(previous?: Partial<ActiveSet>): ActiveSet {
  return {
    setType: "normal",
    reps: "",
    weightKg: "",
    durationSec: "",
    done: false,
    ...previous,
    id: newId(),
  };
}

/** Exercise columns depend on the catalog type. */
export function exerciseColumns(type: ExerciseType): {
  weight: boolean;
  reps: boolean;
  duration: boolean;
} {
  return {
    weight: type === "weight_reps" || type === "bodyweight_reps" || type === "assisted",
    reps: type === "weight_reps" || type === "bodyweight_reps" || type === "assisted",
    duration: type === "duration" || type === "distance_duration",
  };
}

export function defaultRestSec(type: ExerciseType): number | null {
  return type === "duration" || type === "distance_duration" ? null : 90;
}

export function workoutFromRoutine(routine: Routine, typeOf: (id: string) => ExerciseType): ActiveWorkout {
  return {
    name: routine.name,
    note: "",
    startedAt: new Date().toISOString(),
    exercises: routine.exercises.map((item) => ({
      uid: newId(),
      exerciseId: item.exerciseId,
      note: item.note ?? "",
      restSec: item.restSec ?? defaultRestSec(typeOf(item.exerciseId)),
      supersetGroup: null,
      sets: (item.sets.length > 0 ? item.sets : [null]).map((set) =>
        makeSet({
          setType: set?.setType ?? "normal",
          reps: set?.reps != null ? String(set.reps) : "",
          weightKg: set?.weightKg != null ? String(set.weightKg) : "",
          durationSec: set?.durationSec != null ? String(set.durationSec) : "",
        }),
      ),
    })),
  };
}

/** "Ulangi sesi terakhir": same movements and sets, fresh active workout. */
export function workoutFromSessionItem(item: {
  session: { name: string };
  sets: { exerciseId: string; reps: number | null; weightKg: number | null; durationSec?: number | null }[];
  typeOf: (exerciseId: string) => ExerciseType;
}): ActiveWorkout {
  const exercises: ActiveExercise[] = [];
  const byId: Record<string, ActiveExercise> = {};
  for (const set of item.sets) {
    let exercise = byId[set.exerciseId];
    if (!exercise) {
      exercise = {
        uid: newId(),
        exerciseId: set.exerciseId,
        note: "",
        restSec: defaultRestSec(item.typeOf(set.exerciseId)),
        supersetGroup: null,
        sets: [],
      };
      byId[set.exerciseId] = exercise;
      exercises.push(exercise);
    }
    exercise.sets.push(
      makeSet({
        reps: set.reps != null ? String(set.reps) : "",
        weightKg: set.weightKg != null ? String(set.weightKg) : "",
        durationSec: set.durationSec != null ? String(set.durationSec) : "",
      }),
    );
  }
  return {
    name: item.session.name,
    note: "",
    startedAt: new Date().toISOString(),
    exercises,
  };
}

/** Recently used exercise ids (most recent first) for the picker. */
export function loadRecentExerciseIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function rememberExercises(ids: string[]): void {
  if (ids.length === 0) return;
  const next = [...new Set([...ids, ...loadRecentExerciseIds()])].slice(0, 20);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
