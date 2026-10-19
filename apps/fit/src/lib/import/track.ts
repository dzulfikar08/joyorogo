// A GPX or TCX file is a list of track points; this turns one into the same ParsedActivity a FIT file gives.

import type { WatchPoint } from "@joyorogo/api/lib/watch-workout";

import {
  activeSeconds,
  climb,
  cumulativeDistance,
  maxOf,
  meanOf,
  minOf,
  normalizedPower,
} from "./common";
import {
  type ImportError,
  type ImportFormat,
  type ImportLap,
  type ParsedActivity,
  SPORT_TYPE,
  type SportInfo,
  sportOf,
} from "./types";

/** The sport a GPX `<type>` or a TCX `Sport` attribute names (free text in the wild: "Running", "road_biking", "Trail Run"). */
export function sportFromName(raw: string | null): SportInfo {
  const name = (raw ?? "").toLowerCase().replace(/[_-]+/g, " ");
  let type: number = SPORT_TYPE.other;
  if (/trail/.test(name)) type = SPORT_TYPE.trailRun;
  else if (/treadmill|indoor run/.test(name)) type = SPORT_TYPE.indoorRunning;
  else if (/indoor (cycl|bik|ride)|spin|virtual/.test(name)) type = SPORT_TYPE.indoorCycling;
  else if (/run|jog/.test(name)) type = SPORT_TYPE.running;
  else if (/hik|trek/.test(name)) type = SPORT_TYPE.hiking;
  else if (/indoor walk/.test(name)) type = SPORT_TYPE.indoorWalking;
  else if (/walk/.test(name)) type = SPORT_TYPE.walking;
  else if (/bik|cycl|ride/.test(name)) type = SPORT_TYPE.cycling;
  return sportOf(type);
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[sorted.length >> 1] as number;
};

/**
 * Running cadence is stored per leg (strides per minute) by some tools, as steps per minute by others. A run that never
 * goes above 120 is per leg: nobody runs at 110 steps a minute, so it is doubled to steps like JoyoFit counts them.
 */
function stepCadence(points: WatchPoint[], sport: SportInfo): void {
  if (
    !sport.foot ||
    sport.type === SPORT_TYPE.walking ||
    sport.type === SPORT_TYPE.indoorWalking ||
    sport.type === SPORT_TYPE.hiking
  )
    return;
  const values = points.flatMap((p) => (p.cadence !== null && p.cadence > 0 ? [p.cadence] : []));
  const top = values.length ? Math.max(...values) : 0;
  if (values.length > 0 && top <= 120 && (median(values) ?? 0) <= 100) {
    for (const p of points) if (p.cadence !== null) p.cadence = p.cadence * 2;
  }
}

/** Fills the speed a file does not state from the distance between points, over a short window so GPS noise averages out. */
function deriveSpeed(points: WatchPoint[], dist: number[] | null): void {
  if (!dist) return;
  const WINDOW = 3;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as WatchPoint;
    if (p.speed !== null) continue;
    const a = Math.max(0, i - WINDOW);
    const b = Math.min(points.length - 1, i + WINDOW);
    const dt = (points[b] as WatchPoint).ts - (points[a] as WatchPoint).ts;
    p.speed = dt > 0 ? Math.max(0, ((dist[b] as number) - (dist[a] as number)) / dt) : null;
  }
}

export interface TrackInput {
  format: ImportFormat;
  sport: SportInfo;
  name: string | null;
  points: WatchPoint[];
  laps?: ImportLap[];
  /** Totals the file states itself (TCX laps); anything missing is worked out from the points. */
  calories?: number;
  timerSeconds?: number | null;
  distance?: number | null;
  startTs?: number | null;
}

export function finalizeTrack(input: TrackInput): ParsedActivity | ImportError {
  // Same second twice (two segments touching): the later point wins. Time order is the file's, made certain here.
  const byTime = new Map<number, WatchPoint>();
  for (const p of input.points) byTime.set(p.ts, p);
  const points = [...byTime.values()].sort((a, b) => a.ts - b.ts);
  if (points.length < 2) return { ok: false, reason: "no-points" };

  stepCadence(points, input.sport);
  const dist = cumulativeDistance(points);
  deriveSpeed(points, dist);

  const start = Math.min(input.startTs ?? Infinity, (points[0] as WatchPoint).ts);
  const end = (points[points.length - 1] as WatchPoint).ts;
  if (end <= start) return { ok: false, reason: "no-points" };

  const stated = input.distance && input.distance > 0 ? input.distance : null;
  const distance = stated ?? (dist ? (dist[dist.length - 1] as number) : 0);
  const timer = Math.round(
    input.timerSeconds && input.timerSeconds > 0
      ? input.timerSeconds
      : activeSeconds(points) || end - start,
  );
  const hrs = points.map((p) => p.hr);
  const cads = points.map((p) => p.cadence);
  const powers = points.map((p) => p.power);
  const { ascent, descent } = climb(points.map((p) => p.alt));
  const hasAlt = points.some((p) => p.alt !== null);

  return {
    format: input.format,
    start,
    end,
    sport: input.sport,
    name: input.name?.trim() ? input.name.trim().slice(0, 64) : input.sport.name,
    timerSeconds: timer,
    distance,
    calories: Math.round(input.calories ?? 0),
    avgHr: meanOf(hrs) === null ? null : Math.round(meanOf(hrs) as number),
    maxHr: maxOf(hrs),
    minHr: minOf(hrs),
    avgSpeed: distance > 0 && timer > 0 ? distance / timer : null,
    maxSpeed: maxOf(points.map((p) => p.speed)),
    ascent: hasAlt ? Math.round(ascent) : null,
    descent: hasAlt ? Math.round(descent) : null,
    steps: 0,
    avgCadence:
      meanOf(cads.filter((c) => c !== null && c > 0)) === null
        ? null
        : Math.round(meanOf(cads.filter((c) => c !== null && c > 0)) as number),
    maxCadence: maxOf(cads),
    avgPower:
      meanOf(powers.filter((v) => v !== null && v > 0)) === null
        ? null
        : Math.round(meanOf(powers.filter((v) => v !== null && v > 0)) as number),
    maxPower: maxOf(powers),
    normalizedPower: normalizedPower(points),
    laps: (input.laps?.length ?? 0) >= 2 ? (input.laps as ImportLap[]) : [],
    points,
  };
}
