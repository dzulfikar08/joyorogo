import { orpc } from "@/utils/orpc";

/**
 * Target shapes for the Hevy-style workout flow. BackendWorkout implements
 * these on orpc.workout.*; this module is the single place that casts the
 * (temporarily older) generated client to the contract. Once the API lands,
 * swap the cast at the bottom for the real client and delete the duplicated
 * types in favour of api-types.ts.
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

export type PreviousEntry = {
  setType: SetType;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
};

export type RoutineSet = {
  setType: SetType;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
};

export type Routine = {
  id: string;
  name: string;
  note: string | null;
  exercises: {
    exerciseId: string;
    restSec: number | null;
    note: string | null;
    sets: RoutineSet[];
  }[];
  updatedAt: string;
};

export type SaveSessionInput = {
  id?: string;
  date: string;
  name: string;
  durationMin?: number;
  note?: string;
  startedAt?: string;
  sets: {
    exerciseId: string;
    setType?: SetType;
    reps: number | null;
    weightKg: number | null;
    durationSec?: number | null;
    note?: string;
    supersetGroup?: number | null;
  }[];
};

export type PrRecord = {
  exerciseId: string;
  kind: "weight" | "one_rm" | "reps" | "set_volume";
  value: number;
  previous: number | null;
};

export type SaveSessionOutput = { id: string; prs: PrRecord[] };

export type RoutineInput = {
  id?: string;
  name: string;
  note?: string;
  exercises: {
    exerciseId: string;
    restSec: number | null;
    note?: string;
    sets: RoutineSet[];
  }[];
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

/** Minimal dynamic view of the orpc client; every call is cast at this boundary. */
const rawWorkout = orpc.workout as unknown as Record<
  string,
  (input?: unknown) => Promise<unknown>
> & { routines: Record<string, (input?: unknown) => Promise<unknown>> };

/** Contract-typed view of orpc.workout; routines live on the nested path. */
export const workoutApi = {
  catalog: () => rawWorkout.catalog() as Promise<Catalog>,
  createCustomExercise: (input: {
    name: string;
    muscle: string;
    equipment: string;
    type: ExerciseType;
  }) => rawWorkout.createCustomExercise(input) as Promise<CatalogExercise>,
  deleteCustomExercise: (input: { id: string }) =>
    rawWorkout.deleteCustomExercise(input) as Promise<{ ok: true }>,
  previous: (input: { exerciseIds: string[] }) =>
    rawWorkout.previous(input) as Promise<Record<string, PreviousEntry[]>>,
  saveSession: (input: SaveSessionInput) =>
    rawWorkout.saveSession(input) as Promise<SaveSessionOutput>,
  listRoutines: () => rawWorkout.routines.listRoutines() as Promise<Routine[]>,
  saveRoutine: (input: RoutineInput) =>
    rawWorkout.routines.saveRoutine(input) as Promise<{ id: string }>,
  deleteRoutine: (input: { id: string }) =>
    rawWorkout.routines.deleteRoutine(input) as Promise<{ ok: true }>,
  exerciseHistory: (input: { exerciseId: string; limit?: number }) =>
    rawWorkout.exerciseHistory(input) as Promise<ExerciseHistory>,
};

/** Query-key prefix; matches orpc paths so invalidation hits both worlds. */
export const workoutQueryPrefix = ["workout"] as const;

export function invalidateWorkout(
  queryClient: { invalidateQueries: (opts: { queryKey?: readonly unknown[] }) => Promise<void> },
  extra?: readonly (readonly unknown[])[],
) {
  void queryClient.invalidateQueries({ queryKey: [...workoutQueryPrefix] });
  for (const key of extra ?? []) void queryClient.invalidateQueries({ queryKey: [...key] });
}
