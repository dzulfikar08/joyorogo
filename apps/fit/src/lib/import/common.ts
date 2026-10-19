// Shared by the three readers: geometry and the totals a GPX or TCX file does not state itself.

import type { WatchPoint } from "@joyorogo/api/lib/watch-workout";

export const EARTH_RADIUS_M = 6_371_000;

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A gap longer than this in a track is a pause: it counts for no moving time and no distance (as JoyoFit's own `MAX_WORKOUT_GAP_SEC`). */
export const PAUSE_GAP_SEC = 120;

/** A speed no body or bike reaches on its own (m/s): a GPS jump, not movement. */
const MAX_PLAUSIBLE_SPEED = 45;

/**
 * Cumulative distance in metres at every point: along the GPS fixes when there are any (jumps and pauses skipped),
 * else the integral of the speed. Null when the points have neither.
 */
export function cumulativeDistance(points: readonly WatchPoint[]): number[] | null {
  const gps = points.some((p) => p.lat !== null && p.lon !== null);
  const speeds = points.some((p) => p.speed !== null);
  if (!gps && !speeds) return null;
  const out: number[] = [];
  let total = 0;
  let prev: WatchPoint | null = null;
  let prevFix: WatchPoint | null = null;
  for (const point of points) {
    if (prev) {
      const dt = point.ts - prev.ts;
      if (dt > 0 && dt <= PAUSE_GAP_SEC) {
        if (gps) {
          if (point.lat !== null && point.lon !== null && prevFix) {
            const d = haversineM(
              prevFix.lat as number,
              prevFix.lon as number,
              point.lat,
              point.lon,
            );
            const fixDt = point.ts - prevFix.ts;
            if (fixDt > 0 && fixDt <= PAUSE_GAP_SEC && d / fixDt <= MAX_PLAUSIBLE_SPEED) total += d;
          }
        } else if (prev.speed !== null) {
          total += prev.speed * dt;
        }
      }
    }
    if (point.lat !== null && point.lon !== null) prevFix = point;
    out.push(total);
    prev = point;
  }
  return out;
}

/** Seconds of movement: the time between consecutive points, pauses (long gaps) left out. */
export function activeSeconds(points: readonly WatchPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i] as WatchPoint).ts - (points[i - 1] as WatchPoint).ts;
    if (dt > 0 && dt <= PAUSE_GAP_SEC) total += dt;
  }
  return total;
}

const present = (values: readonly (number | null)[]): number[] =>
  values.filter((v): v is number => v !== null && Number.isFinite(v));

export function meanOf(values: readonly (number | null)[]): number | null {
  const xs = present(values);
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function maxOf(values: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const v of values) if (v !== null && (best === null || v > best)) best = v;
  return best;
}

export function minOf(values: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const v of values) if (v !== null && (best === null || v < best)) best = v;
  return best;
}

/**
 * Climb and descent in metres over an altitude track. Small wobbles do not count: a change is only booked once the
 * altitude has moved `threshold` metres from the last booked level (GPS altitude noise is a few metres).
 */
export function climb(
  altitudes: readonly (number | null)[],
  threshold = 3,
): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let level: number | null = null;
  for (const alt of altitudes) {
    if (alt === null) continue;
    if (level === null) {
      level = alt;
      continue;
    }
    const diff = alt - level;
    if (diff >= threshold) {
      ascent += diff;
      level = alt;
    } else if (diff <= -threshold) {
      descent -= diff;
      level = alt;
    }
  }
  return { ascent, descent };
}

/** Normalized power: the 30 s rolling mean to the fourth power, averaged, fourth root (Coggan). Null under 30 s of power. */
export function normalizedPower(points: readonly WatchPoint[]): number | null {
  const withPower = points.filter((p) => p.power !== null);
  if (withPower.length < 30) return null;
  const powers = withPower.map((p) => p.power as number);
  const window = 30;
  let sum = 0;
  let count = 0;
  let rolling = powers.slice(0, window).reduce((a, b) => a + b, 0);
  for (let i = window - 1; i < powers.length; i++) {
    if (i >= window) rolling += (powers[i] as number) - (powers[i - window] as number);
    sum += (rolling / window) ** 4;
    count += 1;
  }
  return Math.round((sum / count) ** 0.25);
}
