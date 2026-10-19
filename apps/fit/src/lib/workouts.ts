// The Latihan table: what a row shows, how rows are filtered and sorted. Pure.

import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";

import { type SportKind, sportKindOf } from "./aggregate";

export const SORT_KEYS = [
  "date",
  "distance",
  "duration",
  "speed",
  "hr",
  "elevation",
  "calories",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export function isSortKey(value: unknown): value is SortKey {
  return (SORT_KEYS as readonly unknown[]).includes(value);
}

/** Average speed over the moving time, metres per second; null without distance. */
export function speedMs(w: Pick<FitWebWorkout, "distanceM" | "movingSec">): number | null {
  return w.distanceM && w.distanceM > 0 && w.movingSec > 0 ? w.distanceM / w.movingSec : null;
}

/** Seconds per km over the moving time; null without distance. */
export function paceSecKm(w: Pick<FitWebWorkout, "distanceM" | "movingSec">): number | null {
  const speed = speedMs(w);
  return speed === null ? null : 1000 / speed;
}

/** Runs and walks read as pace per km, everything with a distance as km/h. */
export function readsAsPace(kind: string): boolean {
  const k = sportKindOf(kind);
  return k === "run" || k === "walk";
}

const SORT_VALUE: Record<SortKey, (w: FitWebWorkout) => number | null> = {
  date: (w) => w.start,
  distance: (w) => w.distanceM,
  duration: (w) => w.movingSec,
  speed: speedMs,
  hr: (w) => w.avgHr,
  elevation: (w) => w.elevGainM,
  calories: (w) => (w.calories > 0 ? w.calories : null),
};

/** Sorted copy. A row without the value goes last in both directions, so a gap never leads the table. */
export function sortWorkouts(
  items: readonly FitWebWorkout[],
  key: SortKey,
  dir: SortDir,
): FitWebWorkout[] {
  const value = SORT_VALUE[key];
  const sign = dir === "asc" ? 1 : -1;
  return items.toSorted((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return b.start - a.start;
    if (x === null) return 1;
    if (y === null) return -1;
    return x === y ? b.start - a.start : (x - y) * sign;
  });
}

/** Rows of the chosen sport kinds (none chosen = all) whose name contains `query`. */
export function filterWorkouts(
  items: readonly FitWebWorkout[],
  kinds: readonly SportKind[],
  query: string,
): FitWebWorkout[] {
  const needle = query.trim().toLowerCase();
  return items.filter(
    (w) =>
      (kinds.length === 0 || kinds.includes(sportKindOf(w.sportKind))) &&
      (needle === "" || w.sportName.toLowerCase().includes(needle)),
  );
}

/** How many rows of each kind, for the filter chips. */
export function kindCounts(items: readonly FitWebWorkout[]): Map<SportKind, number> {
  const counts = new Map<SportKind, number>();
  for (const w of items)
    counts.set(sportKindOf(w.sportKind), (counts.get(sportKindOf(w.sportKind)) ?? 0) + 1);
  return counts;
}
