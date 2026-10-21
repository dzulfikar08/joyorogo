// Two phones can import the same real workout: Android reads it from Health Connect, an iPhone from Apple Health, and
// the two sources never share an external id. A workout is the same one when the other source already holds a row on
// the same day with the same type and a duration within a couple of minutes. Each stored row stands for one
// workout, so it can absorb only one incoming candidate (two real 30-minute walks in a day both stay).
//
// JoyoFit reaches the diary two ways for a watch workout: it writes the session to Health Connect / Apple Health (which
// JoyoRogo imports) and it sends the energy itself (`exercise.upsertJoyofit`, external id `watch:<start>`), so the diary
// does not depend on JoyoRogo's read access to the health store. The two rows are one workout: `diaryMatcher` compares
// them by workout class, because the two sides name the type differently ("Walk" vs "jalan_cepat").

export const CROSS_SOURCE_DURATION_TOLERANCE_MIN = 2;

/** `exercise_log.external_id` prefix of the rows JoyoFit sends for a watch workout. */
export const WATCH_EXTERNAL_PREFIX = "watch:";

export const isWatchExternalId = (externalId: string | null): boolean =>
  externalId !== null && externalId.startsWith(WATCH_EXTERNAL_PREFIX);

export interface ImportedWorkoutRow {
  date: string;
  type: string | null;
  durationMin: number | null;
}

export interface ImportCandidate {
  date: string;
  type: string;
  durationMin: number;
}

/** Type names of Health Connect / Apple Health / Strava and JoyoRogo's own keys that mean the same kind of workout. */
const WORKOUT_CLASS: Readonly<Record<string, string>> = {
  Walk: "walk",
  Hike: "walk",
  jalan: "walk",
  jalan_cepat: "walk",
  Run: "run",
  TrailRun: "run",
  Treadmill: "run",
  lari: "run",
  Ride: "ride",
  VirtualRide: "ride",
  EBikeRide: "ride",
  sepeda: "ride",
  sepeda_cepat: "ride",
  Swim: "swim",
  berenang: "swim",
  WeightTraining: "strength",
  angkat_beban: "strength",
  Yoga: "yoga",
  yoga: "yoga",
  Badminton: "badminton",
  badminton: "badminton",
  Soccer: "soccer",
  futsal: "soccer",
  OtherWorkout: "other",
  latihan: "other",
};

/** The kind of workout a stored type stands for; a type nobody mapped is its own kind. */
export function workoutClassOf(type: string | null): string | null {
  if (type === null) return null;
  return WORKOUT_CLASS[type] ?? type;
}

type TypeKey = (type: string | null) => string | null;

function makeMatcher<T extends ImportedWorkoutRow>(rows: readonly T[], typeKey: TypeKey) {
  const free = [...rows];
  return {
    /** The stored row the candidate is a duplicate of (consumed: it cannot absorb a second candidate), or null. */
    take(candidate: ImportCandidate): T | null {
      const key = typeKey(candidate.type);
      const index = free.findIndex(
        (row) =>
          row.date === candidate.date &&
          typeKey(row.type) === key &&
          row.durationMin !== null &&
          Math.abs(row.durationMin - candidate.durationMin) <= CROSS_SOURCE_DURATION_TOLERANCE_MIN,
      );
      if (index < 0) return null;
      return free.splice(index, 1)[0] ?? null;
    },
    /** The rows no candidate consumed. */
    remaining(): T[] {
      return [...free];
    },
  };
}

/** A matcher over the rows the other import source already stored; `claim` is true when it consumed a row for the candidate. */
export function crossSourceMatcher(otherSourceRows: readonly ImportedWorkoutRow[]) {
  const matcher = makeMatcher(otherSourceRows, (type) => type);
  return {
    claim: (candidate: ImportCandidate): boolean => matcher.take(candidate) !== null,
  };
}

/** Like {@link crossSourceMatcher} but compares workout classes and hands back the row it consumed. */
export function diaryMatcher<T extends ImportedWorkoutRow>(rows: readonly T[]) {
  return makeMatcher(rows, workoutClassOf);
}

/**
 * The stored row that already stands for `candidate`, or null when the candidate is a workout of its own. `watchRows` are
 * JoyoFit's `watch:` rows, `importedRows` the Health Connect / Apple Health ones, both of the candidate's day. Rows of the
 * two kinds that already stand for the same workout are paired off first, so a row that is spoken for cannot absorb a
 * second candidate. `from` is the side the candidate comes from; it is absorbed by a free row of the other side.
 */
export function absorbingRow<T extends ImportedWorkoutRow>(
  candidate: ImportCandidate,
  from: "watch" | "imported",
  watchRows: readonly T[],
  importedRows: readonly T[],
): T | null {
  const [mine, theirs] = from === "watch" ? [watchRows, importedRows] : [importedRows, watchRows];
  const paired = diaryMatcher(theirs);
  for (const row of mine) {
    if (row.type === null || row.durationMin === null) continue;
    paired.take({ date: row.date, type: row.type, durationMin: row.durationMin });
  }
  return diaryMatcher(paired.remaining()).take(candidate);
}
