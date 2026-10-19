/**
 * One JoyoFit cloud workout as a FIT activity file (the format Garmin, Strava, TrainingPeaks, Intervals.icu and the
 * watches' own apps read). Built from the stored document, with nothing invented: one `record` per recorded sample,
 * the watch's own totals on the lap and the session, and a channel (GPS, altitude, heart rate, cadence, speed, power)
 * only when the workout has it.
 *
 * Messages, in order: file_id, device_info (JoyoFit as the writing software), timer start, one record per sample,
 * timer stop, one lap per recorded lap (one lap for the whole workout when the watch kept fewer than two), session,
 * activity. The layouts follow JoyoFit's Strava upload file (`src/features/strava/activityFile.ts` in the JoyoFit app
 * repo, same owner) without its pause detection and Strava-specific fields: the stored document does not say where
 * the watch paused, so no pause events are written (the session still carries the watch's active time as timer time).
 *
 * Units on the wire: positions in semicircles, distance in centimetres, speed in mm/s, altitude as `(m + 500) * 5`,
 * times in the FIT epoch. Cadence is steps per minute in JoyoFit and strides (one leg) per minute in FIT for running,
 * walking and hiking, so those are halved and the odd step goes to `fractional_cadence`; a bike's rpm is written as is.
 */

import { decodePoints } from "@joyorogo/api/lib/watch-workout";
import type { WatchPoint, WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";

import { FitWriter, toFitTime, toSemicircles } from "./fit-encoder";
import type { FitFieldDef, FitFieldType, FitValue } from "./fit-encoder";

/** The wearer's offset from UTC for the activity's local time: JoyoFit shows every day in WIB (UTC+7). */
const UTC_OFFSET_SEC = 7 * 3600;

/** A watch active time this much shorter than the elapsed time is a pause (the same rule JoyoFit's Strava file uses). */
const PAUSE_MIN_SEC = 30;

const MESG = {
  fileId: 0,
  session: 18,
  lap: 19,
  record: 20,
  event: 21,
  deviceInfo: 23,
  activity: 34,
} as const;

const FIT = {
  fileActivity: 4,
  eventTimer: 0,
  eventSession: 8,
  eventLap: 9,
  eventActivity: 26,
  eventTypeStart: 0,
  eventTypeStop: 1,
  eventTypeStopAll: 4,
  lapTriggerManual: 0,
  lapTriggerSessionEnd: 7,
  sessionTriggerActivityEnd: 0,
  intensityActive: 0,
  activityManual: 0,
  deviceSoftware: 0,
  /** Manufacturer 255 is "development": JoyoFit has no registered manufacturer id. */
  manufacturerDevelopment: 255,
  productId: 1,
  productName: "JoyoFit",
} as const;

const FIT_SPORT = {
  generic: 0,
  running: 1,
  cycling: 2,
  fitnessEquipment: 4,
  swimming: 5,
  soccer: 7,
  tennis: 8,
  training: 10,
  walking: 11,
  rowing: 15,
  hiking: 17,
  paddling: 19,
  inlineSkating: 30,
  rockClimbing: 31,
  sailing: 32,
  iceSkating: 33,
  standUpPaddleboarding: 37,
  surfing: 38,
  hiit: 62,
  racket: 64,
} as const;

const SUB = {
  generic: 0,
  treadmill: 1,
  trail: 3,
  indoorCycling: 6,
  indoorRowing: 14,
  elliptical: 15,
  stairClimbing: 16,
  lapSwimming: 17,
  openWater: 18,
  strengthTraining: 20,
  indoorWalking: 27,
  yoga: 43,
  pilates: 44,
  squash: 94,
  badminton: 95,
  tableTennis: 97,
} as const;

type SportPair = readonly [sport: number, sub: number];

/** Huawei sport type byte (JoyoFit's `WorkoutSportTypes`) to FIT sport and sub sport. */
const SPORTS: Readonly<Record<number, SportPair>> = {
  1: [FIT_SPORT.running, SUB.generic],
  2: [FIT_SPORT.walking, SUB.generic],
  3: [FIT_SPORT.cycling, SUB.generic],
  4: [FIT_SPORT.hiking, SUB.generic],
  5: [FIT_SPORT.running, SUB.treadmill],
  6: [FIT_SPORT.swimming, SUB.lapSwimming],
  7: [FIT_SPORT.cycling, SUB.indoorCycling],
  8: [FIT_SPORT.swimming, SUB.openWater],
  11: [FIT_SPORT.running, SUB.trail],
  13: [FIT_SPORT.walking, SUB.indoorWalking],
  14: [FIT_SPORT.hiking, SUB.generic],
  128: [FIT_SPORT.racket, SUB.tableTennis],
  129: [FIT_SPORT.racket, SUB.badminton],
  130: [FIT_SPORT.tennis, SUB.generic],
  131: [FIT_SPORT.soccer, SUB.generic],
  134: [FIT_SPORT.fitnessEquipment, SUB.elliptical],
  135: [FIT_SPORT.rowing, SUB.indoorRowing],
  136: [FIT_SPORT.fitnessEquipment, SUB.stairClimbing],
  137: [FIT_SPORT.training, SUB.yoga],
  138: [FIT_SPORT.training, SUB.pilates],
  140: [FIT_SPORT.training, SUB.strengthTraining],
  141: [FIT_SPORT.cycling, SUB.indoorCycling],
  143: [FIT_SPORT.hiit, SUB.generic],
  145: [FIT_SPORT.training, SUB.generic],
  163: [FIT_SPORT.inlineSkating, SUB.generic],
  177: [FIT_SPORT.fitnessEquipment, SUB.stairClimbing],
  191: [FIT_SPORT.racket, SUB.squash],
  194: [FIT_SPORT.sailing, SUB.generic],
  195: [FIT_SPORT.surfing, SUB.generic],
  199: [FIT_SPORT.paddling, SUB.generic],
  200: [FIT_SPORT.rowing, SUB.generic],
  202: [FIT_SPORT.standUpPaddleboarding, SUB.generic],
  203: [FIT_SPORT.iceSkating, SUB.generic],
  209: [FIT_SPORT.generic, SUB.generic],
  210: [FIT_SPORT.rockClimbing, SUB.generic],
};

const BY_KIND: Readonly<Record<string, SportPair>> = {
  run: [FIT_SPORT.running, SUB.generic],
  walk: [FIT_SPORT.walking, SUB.generic],
  ride: [FIT_SPORT.cycling, SUB.generic],
  swim: [FIT_SPORT.swimming, SUB.generic],
};

/** FIT sport and sub sport of a workout: the watch's sport type when known, else its analysis kind, else training. */
export function fitSportOf(sportType: number, kind: string | undefined): SportPair {
  return (
    SPORTS[sportType] ?? (kind ? BY_KIND[kind] : undefined) ?? [FIT_SPORT.training, SUB.generic]
  );
}

const isFootSport = (sport: number): boolean =>
  sport === FIT_SPORT.running || sport === FIT_SPORT.walking || sport === FIT_SPORT.hiking;

interface Sample {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  speed: number | null;
  cadence: number | null;
  power: number | null;
  /** Cumulative metres, null when the workout has no distance to spread. */
  distance: number | null;
}

const EARTH_RADIUS_M = 6_371_000;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A GPS fix: both coordinates present, on the globe and not the (0, 0) a receiver writes before it has a fix. */
export function validFix(lat: number | null, lon: number | null): boolean {
  return (
    lat !== null &&
    lon !== null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** Samples in time order, one per second at most (points of one second merge: a value wins over a missing one). */
function collectSamples(points: readonly WatchPoint[]): Sample[] {
  const bySecond = new Map<number, Sample>();
  for (const p of points) {
    const ts = Math.round(p.ts);
    let sample = bySecond.get(ts);
    if (!sample) {
      sample = {
        ts,
        lat: null,
        lon: null,
        alt: null,
        hr: null,
        speed: null,
        cadence: null,
        power: null,
        distance: null,
      };
      bySecond.set(ts, sample);
    }
    if (validFix(p.lat, p.lon)) {
      sample.lat = p.lat;
      sample.lon = p.lon;
    }
    if (finite(p.alt)) sample.alt = p.alt;
    if (finite(p.hr) && p.hr > 0 && p.hr < 255) sample.hr = Math.round(p.hr);
    if (finite(p.speed) && p.speed >= 0 && p.speed < 100) sample.speed = p.speed;
    if (finite(p.cadence) && p.cadence >= 0 && p.cadence < 500)
      sample.cadence = Math.round(p.cadence);
    if (finite(p.power) && p.power >= 0 && p.power < 4000) sample.power = Math.round(p.power);
  }
  return [...bySecond.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Cumulative distance on every sample, scaled so the last one is the watch's `total` (raw GPS distance drifts):
 * - two or more fixes: the haversine path between fixes, scaled; samples between two fixes interpolate in time, the ones
 *   before the first fix stay at 0 and the ones after the last at `total`;
 * - no usable path: the samples' own speed integrated (a treadmill pod or a bike trainer) when at least half of them
 *   carry one, gaps over 5 s adding nothing, then scaled;
 * - neither: no per-sample distance (the lap and the session still carry the total).
 */
export function withDistance(samples: Sample[], total: number): void {
  if (!(total > 0) || samples.length === 0) return;
  const fixes: number[] = [];
  samples.forEach((s, i) => {
    if (s.lat !== null) fixes.push(i);
  });
  const cumulative: number[] = [0];
  for (let k = 1; k < fixes.length; k++) {
    const a = samples[fixes[k - 1] as number] as Sample;
    const b = samples[fixes[k] as number] as Sample;
    cumulative.push(
      (cumulative[k - 1] as number) +
        haversine(a.lat as number, a.lon as number, b.lat as number, b.lon as number),
    );
  }
  const gpsTotal = cumulative[cumulative.length - 1] as number;
  if (fixes.length >= 2 && gpsTotal > 0) {
    const scale = total / gpsTotal;
    fixes.forEach((index, k) => {
      (samples[index] as Sample).distance = (cumulative[k] as number) * scale;
    });
    const first = fixes[0] as number;
    const last = fixes[fixes.length - 1] as number;
    for (let i = 0; i < first; i++) (samples[i] as Sample).distance = 0;
    for (let i = last + 1; i < samples.length; i++) (samples[i] as Sample).distance = total;
    for (let k = 1; k < fixes.length; k++) {
      const a = samples[fixes[k - 1] as number] as Sample;
      const b = samples[fixes[k] as number] as Sample;
      const span = b.ts - a.ts;
      for (let i = (fixes[k - 1] as number) + 1; i < (fixes[k] as number); i++) {
        const s = samples[i] as Sample;
        s.distance =
          span > 0
            ? (a.distance as number) +
              (((b.distance as number) - (a.distance as number)) * (s.ts - a.ts)) / span
            : (a.distance as number);
      }
    }
    return;
  }
  const withSpeed = samples.filter((s) => s.speed !== null).length;
  if (withSpeed * 2 < samples.length) return;
  const running: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i] as Sample;
    const dt = s.ts - (samples[i - 1] as Sample).ts;
    running.push((running[i - 1] as number) + (dt <= 5 ? (s.speed ?? 0) * dt : 0));
  }
  const sum = running[running.length - 1] as number;
  if (!(sum > 0)) return;
  samples.forEach((s, i) => {
    s.distance = ((running[i] as number) * total) / sum;
  });
}

type Entry = readonly [num: number, type: FitFieldType, value: FitValue];

/** A whole number above zero, or null: what the watch did not measure is not written. */
const positive = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;

const nonNegative = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;

/** Average and peak of a channel over some samples; null when the stretch has no reading. */
function channelStats(inRange: readonly Sample[], pick: (s: Sample) => number | null) {
  const values = inRange.map(pick).filter((v): v is number => v !== null);
  if (values.length === 0) return { avg: null, max: null };
  let sum = 0;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
  }
  return { avg: Math.round(sum / values.length), max };
}

export interface BuiltFit {
  bytes: Uint8Array;
  /** `record` messages written. */
  samples: number;
}

/** The FIT activity of one stored workout document. */
export function buildFit(doc: WatchWorkoutDoc): BuiltFit {
  const { workout, analysis } = doc;
  const samples = collectSamples(decodePoints(doc.points));
  const [sport, subSport] = fitSportOf(workout.sportType, analysis?.sport.kind);
  const foot = isFootSport(sport);

  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  const start = Math.min(workout.start, firstSample?.ts ?? workout.start);
  const end = Math.max(workout.end, lastSample?.ts ?? workout.end, start);
  const elapsed = end - start;
  const active = Math.round(workout.duration);
  const timer = active > 0 && elapsed - active >= PAUSE_MIN_SEC ? active : elapsed;

  const total = analysis?.distanceM ?? (workout.distance > 0 ? workout.distance : 0);
  withDistance(samples, total);
  const hasDistance = samples.some((s) => s.distance !== null);
  const fixes = samples.filter((s) => s.lat !== null);
  const firstFix = fixes[0];
  const lastFix = fixes[fixes.length - 1];

  const avgSpeed = total > 0 && timer > 0 ? total / timer : null;
  const maxSpeedRaw = analysis?.stats.maxSpeedMs ?? null;
  const maxSpeed =
    maxSpeedRaw !== null && maxSpeedRaw > 0 ? Math.max(maxSpeedRaw, avgSpeed ?? 0) : null;
  /** FIT counts per leg on foot; JoyoFit keeps steps per minute (rpm on a bike). */
  const fitCadence = (c: number | null | undefined): number | null =>
    c === null || c === undefined || !(c > 0) ? null : Math.min(254, Math.round(foot ? c / 2 : c));
  const strides = foot && workout.steps > 0 ? Math.round(workout.steps / 2) : null;
  const avgCadence =
    strides !== null && timer > 0
      ? Math.round(strides / (timer / 60))
      : fitCadence(analysis?.stats.avgCad);
  const maxCadence = fitCadence(analysis?.stats.maxCad);
  const ascent = nonNegative(analysis?.elevation?.gainM);
  const descent = nonNegative(analysis?.elevation?.lossM);
  const calories = positive(workout.calories);
  const avgHr = positive(workout.avgHr ?? analysis?.stats.avgHr);
  const maxHr = positive(workout.maxHr ?? analysis?.stats.maxHr);
  const power = channelStats(samples, (s) => s.power);
  const avgPower = positive(analysis?.stats.avgPower) ?? positive(power.avg);
  const maxPower = positive(analysis?.stats.maxPower) ?? positive(power.max);
  const normalizedPower = positive(analysis?.stats.normalizedPower);

  const fit = new FitWriter();
  /** Defines and writes a message used once; fields without a value are left out of its definition. */
  const message = (local: number, global: number, entries: readonly Entry[]) => {
    const present = entries.filter(
      ([, , value]) =>
        value !== null &&
        value !== undefined &&
        !(typeof value === "number" && Number.isNaN(value)),
    );
    const definition = fit.define(
      local,
      global,
      present.map(([num, type, value]): FitFieldDef =>
        type === "string" ? { num, type, size: String(value).length + 1 } : { num, type },
      ),
    );
    fit.write(
      definition,
      present.map(([, , value]) => value),
    );
  };
  const timerEvent = (timestamp: number, eventType: number) =>
    message(2, MESG.event, [
      [253, "uint32", toFitTime(timestamp)],
      [0, "enum", FIT.eventTimer],
      [1, "enum", eventType],
      [4, "uint8", 0],
    ]);

  message(0, MESG.fileId, [
    [0, "enum", FIT.fileActivity],
    [1, "uint16", FIT.manufacturerDevelopment],
    [2, "uint16", FIT.productId],
    // JoyoFit has no device serial; the workout's start is unique per file.
    [3, "uint32z", workout.start],
    [4, "uint32", toFitTime(start)],
    [8, "string", FIT.productName],
  ]);
  message(1, MESG.deviceInfo, [
    [253, "uint32", toFitTime(start)],
    [0, "uint8", FIT.deviceSoftware],
    [2, "uint16", FIT.manufacturerDevelopment],
    [4, "uint16", FIT.productId],
    [27, "string", FIT.productName],
  ]);
  timerEvent(start, FIT.eventTypeStart);

  const hasAlt = samples.some((s) => s.alt !== null);
  const hasHr = samples.some((s) => s.hr !== null);
  const hasCadence = samples.some((s) => s.cadence !== null);
  const hasSpeed = samples.some((s) => s.speed !== null);
  const hasPower = samples.some((s) => s.power !== null);
  const recordFields: FitFieldDef[] = [{ num: 253, type: "uint32" }];
  if (fixes.length > 0) recordFields.push({ num: 0, type: "sint32" }, { num: 1, type: "sint32" });
  if (hasDistance) recordFields.push({ num: 5, type: "uint32" });
  if (hasAlt) recordFields.push({ num: 2, type: "uint16" }, { num: 78, type: "uint32" });
  if (hasHr) recordFields.push({ num: 3, type: "uint8" });
  if (hasCadence) recordFields.push({ num: 4, type: "uint8" });
  if (hasCadence && foot) recordFields.push({ num: 53, type: "uint8" });
  // Speed is metres per second x 1000 in both the 16-bit and the enhanced 32-bit field.
  if (hasSpeed) recordFields.push({ num: 6, type: "uint16" }, { num: 73, type: "uint32" });
  if (hasPower) recordFields.push({ num: 7, type: "uint16" });
  const record = fit.define(3, MESG.record, recordFields);
  for (const s of samples) {
    const values: FitValue[] = [toFitTime(s.ts)];
    if (fixes.length > 0)
      values.push(
        s.lat === null ? null : toSemicircles(s.lat),
        s.lon === null ? null : toSemicircles(s.lon as number),
      );
    if (hasDistance) values.push(s.distance === null ? null : s.distance * 100);
    // Altitude is `(metres + 500) * 5` in both the 16-bit and the enhanced 32-bit field.
    if (hasAlt)
      values.push(
        s.alt === null ? null : (s.alt + 500) * 5,
        s.alt === null ? null : (s.alt + 500) * 5,
      );
    if (hasHr) values.push(s.hr);
    if (hasCadence)
      values.push(
        s.cadence === null
          ? null
          : foot
            ? Math.min(254, Math.floor(s.cadence / 2))
            : Math.min(254, s.cadence),
      );
    // Half a step per minute in 1/128 units: the odd step of a per-leg cadence.
    if (hasCadence && foot) values.push(s.cadence === null ? null : (s.cadence % 2) * 64);
    if (hasSpeed)
      values.push(
        s.speed === null ? null : s.speed * 1000,
        s.speed === null ? null : s.speed * 1000,
      );
    if (hasPower) values.push(s.power);
    fit.write(record, values);
  }
  timerEvent(end, FIT.eventTypeStopAll);

  const position = (fix: Sample | undefined, lat: number, long: number): Entry[] => [
    [lat, "sint32", fix && fix.lat !== null ? toSemicircles(fix.lat) : null],
    [long, "sint32", fix && fix.lon !== null ? toSemicircles(fix.lon) : null],
  ];

  const laps = analysis && analysis.laps.length >= 2 ? analysis.laps : null;
  if (laps) {
    laps.forEach((lap, index) => {
      const last = index === laps.length - 1;
      const lapStart = Math.min(Math.max(start + Math.round(lap.startSec), start), end);
      const lapEnd = last ? end : Math.min(Math.max(lapStart + Math.round(lap.sec), lapStart), end);
      const inLap = samples.filter((s) => s.ts >= lapStart && s.ts <= lapEnd);
      const lapFixes = inLap.filter((s) => s.lat !== null);
      const lapElapsed = lapEnd - lapStart;
      const lapDistance =
        lap.distM !== null && lap.distM > 0
          ? lap.distM
          : (() => {
              const a = inLap.find((s) => s.distance !== null)?.distance;
              const b = inLap.findLast((s) => s.distance !== null)?.distance;
              return a !== undefined && b !== undefined && a !== null && b !== null ? b - a : 0;
            })();
      const lapSpeed = lapDistance > 0 && lapElapsed > 0 ? lapDistance / lapElapsed : null;
      const lapSpeedMax = channelStats(inLap, (s) => s.speed).max;
      const lapPower = channelStats(inLap, (s) => s.power);
      message(4, MESG.lap, [
        [253, "uint32", toFitTime(lapEnd)],
        [2, "uint32", toFitTime(lapStart)],
        ...position(lapFixes[0], 3, 4),
        ...position(lapFixes[lapFixes.length - 1], 5, 6),
        [7, "uint32", lapElapsed * 1000],
        [8, "uint32", lapElapsed * 1000],
        [9, "uint32", lapDistance > 0 ? lapDistance * 100 : null],
        [13, "uint16", lapSpeed === null ? null : lapSpeed * 1000],
        [14, "uint16", lapSpeedMax === null ? null : Math.max(lapSpeedMax, lapSpeed ?? 0) * 1000],
        [15, "uint8", positive(lap.avgHr)],
        [16, "uint8", positive(lap.maxHr)],
        [17, "uint8", fitCadence(lap.avgCad)],
        [19, "uint16", positive(lapPower.avg)],
        [20, "uint16", positive(lapPower.max)],
        [21, "uint16", nonNegative(lap.gainM)],
        [0, "enum", FIT.eventLap],
        [1, "enum", FIT.eventTypeStop],
        [23, "enum", FIT.intensityActive],
        [24, "enum", last ? FIT.lapTriggerSessionEnd : FIT.lapTriggerManual],
        [25, "enum", sport],
        [39, "enum", subSport],
        [110, "uint32", lapSpeed === null ? null : lapSpeed * 1000],
        [254, "uint16", index],
      ]);
    });
  } else {
    message(4, MESG.lap, [
      [253, "uint32", toFitTime(end)],
      [2, "uint32", toFitTime(start)],
      ...position(firstFix, 3, 4),
      ...position(lastFix, 5, 6),
      [7, "uint32", elapsed * 1000],
      [8, "uint32", timer * 1000],
      [9, "uint32", total > 0 ? total * 100 : null],
      [10, "uint32", strides],
      [11, "uint16", calories],
      [13, "uint16", avgSpeed === null ? null : avgSpeed * 1000],
      [14, "uint16", maxSpeed === null ? null : maxSpeed * 1000],
      [15, "uint8", avgHr],
      [16, "uint8", maxHr],
      [17, "uint8", avgCadence],
      [18, "uint8", maxCadence],
      [19, "uint16", avgPower],
      [20, "uint16", maxPower],
      [21, "uint16", ascent],
      [22, "uint16", descent],
      [33, "uint16", normalizedPower],
      [0, "enum", FIT.eventLap],
      [1, "enum", FIT.eventTypeStop],
      [23, "enum", FIT.intensityActive],
      [24, "enum", FIT.lapTriggerSessionEnd],
      [25, "enum", sport],
      [39, "enum", subSport],
      [110, "uint32", avgSpeed === null ? null : avgSpeed * 1000],
      [111, "uint32", maxSpeed === null ? null : maxSpeed * 1000],
      [254, "uint16", 0],
    ]);
  }

  message(5, MESG.session, [
    [253, "uint32", toFitTime(end)],
    [2, "uint32", toFitTime(start)],
    ...position(firstFix, 3, 4),
    [5, "enum", sport],
    [6, "enum", subSport],
    [7, "uint32", elapsed * 1000],
    [8, "uint32", timer * 1000],
    [9, "uint32", total > 0 ? total * 100 : null],
    [10, "uint32", strides],
    [11, "uint16", calories],
    [14, "uint16", avgSpeed === null ? null : avgSpeed * 1000],
    [15, "uint16", maxSpeed === null ? null : maxSpeed * 1000],
    [16, "uint8", avgHr],
    [17, "uint8", maxHr],
    [18, "uint8", avgCadence],
    [19, "uint8", maxCadence],
    [20, "uint16", avgPower],
    [21, "uint16", maxPower],
    [22, "uint16", ascent],
    [23, "uint16", descent],
    [25, "uint16", 0],
    [26, "uint16", laps ? laps.length : 1],
    [28, "enum", FIT.sessionTriggerActivityEnd],
    [34, "uint16", normalizedPower],
    [0, "enum", FIT.eventSession],
    [1, "enum", FIT.eventTypeStop],
    [124, "uint32", avgSpeed === null ? null : avgSpeed * 1000],
    [125, "uint32", maxSpeed === null ? null : maxSpeed * 1000],
    [254, "uint16", 0],
  ]);

  message(6, MESG.activity, [
    [253, "uint32", toFitTime(end)],
    [0, "uint32", timer * 1000],
    [1, "uint16", 1],
    [2, "enum", FIT.activityManual],
    [3, "enum", FIT.eventActivity],
    [4, "enum", FIT.eventTypeStop],
    [5, "uint32", toFitTime(end) + UTC_OFFSET_SEC],
  ]);

  return { bytes: fit.finish(), samples: samples.length };
}
