// Workout documents for the export tests: a run with GPS, heart rate, cadence and laps; a ride with power; an indoor
// treadmill run without GPS. Built with the same `encodePoints` the app uses, so the documents are what the cloud holds.

import { WATCH_WORKOUT_DOC_VERSION, encodePoints } from "@joyorogo/api/lib/watch-workout";
import type { WatchPoint, WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";
import { WORKOUT_ANALYSIS_VERSION } from "@joyorogo/api/lib/workout-analysis";
import type { AnalysisLap, SportKind, WorkoutAnalysis } from "@joyorogo/api/lib/workout-analysis";

/** 2026-09-14 06:12:03 WIB. */
export const START = 1_789_341_123;

const record = (
  start: number,
  over: Partial<WatchWorkoutDoc["workout"]>,
): WatchWorkoutDoc["workout"] => ({
  workoutNumber: 7,
  start,
  end: start + 599,
  sportType: 1,
  sportName: "Run",
  duration: 599,
  distance: 1800,
  calories: 112,
  avgHr: 150,
  maxHr: 171,
  steps: 1700,
  complete: true,
  imported: false,
  summaryJson: "{}",
  ...over,
});

function analysis(start: number, kind: SportKind, over: Partial<WorkoutAnalysis>): WorkoutAnalysis {
  return {
    v: WORKOUT_ANALYSIS_VERSION,
    sport: { name: kind === "ride" ? "Ride" : "Run", kind },
    startedAt: start * 1000,
    elapsedSec: 599,
    movingSec: 590,
    distanceM: 1800,
    elevation: { gainM: 14, lossM: 9, minM: 20, maxM: 33 },
    series: null,
    splits: [],
    laps: [],
    hrZones: null,
    paceZones: null,
    bestEfforts: [],
    effort: null,
    load: null,
    calories: null,
    comparison: null,
    stats: {
      avgHr: 150,
      maxHr: 171,
      minHr: 98,
      avgPaceSecKm: null,
      bestPaceSecKm: null,
      avgSpeedMs: 3,
      maxSpeedMs: 4.2,
      avgCad: 170,
      maxCad: 182,
      avgPower: null,
      maxPower: null,
      normalizedPower: null,
      avgStrideM: null,
    },
    ...over,
  };
}

/** One lap per 200 s. */
const LAPS: AnalysisLap[] = [0, 1, 2].map((i) => ({
  n: i + 1,
  startSec: i * 200,
  sec: i === 2 ? 199 : 200,
  distM: 600,
  paceSecKm: 333,
  avgHr: 140 + i * 10,
  maxHr: 150 + i * 10,
  avgCad: 170,
  gainM: 5,
}));

/** A 600-sample run: 8 heart-rate-only samples before the first GPS fix, then a track north-east at 3 m/s. */
export function runDoc(): WatchWorkoutDoc {
  const points: WatchPoint[] = Array.from({ length: 600 }, (_, i) => {
    const fix = i >= 8;
    return {
      ts: START + i,
      lat: fix ? -6.2 + (i - 8) * 0.00002 : null,
      lon: fix ? 106.8 + (i - 8) * 0.00002 : null,
      alt: fix ? 25 + Math.sin(i / 40) * 6 : null,
      hr: 100 + Math.floor(i / 10),
      speed: fix ? 3 : null,
      cadence: 160 + (i % 23),
      stride: null,
      power: null,
    };
  });
  return {
    v: WATCH_WORKOUT_DOC_VERSION,
    engineRev: 3,
    workout: record(START, {}),
    points: encodePoints(points),
    analysis: analysis(START, "run", { laps: LAPS }),
  };
}

/** A ride with power and a 85 rpm cadence, one lap (the watch kept none). */
export function rideDoc(): WatchWorkoutDoc {
  const start = START + 86_400;
  const points: WatchPoint[] = Array.from({ length: 300 }, (_, i) => ({
    ts: start + i,
    lat: -6.3 + i * 0.00005,
    lon: 106.9 + i * 0.00004,
    alt: 40 + i * 0.05,
    hr: 120 + (i % 30),
    speed: 7.5,
    cadence: 85,
    stride: null,
    power: 150 + (i % 100),
  }));
  return {
    v: WATCH_WORKOUT_DOC_VERSION,
    engineRev: 3,
    workout: record(start, {
      end: start + 299,
      sportType: 3,
      sportName: "Ride",
      duration: 299,
      distance: 2250,
      steps: 0,
      calories: 70,
    }),
    points: encodePoints(points),
    analysis: analysis(start, "ride", {
      elapsedSec: 299,
      movingSec: 299,
      distanceM: 2250,
      stats: {
        avgHr: 135,
        maxHr: 149,
        minHr: 120,
        avgPaceSecKm: null,
        bestPaceSecKm: null,
        avgSpeedMs: 7.5,
        maxSpeedMs: 9,
        avgCad: 85,
        maxCad: 95,
        avgPower: 200,
        maxPower: 249,
        normalizedPower: 205,
        avgStrideM: null,
      },
    }),
  };
}

/** A treadmill run: heart rate and speed, no GPS, no analysis. */
export function indoorDoc(): WatchWorkoutDoc {
  const start = START + 2 * 86_400;
  const points: WatchPoint[] = Array.from({ length: 120 }, (_, i) => ({
    ts: start + i * 2,
    lat: null,
    lon: null,
    alt: null,
    hr: 110 + (i % 20),
    speed: 2.5,
    cadence: null,
    stride: null,
    power: null,
  }));
  return {
    v: WATCH_WORKOUT_DOC_VERSION,
    engineRev: 0,
    workout: record(start, {
      end: start + 238,
      sportType: 5,
      sportName: "Treadmill",
      duration: 238,
      distance: 595,
      steps: 0,
      calories: 30,
    }),
    points: encodePoints(points),
    analysis: null,
  };
}
