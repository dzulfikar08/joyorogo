/**
 * Reads a FIT activity file (Garmin, Wahoo, iGPSPORT, Bryton, COROS, Suunto and most bike computers and watches write
 * it) with Garmin's own SDK, the same way the JoyoFit app does (watch-fit src/features/fitimport/parseFit.ts, which this
 * follows: sessions are added up into one workout, records become points, laps are kept when there are two or more).
 * Errors are values. No DOM, no React: runs under `bun test`.
 */
import { Decoder, type FitMessages, Stream } from "@garmin/fitsdk";
import type { WatchPoint } from "@joyorogo/api/lib/watch-workout";

import { activeSeconds, maxOf, meanOf, minOf, normalizedPower } from "./common";
import {
  type ImportError,
  type ImportLap,
  type ParsedActivity,
  SPORT_TYPE,
  type SportInfo,
  sportOf,
} from "./types";

/** Seconds from the Unix epoch to the FIT epoch (1989-12-31 00:00 UTC). */
export const FIT_EPOCH_OFFSET = 631_065_600;
/** FIT timestamps below this are time since the device powered on, not UTC. */
const MIN_UTC_FIT_TIME = 0x10000000;

type Session = NonNullable<FitMessages["sessionMesgs"]>[number];
type RecordMesg = NonNullable<FitMessages["recordMesgs"]>[number];
type LapMesg = NonNullable<FitMessages["lapMesgs"]>[number];

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const positive = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
};
const nonNegative = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
};
const rounded = (value: number | null): number | null =>
  value === null ? null : Math.round(value);
const fail = (reason: ImportError["reason"]): ImportError => ({ ok: false, reason });

/** FIT `sport` and `sub_sport` (names, or numbers the SDK has no name for) to the Huawei sport JoyoFit stores. */
export function sportFor(
  fitSport: string | number | undefined,
  fitSubSport: string | number | undefined,
): SportInfo {
  const sport = String(fitSport);
  const sub = String(fitSubSport);
  const indoorRide = sub === "indoorCycling" || sub === "spin" || sub === "virtualActivity";
  const treadmill = sub === "treadmill" || sub === "indoorRunning" || sub === "virtualActivity";
  const indoorWalk = sub === "indoorWalking" || sub === "treadmill";
  let type: number = SPORT_TYPE.other;
  if (sport === "cycling" || sport === "eBiking")
    type = indoorRide ? SPORT_TYPE.indoorCycling : SPORT_TYPE.cycling;
  else if (sport === "fitnessEquipment" && (sub === "indoorCycling" || sub === "spin"))
    type = SPORT_TYPE.indoorCycling;
  else if (sport === "running")
    type =
      sub === "trail"
        ? SPORT_TYPE.trailRun
        : treadmill
          ? SPORT_TYPE.indoorRunning
          : SPORT_TYPE.running;
  else if (sport === "walking") type = indoorWalk ? SPORT_TYPE.indoorWalking : SPORT_TYPE.walking;
  else if (sport === "hiking") type = SPORT_TYPE.hiking;
  return sportOf(type);
}

/** FIT `manufacturer` names (SDK profile) to the brand as written on the box. Others stay out of the workout name. */
const BRANDS: Readonly<Record<string, string>> = {
  igpsport: "iGPSPORT",
  garmin: "Garmin",
  wahooFitness: "Wahoo",
  magene: "Magene",
  bryton: "Bryton",
  brytonSensors: "Bryton",
  coros: "COROS",
  corosByte: "COROS",
  suunto: "Suunto",
  polarElectro: "Polar",
  hammerhead: "Hammerhead",
  lezyne: "Lezyne",
  sigmasport: "Sigma",
  stagesCycling: "Stages",
  cycplus: "CYCPLUS",
  onelap: "OneLap",
  giantManufacturingCo: "Giant",
  zwift: "Zwift",
  zwiftByte: "Zwift",
};

const semicirclesToDegrees = (value: number): number => (value * 180) / 2 ** 31;

/** `cadence` (+ `fractional_cadence`) in the unit a point stores: a foot sport's strides per minute are doubled to steps. */
function cadenceOf(cadence: unknown, fractional: unknown, foot: boolean): number | null {
  const whole = nonNegative(cadence);
  if (whole === null) return null;
  return Math.round((whole + (nonNegative(fractional) ?? 0)) * (foot ? 2 : 1));
}

function pointOf(record: RecordMesg, foot: boolean): WatchPoint | null {
  const t = num(record.timestamp);
  if (t === null || t < MIN_UTC_FIT_TIME) return null;
  const rawLat = num(record.positionLat);
  const rawLon = num(record.positionLong);
  let lat: number | null = null;
  let lon: number | null = null;
  if (rawLat !== null && rawLon !== null) {
    const la = semicirclesToDegrees(rawLat);
    const lo = semicirclesToDegrees(rawLon);
    // Some head units write 0,0 before the first fix.
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
      lat = la;
      lon = lo;
    }
  }
  const hr = num(record.heartRate);
  const power = nonNegative(record.power);
  const stepLength = positive(record.stepLength);
  return {
    ts: t + FIT_EPOCH_OFFSET,
    lat,
    lon,
    alt: num(record.enhancedAltitude) ?? num(record.altitude),
    hr: hr !== null && hr > 0 && hr < 255 ? Math.round(hr) : null,
    speed: nonNegative(record.enhancedSpeed) ?? nonNegative(record.speed),
    cadence: cadenceOf(record.cadence, record.fractionalCadence, foot),
    stride: stepLength === null ? null : stepLength / 1000,
    power: power === null ? null : Math.round(power),
  };
}

function lapOf(mesg: LapMesg, foot: boolean): ImportLap | null {
  const start = num(mesg.startTime);
  const elapsed = positive(mesg.totalElapsedTime) ?? positive(mesg.totalTimerTime);
  if (start === null || start < MIN_UTC_FIT_TIME || elapsed === null) return null;
  const avgHr = positive(mesg.avgHeartRate);
  const maxHr = positive(mesg.maxHeartRate);
  const cadence = cadenceOf(mesg.avgCadence, mesg.avgFractionalCadence, foot);
  return {
    startTs: start + FIT_EPOCH_OFFSET,
    endTs: Math.round(start + elapsed) + FIT_EPOCH_OFFSET,
    distanceM: positive(mesg.totalDistance),
    avgHr: avgHr === null ? null : Math.round(avgHr),
    maxHr: maxHr === null ? null : Math.round(maxHr),
    avgCadence: cadence !== null && cadence > 0 ? cadence : null,
  };
}

/** Mean of `value` over the sessions that have it, weighted by active time. */
function weighted(
  sessions: readonly Session[],
  value: (s: Session) => number | null,
): number | null {
  let sum = 0;
  let weight = 0;
  for (const s of sessions) {
    const v = value(s);
    if (v === null) continue;
    const w = positive(s.totalTimerTime) ?? 1;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

function sumOf(sessions: readonly Session[], value: (s: Session) => number | null): number | null {
  let total: number | null = null;
  for (const s of sessions) {
    const v = value(s);
    if (v !== null) total = (total ?? 0) + v;
  }
  return total;
}

function maxOfSessions(
  sessions: readonly Session[],
  value: (s: Session) => number | null,
): number | null {
  return maxOf(sessions.map(value));
}

/** An activity needs a `session` message and a start time; heart rate, position, altitude, power and cadence are optional. */
export function parseFit(bytes: Uint8Array): ParsedActivity | ImportError {
  let messages: FitMessages;
  try {
    // A copy, so the SDK reads exactly these bytes whatever buffer the caller's view sits in.
    const decoder = new Decoder(Stream.fromArrayBuffer(bytes.slice().buffer));
    if (!decoder.isFIT()) return fail("not-fit");
    if (!decoder.checkIntegrity()) return fail("corrupt");
    messages = decoder.read({ convertDateTimesToDates: false }).messages;
  } catch {
    return fail("corrupt");
  }

  const fileType = messages.fileIdMesgs?.[0]?.type;
  if (fileType !== undefined && String(fileType) !== "activity") return fail("not-activity");

  const sessions = (messages.sessionMesgs ?? [])
    .filter((s) => num(s.startTime) !== null)
    .sort((a, b) => (num(a.startTime) ?? 0) - (num(b.startTime) ?? 0));
  if (sessions.length === 0) return fail("no-session");

  const startFit = Math.min(...sessions.map((s) => num(s.startTime) as number));
  if (startFit < MIN_UTC_FIT_TIME) return fail("no-session");
  const start = startFit + FIT_EPOCH_OFFSET;

  const longest = sessions.reduce((a, b) =>
    (positive(b.totalTimerTime) ?? 0) > (positive(a.totalTimerTime) ?? 0) ? b : a,
  );
  const sport = sportFor(longest.sport, longest.subSport);
  const points = (messages.recordMesgs ?? [])
    .map((r) => pointOf(r, sport.foot))
    .filter((p): p is WatchPoint => p !== null)
    .sort((a, b) => a.ts - b.ts);
  const laps = (messages.lapMesgs ?? [])
    .map((l) => lapOf(l, sport.foot))
    .filter((l): l is ImportLap => l !== null)
    .sort((a, b) => a.startTs - b.startTs);

  const elapsedOf = (s: Session): number | null =>
    positive(s.totalElapsedTime) ?? positive(s.totalTimerTime);
  let end =
    Math.max(...sessions.map((s) => (num(s.startTime) as number) + (elapsedOf(s) ?? 0))) +
    FIT_EPOCH_OFFSET;
  const lastPoint = points[points.length - 1];
  if (end <= start && lastPoint) end = lastPoint.ts;
  if (end <= start) return fail("no-session");

  const timer = Math.round(
    sumOf(sessions, (s) => positive(s.totalTimerTime)) ?? (activeSeconds(points) || end - start),
  );
  const lastRecord = messages.recordMesgs?.[messages.recordMesgs.length - 1];
  const distance =
    sumOf(sessions, (s) => positive(s.totalDistance)) ?? positive(lastRecord?.distance) ?? 0;
  const strides = sumOf(sessions, (s) => positive(s.totalStrides));
  const manufacturerRaw = messages.fileIdMesgs?.[0]?.manufacturer;
  const brand = manufacturerRaw === undefined ? null : (BRANDS[String(manufacturerRaw)] ?? null);
  const hrs = points.map((p) => p.hr);

  return {
    format: "fit",
    start,
    end,
    sport,
    name: brand ? `${sport.name} (${brand})` : sport.name,
    timerSeconds: timer,
    distance,
    calories: Math.round(sumOf(sessions, (s) => positive(s.totalCalories)) ?? 0),
    avgHr: rounded(weighted(sessions, (s) => positive(s.avgHeartRate)) ?? meanOf(hrs)),
    maxHr: maxOfSessions(sessions, (s) => positive(s.maxHeartRate)) ?? maxOf(hrs),
    minHr: minOf(hrs),
    avgSpeed:
      weighted(sessions, (s) => positive(s.enhancedAvgSpeed) ?? positive(s.avgSpeed)) ??
      (distance > 0 && timer > 0 ? distance / timer : null),
    maxSpeed: maxOfSessions(sessions, (s) => positive(s.enhancedMaxSpeed) ?? positive(s.maxSpeed)),
    ascent: rounded(sumOf(sessions, (s) => num(s.totalAscent))),
    descent: rounded(sumOf(sessions, (s) => num(s.totalDescent))),
    steps: sport.foot && strides !== null ? Math.round(strides * 2) : 0,
    avgCadence: rounded(weighted(sessions, (s) => positive(s.avgCadence))),
    maxCadence: maxOfSessions(sessions, (s) => positive(s.maxCadence)),
    avgPower: rounded(weighted(sessions, (s) => positive(s.avgPower))),
    maxPower: maxOfSessions(sessions, (s) => positive(s.maxPower)),
    normalizedPower:
      rounded(weighted(sessions, (s) => positive(s.normalizedPower))) ?? normalizedPower(points),
    laps: laps.length >= 2 ? laps : [],
    points,
  };
}
