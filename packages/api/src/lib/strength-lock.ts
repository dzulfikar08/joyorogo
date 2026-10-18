/**
 * Strength logging moved to JoyoFit. The legacy write procedures of `workout.*` stay open for a grace period so
 * installed app builds keep working, then reject. Reads and `deleteSession` are never locked.
 *
 * Grace ends 2026-11-01 00:00 WIB (UTC+7). To extend it, move this instant; to drop the lock, remove the
 * `assertStrengthWritable` calls in `routers/workout.ts` and this file.
 */
export const STRENGTH_WRITES_LOCKED_AT = Date.UTC(2026, 9, 31, 17, 0, 0);

/** True from the lock instant on (inclusive). `now` is a parameter so tests can pick the clock. */
export function strengthWritesLocked(now: number = Date.now()): boolean {
  return now >= STRENGTH_WRITES_LOCKED_AT;
}
