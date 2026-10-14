/**
 * Limits and linked-field math for editing a logged exercise row, shared by
 * the server (exercise.add / exercise.update validation) and both edit sheets
 * so what the sheet previews is exactly what gets stored.
 *
 * Duration and kcal are linked through a burn rate (kcal per minute):
 * changing the duration rescales kcal along that rate; typing kcal re-derives
 * the rate from the typed value.
 */

export const EXERCISE_MAX_KCAL = 10_000;
export const EXERCISE_MIN_DURATION = 1;
export const EXERCISE_MAX_DURATION = 1440;

/** kcal per minute of a logged row; null when it has no usable duration. */
export function burnRate(kcal: number, durationMin: number | null | undefined): number | null {
  if (durationMin == null || !Number.isFinite(durationMin) || durationMin <= 0) return null;
  if (!Number.isFinite(kcal) || kcal < 0) return null;
  return kcal / durationMin;
}

/** kcal for a new duration along a fixed burn rate, whole number within the row limit. */
export function kcalForDuration(rate: number, durationMin: number): number {
  return Math.min(EXERCISE_MAX_KCAL, Math.max(0, Math.round(rate * durationMin)));
}
