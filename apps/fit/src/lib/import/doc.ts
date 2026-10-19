// A parsed file becomes the canonical cloud workout document (packages/api/src/lib/watch-workout.ts) the JoyoFit app
// uploads for a watch workout: the workout row, every point by column and the analysis, gzip'd. The server reads the
// list row out of this document, so the web shows the same numbers the analysis does.

import {
  WATCH_WORKOUT_DOC_VERSION,
  WATCH_WORKOUT_LIMITS,
  type WatchWorkoutDoc,
  WatchWorkoutDocError,
  encodePoints,
  parseDoc,
} from "@joyorogo/api/lib/watch-workout";
import { workoutAnalysisSchema } from "@joyorogo/api/lib/workout-analysis-schema";

import { type AnalysisOptions, buildAnalysis } from "./analysis";
import type { ParsedActivity } from "./types";

/** Revision of the analysis engine: 0 means "built by the web importer", so JoyoFit apps with their own engine may recompute. */
export const WEB_ENGINE_REV = 0;

export interface BuiltDoc {
  /** Unix seconds: the key of the workout (`PUT /api/watch-workouts/<start>`). */
  start: number;
  doc: WatchWorkoutDoc;
  gzip: Uint8Array;
  /** False when the file could not carry an analysis (the workout page then shows the numbers only). */
  hasAnalysis: boolean;
  pointCount: number;
  /** Points were thinned to fit the 100 000 point limit. */
  thinned: boolean;
}

export type BuildFailure = "too-large" | "invalid";

/** The same summary keys the app writes for a FIT import (watch-fit importFit.ts), so a phone restoring it reads what it expects. */
function summaryOf(a: ParsedActivity): string {
  const gpsPoints = a.points.filter((p) => p.lat !== null).length;
  return JSON.stringify({
    kind: a.sport.kind,
    gps: gpsPoints > 0 ? "ok" : "none",
    gpsPoints,
    avgSpeed: a.avgSpeed ?? undefined,
    maxSpeed: a.maxSpeed ?? undefined,
    avgPaceSecPerKm: a.sport.foot && a.avgSpeed ? 1000 / a.avgSpeed : undefined,
    minPaceSecPerKm: a.sport.foot && a.maxSpeed ? 1000 / a.maxSpeed : undefined,
    minHr: a.minHr ?? undefined,
    elevationGain: a.ascent ?? undefined,
    elevationLoss: a.descent ?? undefined,
    avgCadence: a.avgCadence ?? undefined,
    maxCadence: a.maxCadence ?? undefined,
    avgPower: a.avgPower ?? undefined,
    maxPower: a.maxPower ?? undefined,
    normalizedPower: a.normalizedPower ?? undefined,
    laps: a.laps.length > 0 ? a.laps : undefined,
    importedFrom: `${a.format.toUpperCase()} file (JoyoFit Web)`,
  });
}

export async function gzipBytes(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function thin<T>(items: readonly T[], max: number): { items: T[]; thinned: boolean } {
  if (items.length <= max) return { items: [...items], thinned: false };
  const stride = Math.ceil(items.length / max);
  return { items: items.filter((_, i) => i % stride === 0), thinned: true };
}

export async function buildDoc(
  a: ParsedActivity,
  options: AnalysisOptions,
): Promise<BuiltDoc | { ok: false; reason: BuildFailure }> {
  const thinned = thin(a.points, WATCH_WORKOUT_LIMITS.points);
  const activity: ParsedActivity = thinned.thinned ? { ...a, points: thinned.items } : a;

  // The analysis is optional: a file the strict schema refuses still imports, without charts of its own.
  const built = buildAnalysis(activity, options);
  const analysis = built && workoutAnalysisSchema.safeParse(built).success ? built : null;

  const make = (withAnalysis: boolean): WatchWorkoutDoc => ({
    v: WATCH_WORKOUT_DOC_VERSION,
    engineRev: withAnalysis ? WEB_ENGINE_REV : 0,
    workout: {
      workoutNumber: 0,
      start: activity.start,
      end: activity.end,
      sportType: activity.sport.type,
      sportName: activity.name.slice(0, 64) || activity.sport.name,
      duration: Math.max(0, Math.round(activity.timerSeconds)),
      distance: Math.max(0, Math.round(activity.distance)),
      calories: Math.max(0, Math.round(activity.calories)),
      avgHr: activity.avgHr,
      maxHr: activity.maxHr,
      steps: activity.steps,
      complete: true,
      imported: true,
      summaryJson: summaryOf(activity),
    },
    points: encodePoints(activity.points),
    analysis: withAnalysis ? analysis : null,
  });

  for (const withAnalysis of analysis ? [true, false] : [false]) {
    const candidate = make(withAnalysis);
    try {
      const doc = parseDoc(candidate);
      const gzip = await gzipBytes(JSON.stringify(doc));
      if (gzip.byteLength > WATCH_WORKOUT_LIMITS.gzipBytes)
        return { ok: false, reason: "too-large" };
      return {
        start: doc.workout.start,
        doc,
        gzip,
        hasAnalysis: doc.analysis !== null,
        pointCount: activity.points.length,
        thinned: thinned.thinned,
      };
    } catch (error) {
      if (!(error instanceof WatchWorkoutDocError)) throw error;
    }
  }
  return { ok: false, reason: "invalid" };
}
