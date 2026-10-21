/**
 * Step length ("Panjang langkah") of a foot workout when the source did not store it directly.
 *
 * Ported from the JoyoFit app (watch-fit `src/features/workouts/analysis/stride.ts`, the subset the web uses) so the web
 * reads a step length exactly like the phone does. Step length (metres per step) is speed over steps per second:
 * `speed / (cadence / 60)`. Every figure is a plausibility-checked estimate, never a measurement: a value outside the human
 * range is dropped (null) rather than clamped, so a stray GPS jump or a stopped watch cannot show as a stride.
 */

/** Under this speed (m/s) the person is standing: the same threshold the pace series uses for "moving". */
export const MIN_STRIDE_SPEED_MS = 0.5;
/** Steps per minute: a slow walk is about 60, a sprint about 230; outside 40 to 260 the reading is not a gait. */
export const MIN_SPM = 40;
export const MAX_SPM = 260;
/** Metres per step: a shuffling step is 0.2 m, a sprinter's about 2.5 m. */
export const MIN_STEP_M = 0.2;
export const MAX_STEP_M = 2.5;

const inRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

/** Metres per step from `speedMs` (m/s) and `spm` (steps per minute); null while standing, without a cadence or outside the human range. */
export function stepLengthFromSpeed(speedMs: number | null, spm: number | null): number | null {
  if (speedMs === null || spm === null || speedMs < MIN_STRIDE_SPEED_MS || !inRange(spm, MIN_SPM, MAX_SPM))
    return null;
  const length = speedMs / (spm / 60);
  return inRange(length, MIN_STEP_M, MAX_STEP_M) ? length : null;
}

/** A figure a source gave directly, kept only when it is a possible step length. */
export function plausibleStepLength(metres: number | null | undefined): number | null {
  return typeof metres === "number" && inRange(metres, MIN_STEP_M, MAX_STEP_M) ? metres : null;
}

/** The series a step-length reader needs: `stride` is what the source measured per sample, `pace` seconds per km, `cad` steps per minute. */
export interface StrideSources {
  pace: readonly (number | null)[] | null;
  cad: readonly (number | null)[] | null;
  stride?: readonly (number | null)[] | null;
}

/**
 * Step length per sample: the measured series when the source carries one (its gaps stay gaps), else speed (from the pace)
 * over steps per second (from the cadence). Null when no sample has one.
 */
export function stepLengthSeries(sources: StrideSources, n: number): (number | null)[] | null {
  const out: (number | null)[] = [];
  let any = false;
  for (let i = 0; i < n; i++) {
    let value: number | null;
    if (sources.stride) value = plausibleStepLength(sources.stride[i]);
    else {
      const pace = sources.pace?.[i] ?? null;
      value = stepLengthFromSpeed(pace !== null && pace > 0 ? 1000 / pace : null, sources.cad?.[i] ?? null);
    }
    if (value !== null) any = true;
    out.push(value);
  }
  return any ? out : null;
}
