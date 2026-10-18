// Two phones can import the same real workout: Android reads it from Health Connect, an iPhone from Apple Health, and
// the two sources never share an external id. A workout is the same one when the other source already holds a row on
// the same WIB day with the same type and a duration within a couple of minutes. Each stored row stands for one
// workout, so it can absorb only one incoming candidate (two real 30-minute walks in a day both stay).

export const CROSS_SOURCE_DURATION_TOLERANCE_MIN = 2;

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

/** A matcher over the rows the other import source already stored; `claim` is true when it consumed a row for the candidate. */
export function crossSourceMatcher(otherSourceRows: readonly ImportedWorkoutRow[]) {
  const free = [...otherSourceRows];
  return {
    claim(candidate: ImportCandidate): boolean {
      const index = free.findIndex(
        (row) =>
          row.date === candidate.date &&
          row.type === candidate.type &&
          row.durationMin !== null &&
          Math.abs(row.durationMin - candidate.durationMin) <= CROSS_SOURCE_DURATION_TOLERANCE_MIN,
      );
      if (index < 0) return false;
      free.splice(index, 1);
      return true;
    },
  };
}
