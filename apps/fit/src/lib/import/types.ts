// What the browser reads out of a workout file (FIT, GPX or TCX) before it becomes a cloud workout document.

import type { WatchPoint } from "@joyorogo/api/lib/watch-workout";

export type ImportFormat = "fit" | "gpx" | "tcx";

/** Huawei sport type bytes, as `watch_workout` / JoyoFit's `workouts.sport_type` store them (WorkoutSportTypes.kt). */
export const SPORT_TYPE = {
  running: 1,
  walking: 2,
  cycling: 3,
  indoorRunning: 5,
  indoorCycling: 7,
  trailRun: 11,
  indoorWalking: 13,
  hiking: 14,
  /** The watch's own "Exercise": every sport JoyoFit does not name. */
  other: 255,
} as const;

export type SportKindName =
  | "RUNNING"
  | "WALKING"
  | "CYCLING"
  | "INDOOR_RUNNING"
  | "INDOOR_CYCLING"
  | "TRAIL_RUN"
  | "INDOOR_WALKING"
  | "HIKING"
  | "EXERCISE";

export interface SportInfo {
  type: number;
  kind: SportKindName;
  /** Short name; the file's manufacturer is added in parentheses by FIT. */
  name: string;
  /** Foot sport: pace per km is the natural figure and cadence counts steps. */
  foot: boolean;
}

export const SPORTS: Readonly<Record<number, SportInfo>> = {
  [SPORT_TYPE.running]: { type: SPORT_TYPE.running, kind: "RUNNING", name: "Run", foot: true },
  [SPORT_TYPE.walking]: { type: SPORT_TYPE.walking, kind: "WALKING", name: "Walk", foot: true },
  [SPORT_TYPE.cycling]: { type: SPORT_TYPE.cycling, kind: "CYCLING", name: "Ride", foot: false },
  [SPORT_TYPE.indoorRunning]: {
    type: SPORT_TYPE.indoorRunning,
    kind: "INDOOR_RUNNING",
    name: "Treadmill run",
    foot: true,
  },
  [SPORT_TYPE.indoorCycling]: {
    type: SPORT_TYPE.indoorCycling,
    kind: "INDOOR_CYCLING",
    name: "Indoor ride",
    foot: false,
  },
  [SPORT_TYPE.trailRun]: {
    type: SPORT_TYPE.trailRun,
    kind: "TRAIL_RUN",
    name: "Trail run",
    foot: true,
  },
  [SPORT_TYPE.indoorWalking]: {
    type: SPORT_TYPE.indoorWalking,
    kind: "INDOOR_WALKING",
    name: "Indoor walk",
    foot: true,
  },
  [SPORT_TYPE.hiking]: { type: SPORT_TYPE.hiking, kind: "HIKING", name: "Hike", foot: true },
  [SPORT_TYPE.other]: { type: SPORT_TYPE.other, kind: "EXERCISE", name: "Workout", foot: false },
};

export const sportOf = (type: number): SportInfo =>
  SPORTS[type] ?? (SPORTS[SPORT_TYPE.other] as SportInfo);

/** One lap of a file. Times are unix seconds; cadence is steps per minute (foot) or rpm (bike). */
export interface ImportLap {
  startTs: number;
  endTs: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
}

export interface ParsedActivity {
  format: ImportFormat;
  /** Unix seconds. */
  start: number;
  end: number;
  sport: SportInfo;
  /** `Ride (iGPSPORT)`, or the track's own name for GPX/TCX. */
  name: string;
  /** Active seconds. */
  timerSeconds: number;
  /** Metres. */
  distance: number;
  /** kcal. */
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  /** Metres per second. */
  avgSpeed: number | null;
  maxSpeed: number | null;
  ascent: number | null;
  descent: number | null;
  /** Steps of a foot sport, 0 when the file does not count them. */
  steps: number;
  avgCadence: number | null;
  maxCadence: number | null;
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  /** Laps in time order; empty unless the file has at least two. */
  laps: ImportLap[];
  points: WatchPoint[];
}

/** Why a file is not turned into a workout. The screen words each one (`upload.errors.<reason>`). */
export type ImportFailure =
  | "unsupported"
  | "empty"
  | "too-large"
  | "not-fit"
  | "corrupt"
  | "not-activity"
  | "no-session"
  | "no-points"
  | "bad-xml";

export interface ImportError {
  ok: false;
  reason: ImportFailure;
}

export const isImportError = (value: ParsedActivity | ImportError): value is ImportError =>
  "ok" in value;
