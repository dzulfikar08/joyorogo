// Runtime validation of the `WorkoutAnalysis` payload JoyoFit uploads with a watch post. Mirrors the
// contract in `workout-analysis.ts` (types) and enforces its `ANALYSIS_LIMITS` plus value ranges, so
// whatever is stored is safe for every renderer to chart without further checks.

import { z } from "zod";

import { ANALYSIS_LIMITS, WORKOUT_ANALYSIS_VERSION, type WorkoutAnalysis } from "./workout-analysis";

/** Serialized JSON ceiling; a full 720-sample series with track is about 60 KB. */
export const ANALYSIS_MAX_BYTES = 200_000;

const MAX_SEC = 90_000;
const MAX_DIST_M = 1_000_000;

/** Finite number in [min, max]. zod 4 already rejects NaN and Infinity; the bounds make it explicit. */
const num = (min: number, max: number) => z.number().min(min).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const str = (max: number) => z.string().trim().min(1).max(max);

const hr = num(20, 250);
const pace = num(60, 3600);
/**
 * Whole-segment pace (splits, laps, comparison, averages). A split that includes a long stop, a hike up a
 * steep trail or a short trailing split can be slower than an hour per km; that is real data, not a bad doc.
 */
const segmentPace = num(60, MAX_SEC);
const cad = num(0, 400);
const sec = num(0, MAX_SEC);
const distM = num(0, MAX_DIST_M);
const gain = num(0, 100_000);

const series = z
  .strictObject({
    stepSec: int(1, 600),
    n: int(2, ANALYSIS_LIMITS.samples),
    dist: nullable(z.array(distM).max(ANALYSIS_LIMITS.samples)),
    hr: nullable(z.array(nullable(hr)).max(ANALYSIS_LIMITS.samples)),
    pace: nullable(z.array(nullable(pace)).max(ANALYSIS_LIMITS.samples)),
    alt: nullable(z.array(nullable(num(-500, 9000))).max(ANALYSIS_LIMITS.samples)),
    cad: nullable(z.array(nullable(cad)).max(ANALYSIS_LIMITS.samples)),
    stride: nullable(z.array(nullable(num(0, 10))).max(ANALYSIS_LIMITS.samples)).optional(),
    power: nullable(z.array(nullable(num(0, 3000))).max(ANALYSIS_LIMITS.samples)),
    track: nullable(
      z
        .array(nullable(z.tuple([num(-90, 90), num(-180, 180)])))
        .max(ANALYSIS_LIMITS.samples),
    ),
  })
  .superRefine((s, ctx) => {
    for (const key of ["dist", "hr", "pace", "alt", "cad", "stride", "power", "track"] as const) {
      const arr = s[key];
      if (arr && arr.length !== s.n) {
        ctx.addIssue({ code: "custom", path: [key], message: `series.${key} must have exactly n (${s.n}) samples` });
      }
    }
    if (s.dist) {
      for (let i = 1; i < s.dist.length; i++) {
        if (s.dist[i]! < s.dist[i - 1]!) {
          ctx.addIssue({ code: "custom", path: ["dist", i], message: "series.dist must be non-decreasing" });
          break;
        }
      }
    }
  });

const split = z.strictObject({
  n: int(1, ANALYSIS_LIMITS.splits),
  distM,
  sec,
  paceSecKm: nullable(segmentPace),
  hr: nullable(hr),
  gainM: nullable(gain),
  lossM: nullable(gain),
  cad: nullable(cad),
});

const lap = z.strictObject({
  n: int(1, ANALYSIS_LIMITS.laps),
  startSec: sec,
  sec,
  distM: nullable(distM),
  paceSecKm: nullable(segmentPace),
  avgHr: nullable(hr),
  maxHr: nullable(hr),
  avgCad: nullable(cad),
  gainM: nullable(gain),
});

// JoyoFit sends `method` and, for the heart-rate reserve method, six zones (a warm-up zone under Z1). The feed draws five,
// so the warm-up zone folds into the time under Z1 and the stored shape stays the five-zone one every reader expects.
const hrZones = z
  .strictObject({
    method: z.enum(["max", "hrr", "lthr"]).optional(),
    maxHr: num(20, 250),
    source: z.enum(["age", "setting"]),
    bounds: z.array(num(0, 300)).min(6).max(7),
    sec: z.array(sec).min(5).max(6),
    belowSec: sec,
  })
  .refine((zones) => zones.bounds.length === zones.sec.length + 1, { message: "bounds must have one more entry than sec" })
  .transform(({ maxHr, source, bounds, sec: secs, belowSec }) =>
    secs.length === 6
      ? { maxHr, source, bounds: bounds.slice(1), sec: secs.slice(1), belowSec: belowSec + secs[0]! }
      : { maxHr, source, bounds, sec: secs, belowSec },
  );

const paceZones = z.strictObject({
  thresholdSecKm: pace,
  zones: z
    .array(
      z.strictObject({
        key: z.enum(["recovery", "endurance", "tempo", "threshold", "vo2"]),
        fromSecKm: nullable(pace),
        toSecKm: nullable(pace),
        sec,
      }),
    )
    .length(5),
});

const bestEffort = z.strictObject({
  key: z.enum(["400m", "1k", "1mi", "5k", "10k", "half"]),
  sec: num(1, MAX_SEC),
  atM: distM,
  rank: nullable(int(1, 1000)),
});

const effort = z.strictObject({
  strain: num(0, 21),
  trimp: num(0, 10_000),
  band: z.enum(["light", "moderate", "hard", "max"]),
  addedToDay: nullable(num(0, 21)),
});

const load = z.strictObject({
  trimp: num(0, 10_000),
  acute: num(0, 100_000),
  chronicWeekly: num(0, 100_000),
  ratio: nullable(num(0, 100)),
  watchLoad: nullable(num(0, 100_000)),
  aerobicEffect: nullable(num(0, 100)),
  anaerobicEffect: nullable(num(0, 100)),
  recoveryHours: nullable(num(0, 1000)),
});

const comparisonItem = z.strictObject({
  startedAt: z.number().int().positive(),
  distM: nullable(distM),
  sec,
  paceSecKm: nullable(segmentPace),
  avgHr: nullable(hr),
  gainM: nullable(gain),
});

const stats = z.strictObject({
  avgHr: nullable(hr),
  maxHr: nullable(hr),
  minHr: nullable(hr),
  avgPaceSecKm: nullable(segmentPace),
  bestPaceSecKm: nullable(pace),
  avgSpeedMs: nullable(num(0, 100)),
  maxSpeedMs: nullable(num(0, 100)),
  avgCad: nullable(cad),
  maxCad: nullable(cad),
  avgPower: nullable(num(0, 3000)),
  maxPower: nullable(num(0, 3000)),
  normalizedPower: nullable(num(0, 3000)),
  avgStrideM: nullable(num(0, 10)),
});

export const workoutAnalysisSchema = z
  .strictObject({
    v: z.literal(WORKOUT_ANALYSIS_VERSION),
    sport: z.strictObject({
      name: str(60),
      kind: z.enum(["run", "walk", "ride", "swim", "other"]),
    }),
    startedAt: z.number().int().positive(),
    elapsedSec: num(0, MAX_SEC),
    movingSec: num(0, MAX_SEC),
    distanceM: nullable(distM),
    elevation: nullable(
      z.strictObject({
        gainM: gain,
        lossM: gain,
        minM: num(-500, 9000),
        maxM: num(-500, 9000),
      }),
    ),
    series: nullable(series),
    splits: z.array(split).max(ANALYSIS_LIMITS.splits),
    laps: z.array(lap).max(ANALYSIS_LIMITS.laps),
    hrZones: nullable(hrZones),
    paceZones: nullable(paceZones),
    bestEfforts: z.array(bestEffort).max(6),
    effort: nullable(effort),
    load: nullable(load),
    calories: nullable(
      z.strictObject({
        kcal: num(0, 100_000),
        fatG: nullable(num(0, 100_000)),
        carbG: nullable(num(0, 100_000)),
      }),
    ),
    comparison: nullable(
      z.strictObject({
        basis: z.enum(["distance", "duration"]),
        items: z.array(comparisonItem).max(ANALYSIS_LIMITS.comparison),
      }),
    ),
    stats,
  })
  .refine((a) => JSON.stringify(a).length <= ANALYSIS_MAX_BYTES, {
    message: `Workout analysis is larger than ${ANALYSIS_MAX_BYTES} bytes`,
  });

export type WorkoutAnalysisInput = z.infer<typeof workoutAnalysisSchema>;

// Compile-time drift guard: the schema output and the contract type must be mutually assignable.
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaMatchesContract: Mutual<WorkoutAnalysisInput, WorkoutAnalysis> = true;
void _schemaMatchesContract;

/** Parses a stored `analysis_json`; null for anything that is not a valid analysis (never throws). */
export function parseStoredAnalysis(json: string | null | undefined): WorkoutAnalysis | null {
  if (!json) return null;
  try {
    const parsed = workoutAnalysisSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
