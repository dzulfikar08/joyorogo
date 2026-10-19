// The WorkoutAnalysis of an imported file: the same payload shape the JoyoFit app builds for a watch workout
// (packages/api/src/lib/workout-analysis.ts, validated by workout-analysis-schema.ts), computed here from the file's own
// samples. What it does not have is history: no comparison with earlier workouts, no best-effort ranks, no training load,
// no pace zones (they need the person's other workouts). Everything else the workout page draws is filled.
//
// Pure functions: no DOM, no React.

import type { WatchPoint } from "@joyorogo/api/lib/watch-workout";
import {
  ANALYSIS_LIMITS,
  type AnalysisBestEffort,
  type AnalysisLap,
  type AnalysisSeries,
  type AnalysisSplit,
  BEST_EFFORT_DISTANCES,
  type BestEffortKey,
  type LatLon,
  type SportKind,
  WORKOUT_ANALYSIS_VERSION,
  type WorkoutAnalysis,
  effortBand,
} from "@joyorogo/api/lib/workout-analysis";

import { climb, cumulativeDistance, maxOf, meanOf, minOf } from "./common";
import type { ParsedActivity } from "./types";

const MAX_SEC = 90_000;
/** The phone's fallback maximum heart rate source: 220 - age, clamped (watch-fit src/features/workouts/substrate.ts). */
export const DEFAULT_AGE = 35;
const HR_GAP_SEC = 120;

export function maxHrFromAge(age: number | null): number {
  return Math.min(220, Math.max(120, 220 - (age ?? DEFAULT_AGE)));
}

const round = (v: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const orNull = (v: number | null, digits = 0): number | null =>
  v === null ? null : round(v, digits);

export function kindOf(sportKind: ParsedActivity["sport"]["kind"]): SportKind {
  switch (sportKind) {
    case "RUNNING":
    case "TRAIL_RUN":
    case "INDOOR_RUNNING":
      return "run";
    case "WALKING":
    case "INDOOR_WALKING":
    case "HIKING":
      return "walk";
    case "CYCLING":
    case "INDOOR_CYCLING":
      return "ride";
    default:
      return "other";
  }
}

// --- Resampling onto the shared grid ----------------------------------------------------------------------------

/** A value over time, for interpolating onto grid times without scanning the track again for every sample. */
class Channel {
  private readonly ts: number[] = [];
  private readonly v: number[] = [];
  private cursor = 0;

  constructor(
    points: readonly WatchPoint[],
    pick: (p: WatchPoint, i: number) => number | null,
    private readonly maxGap: number,
  ) {
    points.forEach((p, i) => {
      const value = pick(p, i);
      if (value !== null && Number.isFinite(value)) {
        this.ts.push(p.ts);
        this.v.push(value);
      }
    });
  }

  get empty(): boolean {
    return this.ts.length === 0;
  }

  /** Linear interpolation at `t` (called with rising `t`); null across a gap longer than `maxGap` or outside the track. */
  at(t: number): number | null {
    const n = this.ts.length;
    if (n === 0) return null;
    while (this.cursor + 1 < n && (this.ts[this.cursor + 1] as number) <= t) this.cursor++;
    const i = this.cursor;
    const t0 = this.ts[i] as number;
    const v0 = this.v[i] as number;
    if (t < t0 - 0.5) return null;
    if (t - t0 < 0.5 || i + 1 >= n) return t - t0 <= this.maxGap ? v0 : null;
    const t1 = this.ts[i + 1] as number;
    if (t1 - t0 > this.maxGap) return t - t0 <= this.maxGap / 4 ? v0 : null;
    return v0 + ((this.v[i + 1] as number) - v0) * ((t - t0) / (t1 - t0));
  }
}

function movingAverage(values: readonly (number | null)[], radius: number): (number | null)[] {
  return values.map((v, i) => {
    if (v === null) return null;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      const w = values[j];
      if (w !== null && w !== undefined) {
        sum += w;
        count += 1;
      }
    }
    return sum / count;
  });
}

interface Grid {
  step: number;
  n: number;
  dist: number[] | null;
  hr: (number | null)[];
  alt: (number | null)[];
  cad: (number | null)[];
  power: (number | null)[];
  track: (LatLon | null)[];
  pace: (number | null)[];
}

function gridOf(a: ParsedActivity, perPointDist: number[] | null, elapsed: number): Grid {
  const step = Math.max(1, Math.ceil(elapsed / (ANALYSIS_LIMITS.samples - 1)));
  const n = Math.min(ANALYSIS_LIMITS.samples, Math.floor(elapsed / step) + 1);
  const gap = Math.max(30, step * 3);
  const pts = a.points;
  const dist = perPointDist
    ? new Channel(pts, (_, i) => perPointDist[i] ?? null, HR_GAP_SEC)
    : null;
  const hr = new Channel(pts, (p) => p.hr, gap);
  const alt = new Channel(pts, (p) => p.alt, gap);
  const cad = new Channel(pts, (p) => p.cadence, gap);
  const power = new Channel(pts, (p) => p.power, gap);
  const lat = new Channel(pts, (p) => p.lat, gap);
  const lon = new Channel(pts, (p) => p.lon, gap);

  const out: Grid = {
    step,
    n,
    dist: dist ? [] : null,
    hr: [],
    alt: [],
    cad: [],
    power: [],
    track: [],
    pace: [],
  };
  let lastDist = 0;
  for (let i = 0; i < n; i++) {
    const t = a.start + i * step;
    if (out.dist && dist) {
      const d = dist.at(t);
      lastDist = d === null ? lastDist : Math.max(lastDist, d);
      out.dist.push(lastDist);
    }
    out.hr.push(hr.at(t));
    out.alt.push(alt.at(t));
    out.cad.push(cad.at(t));
    out.power.push(power.at(t));
    const la = lat.at(t);
    const lo = lon.at(t);
    out.track.push(la !== null && lo !== null ? [round(la, 5), round(lo, 5)] : null);
  }
  out.alt = movingAverage(out.alt, 2);

  // Pace from the distance covered over a window centred on the sample, so one noisy fix does not spike it.
  const radius = Math.max(1, Math.round(15 / step));
  for (let i = 0; i < n; i++) {
    if (!out.dist) {
      out.pace.push(null);
      continue;
    }
    const a0 = Math.max(0, i - radius);
    const b0 = Math.min(n - 1, i + radius);
    const dt = (b0 - a0) * step;
    const dd = (out.dist[b0] as number) - (out.dist[a0] as number);
    const speed = dt > 0 ? dd / dt : 0;
    out.pace.push(speed >= 0.5 ? Math.min(3600, Math.max(60, round(1000 / speed, 1))) : null);
  }
  return out;
}

const hasAny = (values: readonly (number | null)[]): boolean => values.some((v) => v !== null);

// --- Splits, laps, zones, efforts -----------------------------------------------------------------------------

/** Elapsed seconds on the grid at which the cumulative distance reaches `d` (linear between samples). */
function timeAtDistance(dist: readonly number[], step: number, d: number): number {
  for (let i = 1; i < dist.length; i++) {
    const d1 = dist[i] as number;
    if (d1 >= d) {
      const d0 = dist[i - 1] as number;
      const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      return (i - 1 + f) * step;
    }
  }
  return (dist.length - 1) * step;
}

function sliceStats(
  grid: Grid,
  t0: number,
  t1: number,
): { hr: number | null; gain: number | null; loss: number | null; cad: number | null } {
  const i0 = Math.max(0, Math.floor(t0 / grid.step));
  const i1 = Math.min(grid.n - 1, Math.max(i0 + 1, Math.ceil(t1 / grid.step)));
  const hrs = grid.hr.slice(i0, i1 + 1);
  const cads = grid.cad.slice(i0, i1 + 1);
  const alts = grid.alt.slice(i0, i1 + 1);
  const { ascent, descent } = climb(alts, 1);
  const hr = meanOf(hrs);
  const cad = meanOf(cads);
  return {
    hr: hr === null ? null : Math.round(hr),
    gain: hasAny(alts) ? round(ascent, 1) : null,
    loss: hasAny(alts) ? round(descent, 1) : null,
    cad: cad === null ? null : Math.round(cad),
  };
}

function splitsOf(grid: Grid, total: number, hasPace: boolean): AnalysisSplit[] {
  if (!grid.dist || total < 200) return [];
  const out: AnalysisSplit[] = [];
  for (let k = 0; k * 1000 < total && out.length < ANALYSIS_LIMITS.splits; k++) {
    const d0 = k * 1000;
    const d1 = Math.min((k + 1) * 1000, total);
    // A trailing sliver under 100 m says nothing; fold it away rather than show a pace of a few steps.
    if (d1 - d0 < 100 && k > 0) break;
    const t0 = timeAtDistance(grid.dist, grid.step, d0);
    const t1 = timeAtDistance(grid.dist, grid.step, d1);
    const sec = Math.max(0, t1 - t0);
    const stats = sliceStats(grid, t0, t1);
    out.push({
      n: k + 1,
      distM: Math.round(d1 - d0),
      sec: round(sec, 1),
      paceSecKm:
        hasPace && sec > 0
          ? Math.min(MAX_SEC, Math.max(60, round((sec / (d1 - d0)) * 1000, 1)))
          : null,
      hr: stats.hr,
      gainM: stats.gain,
      lossM: stats.loss,
      cad: stats.cad,
    });
  }
  return out;
}

function lapsOf(a: ParsedActivity, grid: Grid, hasPace: boolean): AnalysisLap[] {
  return a.laps.slice(0, ANALYSIS_LIMITS.laps).map((lap, i) => {
    const sec = Math.max(0, lap.endTs - lap.startTs);
    const t0 = lap.startTs - a.start;
    const stats = sliceStats(grid, t0, t0 + sec);
    return {
      n: i + 1,
      startSec: Math.max(0, Math.min(MAX_SEC, t0)),
      sec: Math.min(MAX_SEC, sec),
      distM: lap.distanceM === null ? null : Math.round(lap.distanceM),
      paceSecKm:
        hasPace && lap.distanceM && sec > 0
          ? Math.min(MAX_SEC, Math.max(60, round((sec / lap.distanceM) * 1000, 1)))
          : null,
      avgHr: lap.avgHr ?? stats.hr,
      maxHr: lap.maxHr,
      avgCad: lap.avgCadence === null ? stats.cad : Math.round(lap.avgCadence),
      gainM: stats.gain,
    };
  });
}

/** Edwards zone 0..5 at `hr`: 0 below 50 % of the maximum, then one per 10 %. */
function edwardsZone(hr: number, maxHr: number): number {
  const pct = (100 * hr) / maxHr;
  return pct < 50 ? 0 : Math.min(5, Math.floor((pct - 50) / 10) + 1);
}

/** Each heart-rate point counts until the next one; a gap over two minutes is a pause and counts for nothing (as `workoutStrain`). */
function heartLoad(points: readonly WatchPoint[], maxHr: number) {
  const samples = points.filter((p) => p.hr !== null && p.hr > 0);
  const sec = [0, 0, 0, 0, 0];
  let below = 0;
  let covered = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const dt = (samples[i + 1] as WatchPoint).ts - (samples[i] as WatchPoint).ts;
    if (dt <= 0 || dt > HR_GAP_SEC) continue;
    covered += dt;
    const zone = edwardsZone((samples[i] as WatchPoint).hr as number, maxHr);
    if (zone === 0) below += dt;
    else sec[zone - 1] = (sec[zone - 1] as number) + dt;
  }
  const trimp = sec.reduce((sum, s, i) => sum + ((i + 1) * s) / 60, 0);
  return { sec, below, covered, trimp };
}

/** Strain 0..21 from TRIMP: `21 * (1 - e^(-TRIMP / 250))` (watch-fit src/features/today/strain.ts). */
const strainFromTrimp = (trimp: number): number => 21 * (1 - Math.exp(-trimp / 250));

function bestEffortsOf(
  points: readonly WatchPoint[],
  dist: readonly number[] | null,
  total: number,
): AnalysisBestEffort[] {
  if (!dist) return [];
  const out: AnalysisBestEffort[] = [];
  for (const key of Object.keys(BEST_EFFORT_DISTANCES) as BestEffortKey[]) {
    const target = BEST_EFFORT_DISTANCES[key];
    if (total < target * 1.02) continue;
    let best = Infinity;
    let at = 0;
    let i = 0;
    for (let j = 0; j < points.length; j++) {
      const need = (dist[j] as number) - target;
      if (need < 0) continue;
      while (i + 1 < j && (dist[i + 1] as number) <= need) i++;
      const d0 = dist[i] as number;
      const d1 = dist[i + 1] as number;
      const t0 = (points[i] as WatchPoint).ts;
      const t1 = (points[i + 1] as WatchPoint).ts;
      const startT = d1 > d0 ? t0 + ((need - d0) / (d1 - d0)) * (t1 - t0) : t0;
      const sec = (points[j] as WatchPoint).ts - startT;
      if (sec > 0 && sec < best) {
        best = sec;
        at = need;
      }
    }
    if (Number.isFinite(best))
      out.push({
        key,
        sec: Math.max(1, round(best, 1)),
        atM: Math.max(0, Math.round(at)),
        rank: null,
      });
  }
  return out;
}

// --- The analysis -------------------------------------------------------------------------------------------------

export interface AnalysisOptions {
  /** Maximum heart rate for the zones and strain, bpm. */
  maxHr: number;
  /** Where it comes from: the age formula, or something the person set. */
  maxHrSource: "age" | "setting";
}

/**
 * Builds the analysis, or null when the file cannot carry one (under two samples, or longer than the 25 hours the
 * format allows). The caller validates it against the strict schema before uploading.
 */
export function buildAnalysis(a: ParsedActivity, options: AnalysisOptions): WorkoutAnalysis | null {
  const elapsed = Math.max(a.end - a.start, a.timerSeconds);
  if (a.points.length < 2 || elapsed < 2 || elapsed > MAX_SEC) return null;

  const kind = kindOf(a.sport.kind);
  const perPoint = cumulativeDistance(a.points);
  // The file's own total is the truth; the track's length is scaled to it when they disagree by a plausible factor.
  const trackTotal = perPoint ? (perPoint[perPoint.length - 1] as number) : 0;
  const total = a.distance > 0 ? a.distance : trackTotal;
  const scale =
    perPoint &&
    trackTotal > 0 &&
    a.distance > 0 &&
    a.distance / trackTotal > 0.5 &&
    a.distance / trackTotal < 2
      ? a.distance / trackTotal
      : 1;
  const dist = perPoint && total > 0 ? perPoint.map((d) => d * scale) : null;

  const hasPace = kind === "run" || kind === "walk" || kind === "ride";
  const grid = gridOf(a, dist, elapsed);
  const gps = grid.track.some((p) => p !== null);

  const series: AnalysisSeries = {
    stepSec: grid.step,
    n: grid.n,
    dist: grid.dist ? grid.dist.map((d) => round(d, 1)) : null,
    hr: hasAny(grid.hr) ? grid.hr.map((v) => (v === null ? null : Math.round(v))) : null,
    pace: hasPace && grid.dist && hasAny(grid.pace) ? grid.pace : null,
    alt: hasAny(grid.alt) ? grid.alt.map((v) => orNull(v, 1)) : null,
    cad: hasAny(grid.cad) ? grid.cad.map((v) => (v === null ? null : Math.round(v))) : null,
    power: hasAny(grid.power) ? grid.power.map((v) => (v === null ? null : Math.round(v))) : null,
    track: gps ? grid.track : null,
  };

  const altitudes = a.points.map((p) => p.alt);
  const alts = altitudes.filter((v): v is number => v !== null);
  const own = climb(altitudes, 3);
  const elevation = alts.length
    ? {
        gainM: round(a.ascent ?? own.ascent, 1),
        lossM: round(a.descent ?? own.descent, 1),
        minM: round(Math.min(...alts), 1),
        maxM: round(Math.max(...alts), 1),
      }
    : null;

  const hrAny = a.points.some((p) => p.hr !== null);
  const load = hrAny ? heartLoad(a.points, options.maxHr) : null;
  const bounds = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((f) => Math.round(f * options.maxHr));
  const hrZones =
    load && load.covered > 0
      ? {
          maxHr: options.maxHr,
          source: options.maxHrSource,
          bounds,
          sec: load.sec.map((s) => round(s)),
          belowSec: round(load.below),
        }
      : null;
  const effort =
    load && load.covered > 0
      ? (() => {
          const strain = round(Math.min(21, strainFromTrimp(load.trimp)), 1);
          return {
            strain,
            trimp: round(load.trimp, 1),
            band: effortBand(strain),
            addedToDay: null,
          };
        })()
      : null;

  const speeds = a.points.map((p) => p.speed).filter((v): v is number => v !== null);
  const paces = grid.pace.filter((v): v is number => v !== null);
  const avgSpeed = a.avgSpeed ?? (total > 0 && a.timerSeconds > 0 ? total / a.timerSeconds : null);
  const foot = kind === "run" || kind === "walk";
  const strideValues = a.points.map((p) => p.stride);

  return {
    v: WORKOUT_ANALYSIS_VERSION,
    sport: { name: a.name.slice(0, 60), kind },
    startedAt: a.start * 1000,
    elapsedSec: elapsed,
    movingSec: Math.min(elapsed, a.timerSeconds),
    distanceM: total > 0 ? Math.round(total) : null,
    elevation,
    series,
    splits: splitsOf(grid, total, hasPace),
    laps: lapsOf(a, grid, hasPace),
    hrZones,
    paceZones: null,
    bestEfforts: foot ? bestEffortsOf(a.points, dist, total) : [],
    effort,
    load: null,
    calories: a.calories > 0 ? { kcal: a.calories, fatG: null, carbG: null } : null,
    comparison: null,
    stats: {
      avgHr: a.avgHr,
      maxHr: a.maxHr,
      minHr: a.minHr,
      avgPaceSecKm:
        hasPace && avgSpeed && avgSpeed > 0
          ? Math.min(MAX_SEC, Math.max(60, round(1000 / avgSpeed, 1)))
          : null,
      bestPaceSecKm: hasPace && paces.length ? Math.max(60, minOf(paces) as number) : null,
      avgSpeedMs: avgSpeed === null ? null : round(Math.min(100, avgSpeed), 2),
      maxSpeedMs: speeds.length ? round(Math.min(100, maxOf(speeds) as number), 2) : null,
      avgCad: orNull(a.avgCadence),
      maxCad: orNull(a.maxCadence),
      avgPower: orNull(a.avgPower),
      maxPower: orNull(a.maxPower),
      normalizedPower: orNull(a.normalizedPower),
      avgStrideM:
        foot && strideValues.some((v) => v !== null)
          ? round(meanOf(strideValues) as number, 2)
          : null,
    },
  };
}
