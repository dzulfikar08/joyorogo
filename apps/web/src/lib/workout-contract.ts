import { orpc } from "@/utils/orpc";

/**
 * Typed view of the read-only workout archive. Strength logging moved to JoyoFit;
 * only reads of old logs remain, cast at this boundary.
 */

export type ExerciseType =
  | "weight_reps"
  | "bodyweight_reps"
  | "assisted"
  | "duration"
  | "distance_duration";

export type SetType = "normal" | "warmup" | "drop" | "failure";

export type CatalogExercise = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  type: ExerciseType;
  custom?: boolean;
};

export type Catalog = {
  exercises: CatalogExercise[];
  muscles: { id: string; label: string }[];
  equipment: { id: string; label: string }[];
};

export type ExerciseHistory = {
  sessions: {
    sessionId: string;
    date: string;
    sets: {
      setType: SetType;
      reps: number | null;
      weightKg: number | null;
      durationSec: number | null;
    }[];
  }[];
  best: { weightKg: number | null; oneRm: number | null; reps: number | null; setVolume: number | null };
  oneRmByDate: { date: string; oneRm: number }[];
};

const rawWorkout = orpc.workout as unknown as Record<string, (input?: unknown) => Promise<unknown>>;

export const workoutApi = {
  catalog: () => rawWorkout.catalog() as Promise<Catalog>,
  exerciseHistory: (input: { exerciseId: string; limit?: number }) =>
    rawWorkout.exerciseHistory(input) as Promise<ExerciseHistory>,
};

/** Query-key prefix; matches orpc paths. */
export const workoutQueryPrefix = ["workout"] as const;
