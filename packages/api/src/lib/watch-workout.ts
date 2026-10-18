// JoyoFit cloud workouts (Pro): the document the app uploads for one workout, and what the server derives from it.
//
// One workout is ONE gzip'd JSON document (`WatchWorkoutDoc`), stored in R2 at `watch/<user id>/<start>.json.gz`.
// The document is the whole workout: the local `workouts` row, every `workout_points` row (GPS, heart rate,
// altitude, speed, cadence, stride, power) and the derived `WorkoutAnalysis` the app shows. The D1 row
// (`watch_workout`) is read out of this document, never sent separately, so a list can not disagree with the
// analysis. JoyoFit keeps a copy of the types and of `encodePoints` / `decodePoints` at
// `src/cloud/workoutDoc.ts`; change both together.
//
// Points are stored by column, not by row: a point has up to nine fields, most of them absent for most sources, and
// a column of small deltas gzips to a fraction of the same numbers written per row.

import { z } from "zod";

import type { WorkoutAnalysis } from "./workout-analysis";
import { workoutAnalysisSchema } from "./workout-analysis-schema";

export const WATCH_WORKOUT_DOC_VERSION = 1;

export const WATCH_WORKOUT_LIMITS = {
  /** Largest upload body (the gzip bytes). A two-hour 1 Hz ride is about 150 KB. */
  gzipBytes: 6_000_000,
  /** Largest document after gunzip; a bomb is stopped here, not after it is in memory. */
  jsonBytes: 30_000_000,
  points: 100_000,
  summaryJsonChars: 200_000,
  /** Stored bytes one account may keep; a JoyoRogo Pro year of daily workouts is a few tens of MB. */
  userBytes: 400_000_000,
  /** Rows one `changes` page returns. */
  changesPage: 100,
  listPage: 30,
} as const;

/** A point of the local `workout_points` table. Every source stores only the fields it has. */
export interface WatchPoint {
  /** Unix seconds. */
  ts: number;
  lat: number | null;
  lon: number | null;
  /** Metres. */
  alt: number | null;
  hr: number | null;
  /** Metres per second. */
  speed: number | null;
  /** Steps per minute (revolutions per minute when cycling). */
  cadence: number | null;
  /** Metres per step. */
  stride: number | null;
  /** Watts. */
  power: number | null;
}

/**
 * The points of one workout, by column. Every column has `n` entries (a column with no value at all is `null`):
 * - `dts`: seconds since the previous point, the first is 0; the first point is at `ts0`.
 * - `lat`, `lon`: degrees times 1e7 (1.1 cm), the first present value absolute and each later one the difference
 *   to the previous present value.
 * - `alt`: centimetres, same difference coding.
 * - `hr`, `cadence`, `power`: as they are, whole numbers.
 * - `speed`: millimetres per second, `stride`: millimetres, as they are.
 * A `null` entry means the point had no value; it does not move the difference base.
 */
export interface WatchPointColumns {
  n: number;
  ts0: number;
  dts: number[];
  lat: (number | null)[] | null;
  lon: (number | null)[] | null;
  alt: (number | null)[] | null;
  hr: (number | null)[] | null;
  speed: (number | null)[] | null;
  cadence: (number | null)[] | null;
  stride: (number | null)[] | null;
  power: (number | null)[] | null;
}

/** The `workouts` row, without its local id, `rev` and the points. */
export interface WatchWorkoutRecord {
  workoutNumber: number;
  /** Unix seconds; the key of the workout, locally and in the cloud. */
  start: number;
  end: number;
  sportType: number;
  sportName: string;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  steps: number;
  complete: boolean;
  imported: boolean;
  /** The watch's summary JSON (laps, pace blocks, ...), verbatim. */
  summaryJson: string;
}

export interface WatchWorkoutDoc {
  v: typeof WATCH_WORKOUT_DOC_VERSION;
  /** Revision of the app's analysis engine the `analysis` was computed with (0 without an analysis). */
  engineRev: number;
  workout: WatchWorkoutRecord;
  points: WatchPointColumns | null;
  analysis: WorkoutAnalysis | null;
}

// --- Point columns ----------------------------------------------------------------------------------------

const SCALE = { lat: 1e7, lon: 1e7, alt: 100, speed: 1000, stride: 1000 } as const;

type Column = (number | null)[];

function deltaColumn(values: readonly (number | null)[], scale: number): Column | null {
  const out: Column = [];
  let prev = 0;
  let any = false;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) {
      out.push(null);
      continue;
    }
    const q = Math.round(value * scale);
    out.push(q - prev);
    prev = q;
    any = true;
  }
  return any ? out : null;
}

function plainColumn(values: readonly (number | null)[], scale: number): Column | null {
  let any = false;
  const out = values.map((value) => {
    if (value === null || !Number.isFinite(value)) return null;
    any = true;
    return Math.round(value * scale);
  });
  return any ? out : null;
}

function undoDelta(column: Column | null, n: number, scale: number): (number | null)[] {
  if (!column) return new Array<number | null>(n).fill(null);
  let acc = 0;
  return column.map((d) => {
    if (d === null) return null;
    acc += d;
    return acc / scale;
  });
}

function undoPlain(column: Column | null, n: number, scale: number): (number | null)[] {
  if (!column) return new Array<number | null>(n).fill(null);
  return column.map((v) => (v === null ? null : v / scale));
}

/** Points in time order (as `ORDER BY ts` returns them) to columns. */
export function encodePoints(points: readonly WatchPoint[]): WatchPointColumns | null {
  if (points.length === 0) return null;
  const ts0 = points[0]?.ts ?? 0;
  const dts = points.map((p, i) => (i === 0 ? 0 : p.ts - (points[i - 1]?.ts ?? p.ts)));
  return {
    n: points.length,
    ts0,
    dts,
    lat: deltaColumn(points.map((p) => p.lat), SCALE.lat),
    lon: deltaColumn(points.map((p) => p.lon), SCALE.lon),
    alt: deltaColumn(points.map((p) => p.alt), SCALE.alt),
    hr: plainColumn(points.map((p) => p.hr), 1),
    speed: plainColumn(points.map((p) => p.speed), SCALE.speed),
    cadence: plainColumn(points.map((p) => p.cadence), 1),
    stride: plainColumn(points.map((p) => p.stride), SCALE.stride),
    power: plainColumn(points.map((p) => p.power), 1),
  };
}

export function decodePoints(columns: WatchPointColumns | null): WatchPoint[] {
  if (!columns) return [];
  const { n } = columns;
  const lat = undoDelta(columns.lat, n, SCALE.lat);
  const lon = undoDelta(columns.lon, n, SCALE.lon);
  const alt = undoDelta(columns.alt, n, SCALE.alt);
  const hr = undoPlain(columns.hr, n, 1);
  const speed = undoPlain(columns.speed, n, SCALE.speed);
  const cadence = undoPlain(columns.cadence, n, 1);
  const stride = undoPlain(columns.stride, n, SCALE.stride);
  const power = undoPlain(columns.power, n, 1);
  const out: WatchPoint[] = [];
  let ts = columns.ts0;
  for (let i = 0; i < n; i++) {
    ts += columns.dts[i] ?? 0;
    out.push({
      ts,
      lat: lat[i] ?? null,
      lon: lon[i] ?? null,
      alt: alt[i] ?? null,
      hr: hr[i] ?? null,
      speed: speed[i] ?? null,
      cadence: cadence[i] ?? null,
      stride: stride[i] ?? null,
      power: power[i] ?? null,
    });
  }
  return out;
}

// --- Validation -----------------------------------------------------------------------------------------

const MAX_UNIX_SECONDS = 4_102_444_800;
const unixSeconds = z.number().int().min(0).max(MAX_UNIX_SECONDS);
const counter = z.number().int().min(0).max(2_147_483_647);
const nullableHr = z.number().int().min(0).max(300).nullable();
const column = z.array(z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable()).max(WATCH_WORKOUT_LIMITS.points).nullable();

const pointColumnsSchema = z
  .object({
    n: z.number().int().min(1).max(WATCH_WORKOUT_LIMITS.points),
    ts0: unixSeconds,
    dts: z.array(z.number().int().min(0).max(MAX_UNIX_SECONDS)).max(WATCH_WORKOUT_LIMITS.points),
    lat: column,
    lon: column,
    alt: column,
    hr: column,
    speed: column,
    cadence: column,
    stride: column,
    power: column,
  })
  .superRefine((value, ctx) => {
    if (value.dts.length !== value.n) ctx.addIssue({ code: "custom", path: ["dts"], message: "dts must have n entries" });
    for (const key of ["lat", "lon", "alt", "hr", "speed", "cadence", "stride", "power"] as const) {
      const entries = value[key];
      if (entries && entries.length !== value.n) ctx.addIssue({ code: "custom", path: [key], message: `${key} must have n entries` });
    }
  });

const recordSchema = z.object({
  workoutNumber: counter,
  start: unixSeconds,
  end: unixSeconds,
  sportType: z.number().int().min(0).max(65_535),
  sportName: z.string().min(1).max(64),
  duration: counter,
  distance: counter,
  calories: counter,
  avgHr: nullableHr,
  maxHr: nullableHr,
  steps: counter,
  complete: z.boolean(),
  imported: z.boolean(),
  summaryJson: z.string().max(WATCH_WORKOUT_LIMITS.summaryJsonChars),
});

const docEnvelope = z.object({
  v: z.literal(WATCH_WORKOUT_DOC_VERSION),
  engineRev: z.number().int().min(0).max(10_000),
  workout: recordSchema,
  points: pointColumnsSchema.nullable(),
  // Checked with the strict analysis schema below, so its failure has its own code.
  analysis: z.unknown().nullable(),
});

export type WatchWorkoutErrorCode = "too_large" | "bad_gzip" | "bad_json" | "bad_doc" | "analysis_invalid" | "analysis_mismatch";

export class WatchWorkoutDocError extends Error {
  constructor(
    readonly code: WatchWorkoutErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Gunzips with a ceiling on the output, so a few KB of zeros can not become gigabytes in memory. */
export async function gunzipLimited(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new WatchWorkoutDocError("too_large", `Document is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof WatchWorkoutDocError) throw error;
    throw new WatchWorkoutDocError("bad_gzip", "Body is not gzip data");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Validates a parsed document; the analysis is checked with the same schema JoyoFit posts use. */
export function parseDoc(json: unknown): WatchWorkoutDoc {
  const base = docEnvelope.safeParse(json);
  if (!base.success) {
    const issue = base.error.issues[0];
    throw new WatchWorkoutDocError("bad_doc", `${issue?.path.join(".") || "document"}: ${issue?.message ?? "invalid"}`);
  }
  let analysis: WorkoutAnalysis | null = null;
  if (base.data.analysis !== null) {
    const parsed = workoutAnalysisSchema.safeParse(base.data.analysis);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new WatchWorkoutDocError("analysis_invalid", `analysis.${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
    }
    analysis = parsed.data;
    // An analysis of another workout under this start would put its numbers on this row.
    if (Math.abs(analysis.startedAt - base.data.workout.start * 1000) > 1000) {
      throw new WatchWorkoutDocError("analysis_mismatch", "analysis.startedAt does not match workout.start");
    }
  }
  return { v: WATCH_WORKOUT_DOC_VERSION, engineRev: base.data.engineRev, workout: base.data.workout, points: base.data.points, analysis };
}

/** gzip bytes to a validated document. */
export async function readDoc(bytes: Uint8Array): Promise<WatchWorkoutDoc> {
  const json = await gunzipLimited(bytes, WATCH_WORKOUT_LIMITS.jsonBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new WatchWorkoutDocError("bad_json", "Document is not JSON");
  }
  return parseDoc(parsed);
}

// --- What the D1 row holds ------------------------------------------------------------------------------

/** The numbers of the list row. With an analysis every one comes from it (the app's one set of figures). */
export interface WatchWorkoutSummary {
  start: number;
  workoutNumber: number;
  sportName: string;
  sportKind: WorkoutAnalysis["sport"]["kind"];
  elapsedSec: number;
  movingSec: number;
  distanceM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  calories: number;
  steps: number;
  pointCount: number;
  hasGps: boolean;
  hasAnalysis: boolean;
  imported: boolean;
  complete: boolean;
  engineRev: number;
}

export function summarize(doc: WatchWorkoutDoc): WatchWorkoutSummary {
  const { workout, analysis, points } = doc;
  const hasGps = points ? points.lat !== null && points.lon !== null : false;
  return {
    start: workout.start,
    workoutNumber: workout.workoutNumber,
    sportName: analysis?.sport.name ?? workout.sportName,
    sportKind: analysis?.sport.kind ?? "other",
    elapsedSec: analysis ? analysis.elapsedSec : Math.max(0, workout.end - workout.start),
    movingSec: analysis ? analysis.movingSec : workout.duration,
    distanceM: analysis ? analysis.distanceM : workout.distance > 0 ? workout.distance : null,
    elevGainM: analysis?.elevation?.gainM ?? null,
    elevLossM: analysis?.elevation?.lossM ?? null,
    avgHr: analysis?.stats.avgHr ?? workout.avgHr,
    maxHr: analysis?.stats.maxHr ?? workout.maxHr,
    calories: workout.calories,
    steps: workout.steps,
    pointCount: points?.n ?? 0,
    hasGps,
    hasAnalysis: analysis !== null,
    imported: workout.imported,
    complete: workout.complete,
    engineRev: doc.engineRev,
  };
}

export function watchBlobPrefix(userId: string): string {
  return `watch/${userId}/`;
}

export function watchBlobKey(userId: string, start: number): string {
  return `${watchBlobPrefix(userId)}${start}.json.gz`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
