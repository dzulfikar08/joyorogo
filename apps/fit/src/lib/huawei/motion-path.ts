// Port of `HuaweiMotionPathParser.kt`.
//
// The JSON files of the `Motion path detail data & description` folder: one object per tracked workout with the sport id (`subType`),
// `startTime`, `endTime`, `timeZone`, `summaryData` (JSON text: totals and heart-rate figures) and `detailData` (the track), once
// `attribute`: `HW_EXT_TRACK_DETAIL@i` followed by one record per line:
//
//  - `tp=lbs;k=N;lat=;lon=;alt=;t=<seconds, scientific notation>;` a GPS fix. `lat=90.0;lon=-80.0` is a pause marker.
//  - `tp=h-r;k=<ms>;v=<bpm>;` heart rate, `tp=alti;k=<ms>;v=<m>;` barometric altitude, `tp=s-r;k=<ms>;v=<steps/min>;` cadence.
//  - `tp=rs;k=<offset s>;v=<dm/s>` speed. `p-m`, `sec`, `b-p-m` are per-kilometre or per-session summaries, not stored.
//
// The object is sometimes invalid JSON. `fromBrokenText` reads the same fields straight off the raw text then: the line records do not
// depend on the JSON around them.

import {
  doubleToInt,
  javaJson,
  JAVA_SPACE,
  longToInt,
  parseJavaDouble,
  roundToInt,
  toLong,
} from "./java";
import { embeddedObject, epochMs, number, optString, readLenientString } from "./json";
import type { JObject } from "./json";
import { point } from "./model";
import type { ImportedWorkout, WorkoutPoint } from "./model";
import { exportSportName, isPace, joyofitType, sportKind } from "./sports";

/** Text the importer resynchronises on when a corrupt record swallowed its neighbours. */
export const RECORD_MARKER = '{"abnormalTrack":';

const HR_RANGE_MIN = 20;
const HR_RANGE_MAX = 250;
const CADENCE_RANGE_MAX = 300;
/** 100 m/s: nothing a person moves at on land. */
const SPEED_MAX_DM_PER_SEC = 1000;
/** Elevation changes under this many metres are barometer noise. */
const ELEVATION_NOISE_M = 3;

/** One GPS fix of a track; `startsSegment` after a pause marker. */
export interface GpsFix {
  ts: number;
  lat: number;
  lon: number;
  alt: number | null;
  startsSegment: boolean;
}

/** One sensor reading (heart rate in bpm, barometric altitude in metres, cadence in steps per minute) at `ts` unix seconds. */
export interface SensorReading {
  ts: number;
  value: number;
}

export interface MotionTrack {
  gps: GpsFix[];
  heartRates: SensorReading[];
  altitudes: SensorReading[];
  cadences: SensorReading[];
  /** `tp=rs`: `ts` is the offset in seconds from the workout's start, the value metres per second. */
  speeds: SensorReading[];
}

/** The fields of one `Motion path detail data` object that the importer reads. Times are milliseconds. */
export interface RawMotionPath {
  startMs: number | null;
  endMs: number | null;
  sportType: number | null;
  totalSteps: number | null;
  totalDistance: number | null;
  totalCalories: number | null;
  totalTime: number | null;
  timeZone: string | null;
  /** The track text (`detailData`, once `attribute`), one record per line. */
  attribute: string;
  /** The parsed `summaryData` JSON: heart-rate figures, pace, climb. */
  summary: JObject | null;
}

/**
 * One record of a real export: `{startTime, endTime, subType (the sport id), timeZone, summaryData: "<JSON text>", detailData:
 * "<track text>"}`. The totals live in `summaryData` (`totalDistance` m, `totalSteps`, `totalCalories` cal, `totalTime` ms); records in
 * the layout community converters describe carry them, and `attribute` for the track, at the top.
 */
export function fromJson(obj: JObject): RawMotionPath {
  const summary = embeddedObject(obj.summaryData);
  const total = (...names: string[]): number | null => {
    for (const name of names) {
      const fromSummary = number(summary?.[name]);
      if (fromSummary !== null) return fromSummary;
      const fromRecord = number(obj[name]);
      if (fromRecord !== null) return fromRecord;
    }
    return null;
  };
  const detail = optString(obj, "detailData", "");
  const sport = number(obj.subType !== undefined ? obj.subType : obj.sportType);
  const zone = optString(obj, "timeZone", "");
  return {
    startMs: epochMs(obj.startTime),
    endMs: epochMs(obj.endTime),
    sportType: sport === null ? null : roundToInt(sport),
    totalSteps: total("totalSteps", "steps"),
    totalDistance: total("totalDistance", "distance"),
    totalCalories: total("totalCalories", "calorie", "calories"),
    totalTime: total("totalTime", "duration"),
    timeZone: zone.length === 0 ? null : zone,
    attribute: detail.length === 0 ? optString(obj, "attribute", "") : detail,
    summary,
  };
}

const TOP_LEVEL = (name: string) =>
  new RegExp(`"${name}"${JAVA_SPACE}*:${JAVA_SPACE}*"?(-?[0-9][0-9.Ee+-]*)`);
const ANYWHERE = (name: string) =>
  new RegExp(`\\\\?"${name}\\\\?"${JAVA_SPACE}*:${JAVA_SPACE}*\\\\?"?(-?[0-9][0-9.Ee+-]*)`);

function finiteOrNull(text: string | undefined): number | null {
  if (text === undefined) return null;
  const n = parseJavaDouble(text);
  return n !== null && Number.isFinite(n) ? n : null;
}

/**
 * Regex fallback for a record that is not valid JSON; null when not even a start time can be found. Reads both layouts like
 * `fromJson`: the sport from `subType` (else `sportType`), the totals from the `summaryData` text before the top level. Inside the raw
 * record the summary's quotes are escaped (`\"totalDistance\":2500`), so a summary that does not parse is still read key by key.
 */
export function fromBrokenText(text: string): RawMotionPath | null {
  // Top-level keys only: the escaped `\"sportType\"` inside summaryData is another numbering (258 on a run).
  const scalar = (name: string) => finiteOrNull(TOP_LEVEL(name).exec(text)?.[1]);
  const anywhere = (name: string) => finiteOrNull(ANYWHERE(name).exec(text)?.[1]);
  const summary = summaryData(text);
  const total = (...names: string[]): number | null => {
    for (const name of names) {
      const fromSummary = number(summary?.[name]);
      if (fromSummary !== null) return fromSummary;
      const found = anywhere(name);
      if (found !== null) return found;
    }
    return null;
  };
  const startMs = epochMs(scalar("startTime"));
  const attribute = text.replaceAll("\\n", "\n");
  if (startMs === null && !attribute.includes("tp=lbs")) return null;
  const sport = scalar("subType") ?? scalar("sportType");
  return {
    startMs,
    endMs: epochMs(scalar("endTime")),
    sportType: sport === null ? null : roundToInt(sport),
    totalSteps: total("totalSteps", "steps"),
    totalDistance: total("totalDistance", "distance"),
    totalCalories: total("totalCalories", "calorie", "calories"),
    totalTime: total("totalTime", "duration"),
    timeZone: /"timeZone"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? null,
    attribute,
    summary,
  };
}

/** The `summaryData` string of a raw record, parsed; null when it is missing or not readable. Scanned, not matched, so a long one cannot exhaust a regex. */
function summaryData(text: string): JObject | null {
  const key = text.indexOf('"summaryData"');
  if (key < 0) return null;
  let at = key + '"summaryData"'.length;
  while (at < text.length && (/\s/.test(text[at] as string) || text[at] === ":")) at++;
  if (at >= text.length || text[at] !== '"') return null;
  let end = at + 1;
  while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
  if (end >= text.length) return null;
  return embeddedObject(readLenientString(text.slice(at, end + 1)));
}

export function parseTrack(attribute: string): MotionTrack {
  const gps: GpsFix[] = [];
  const heartRates: SensorReading[] = [];
  const altitudes: SensorReading[] = [];
  const cadences: SensorReading[] = [];
  const speeds: SensorReading[] = [];
  let pendingBreak = false;
  for (const line of attribute.split("\n")) {
    const at = line.indexOf("tp=");
    if (at < 0) continue;
    const fields = new Map<string, string>();
    for (const part of line.slice(at).split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
    switch (fields.get("tp")) {
      case "lbs": {
        const lat = number(fields.get("lat"));
        const lon = number(fields.get("lon"));
        const t = number(fields.get("t"));
        if (lat === null || lon === null) continue;
        if (lat === 90 && lon === -80) {
          pendingBreak = true;
        } else if (
          t !== null &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180 &&
          !(lat === 0 && lon === 0)
        ) {
          const seconds = roundToInt(t > 1e11 ? t / 1000 : t);
          // 0 is "no altitude" in these fixes; the barometer series carries the real one.
          const rawAlt = number(fields.get("alt"));
          gps.push({
            ts: seconds,
            lat,
            lon,
            alt: rawAlt !== null && rawAlt !== 0 ? rawAlt : null,
            startsSegment: pendingBreak,
          });
          pendingBreak = false;
        }
        break;
      }
      case "h-r": {
        const ms = number(fields.get("k"));
        const raw = number(fields.get("v"));
        const bpm = raw === null ? null : roundToInt(raw);
        if (ms !== null && bpm !== null && bpm >= HR_RANGE_MIN && bpm <= HR_RANGE_MAX) {
          heartRates.push({ ts: toLong(ms / 1000), value: bpm });
        }
        break;
      }
      case "alti": {
        const ms = number(fields.get("k"));
        const metres = number(fields.get("v"));
        if (ms !== null && metres !== null)
          altitudes.push({ ts: toLong(ms / 1000), value: metres });
        break;
      }
      case "s-r": {
        const ms = number(fields.get("k"));
        const raw = number(fields.get("v"));
        const spm = raw === null ? null : roundToInt(raw);
        if (ms !== null && spm !== null && spm >= 1 && spm <= CADENCE_RANGE_MAX) {
          cadences.push({ ts: toLong(ms / 1000), value: spm });
        }
        break;
      }
      case "rs": {
        const offset = number(fields.get("k"));
        const dmPerSec = number(fields.get("v"));
        // -1 is "no speed" (indoor and strength workouts write the series anyway); decimetres per second to metres.
        if (
          offset !== null &&
          dmPerSec !== null &&
          offset >= 0 &&
          dmPerSec >= 0 &&
          dmPerSec <= SPEED_MAX_DM_PER_SEC
        ) {
          speeds.push({ ts: toLong(offset), value: dmPerSec / 10 });
        }
        break;
      }
    }
  }
  return { gps, heartRates, altitudes, cadences, speeds };
}

/** The workout `raw` describes, or null when it has no usable start or no duration at all. */
export function build(raw: RawMotionPath): ImportedWorkout | null {
  const track = parseTrack(raw.attribute);
  const summaryHr = (name: string): number | null => {
    const n = number(raw.summary?.[name]);
    if (n === null) return null;
    const bpm = roundToInt(n);
    return bpm >= HR_RANGE_MIN && bpm <= HR_RANGE_MAX ? bpm : null;
  };
  let minTime: number | null = null;
  let maxTime: number | null = null;
  for (const list of [track.gps, track.heartRates, track.altitudes, track.cadences]) {
    for (const item of list) {
      if (minTime === null || item.ts < minTime) minTime = item.ts;
      if (maxTime === null || item.ts > maxTime) maxTime = item.ts;
    }
  }
  const start = raw.startMs !== null ? Math.trunc(raw.startMs / 1000) : minTime;
  if (start === null) return null;
  const elapsedMs = raw.endMs !== null ? raw.endMs - start * 1000 : null;
  const movingSec = totalTimeSeconds(raw.totalTime, elapsedMs);
  let end = raw.endMs !== null ? Math.trunc(raw.endMs / 1000) : (maxTime ?? start);
  if (end <= start) end = start + (movingSec ?? 0);
  if (end <= start) return null;
  const duration = longToInt(end - start);

  const distance = roundToInt(
    raw.totalDistance !== null && raw.totalDistance > 0
      ? raw.totalDistance
      : trackDistance(track.gps),
  );
  const heartRates = track.heartRates.map((h) => doubleToInt(h.value));
  // The track's own readings first; the summary's figures for a workout whose track has none.
  const avgHr =
    heartRates.length === 0
      ? summaryHr("avgHeartRate")
      : roundToInt(sum(heartRates) / heartRates.length);
  const maxHr = heartRates.length === 0 ? summaryHr("maxHeartRate") : max(heartRates);
  const sportType = joyofitType(raw.sportType);
  const kind = sportKind(sportType);

  const points: WorkoutPoint[] = [];
  for (const g of track.gps) points.push(point(g.ts, { lat: g.lat, lon: g.lon, alt: g.alt }));
  for (const h of track.heartRates) points.push(point(h.ts, { hr: doubleToInt(h.value) }));
  for (const a of track.altitudes) points.push(point(a.ts, { alt: a.value }));
  for (const c of track.cadences) points.push(point(c.ts, { cadence: doubleToInt(c.value) }));
  for (const v of track.speeds) points.push(point(start + v.ts, { speed: v.value }));
  // Stable: GPS fixes before sensor readings of the same second.
  points.sort((a, b) => a.ts - b.ts);

  return {
    start,
    end,
    sportType,
    sportName: exportSportName(raw.sportType),
    duration,
    distance,
    calories: kcal(raw.totalCalories),
    steps: raw.totalSteps === null ? 0 : Math.max(0, roundToInt(raw.totalSteps)),
    avgHr,
    maxHr,
    summaryJson: summaryJson(raw, kind, duration, distance, movingSec, track, heartRates),
    points,
  };
}

function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function max(values: number[]): number {
  let best = values[0] as number;
  for (const v of values) if (v > best) best = v;
  return best;
}

/**
 * `totalCalories` is in small calories (cal, 1/1000 kcal) as the field description says; on a real export the 103 workouts come to a
 * median of 7.8 kcal per minute that way (and to nonsense in any other unit).
 */
export function kcal(raw: number | null): number {
  return raw === null || raw <= 0 ? 0 : roundToInt(raw / 1000);
}

/** `totalTime` in seconds, reading it as the unit (ms or s) that lands closer to the elapsed time; ms without one. */
function totalTimeSeconds(totalTime: number | null, elapsedMs: number | null): number | null {
  if (totalTime === null || totalTime <= 0) return null;
  if (elapsedMs === null || elapsedMs <= 0) return roundToInt(totalTime / 1000);
  const asMs = Math.abs(totalTime - elapsedMs);
  const asSec = Math.abs(totalTime * 1000 - elapsedMs);
  return asSec < asMs ? roundToInt(totalTime) : roundToInt(totalTime / 1000);
}

/** Metres along the fixes, not across a pause. */
export function trackDistance(gps: GpsFix[]): number {
  let total = 0;
  for (let i = 1; i < gps.length; i++) {
    const a = gps[i - 1] as GpsFix;
    const b = gps[i] as GpsFix;
    if (b.startsSegment) continue;
    total += haversine(a.lat, a.lon, b.lat, b.lon);
  }
  return total;
}

const RADIANS = Math.PI / 180;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000;
  const p1 = lat1 * RADIANS;
  const p2 = lat2 * RADIANS;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * RADIANS;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Climb and descent of an altitude series, ignoring swings smaller than the barometer noise. */
export function elevationChange(altitudes: number[]): [gain: number, loss: number] {
  if (altitudes.length === 0) return [0, 0];
  let reference = altitudes[0] as number;
  let gain = 0;
  let loss = 0;
  for (const a of altitudes) {
    if (a - reference >= ELEVATION_NOISE_M) {
      gain += a - reference;
      reference = a;
    } else if (reference - a >= ELEVATION_NOISE_M) {
      loss += reference - a;
      reference = a;
    }
  }
  return [gain, loss];
}

function summaryJson(
  raw: RawMotionPath,
  kind: string,
  duration: number,
  distance: number,
  movingSec: number | null,
  track: MotionTrack,
  heartRates: number[],
): string {
  const json: Record<string, unknown> = { kind, source: "huawei-export" };
  if (raw.sportType !== null) json.huaweiSportType = raw.sportType;
  if (raw.timeZone !== null) json.timeZone = raw.timeZone;
  if (movingSec !== null) json.movingTimeSec = movingSec;
  json.gps = track.gps.length === 0 ? "none" : "ok";
  json.gpsPoints = track.gps.length;
  if (duration > 0 && distance > 0) {
    const avgSpeed = distance / duration;
    json.avgSpeed = avgSpeed;
    if (isPace(kind)) json.avgPaceSecPerKm = 1000 / avgSpeed;
  }
  if (heartRates.length > 0) json.minHr = heartRates.reduce((a, b) => Math.min(a, b));
  // `creepingWave` (climb) and `mTotalDescent` are decimetres, 0 or -1 when the watch had no barometer reading.
  if (track.altitudes.length === 0) {
    const climb = number(raw.summary?.creepingWave);
    if (climb !== null && climb > 0) json.elevationGain = climb / 10;
    const descent = number(raw.summary?.mTotalDescent);
    if (descent !== null && descent > 0) json.elevationLoss = descent / 10;
  } else {
    const values = track.altitudes.map((a) => a.value);
    let low = values[0] as number;
    let high = low;
    for (const v of values) {
      if (v < low) low = v;
      if (v > high) high = v;
    }
    json.minAltitude = low;
    json.maxAltitude = high;
    json.avgAltitude = sum(values) / values.length;
    const [gain, loss] = elevationChange(values);
    json.elevationGain = gain;
    json.elevationLoss = loss;
  }
  return javaJson(json);
}
