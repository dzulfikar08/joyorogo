// Port of `HuaweiHealthDetailParser.kt`.
//
// The JSON files of the `Health detail data & description` folder: records `{type, startTime, endTime, timeZone, deviceCode, recordId,
// samplePoints:[{key, startTime, endTime, unit, value}]}`, times in milliseconds (UTC; `timeZone` is only the zone the phone was in, so
// nothing here shifts a time). `value` is a number as a string (`"82.0"`), an embedded JSON object, or empty (sleep stages). The same
// reading often comes twice under two numeric `type`s; a point is recognised by its `key` plus the fields either generation uses, and the
// collector keeps the first reading per minute (or per metric and second).
//
// Also `HuaweiSportPerMinuteParser`: the `Sport per minute merged data & description` folder, one record per day.

import { handles, parseDiary } from "./diary";
import { javaDouble, roundToInt } from "./java";
import {
  embeddedObject,
  epochMs,
  isObject,
  number,
  optArray,
  optObjectAt,
  optString,
  sampleOf,
} from "./json";
import type { JObject } from "./json";
import type { Collector } from "./model";
import { CollectedWeights, isWeightKey } from "./weight";

export const KEY_SPO2 = "BLOOD_OXYGEN_SATURATION";

/** The `health_metrics.type` ids the Health screen knows. */
export const MetricTypes = {
  STRESS: "emotion",
  HRV: "hrv",
  SLEEP_APNEA: "sleep_apnea",
  SKIN_TEMPERATURE: "skin_temperature",
  ARTERIAL_STIFFNESS: "arterial_stiffness",
  ARRHYTHMIA: "arrhythmia",
} as const;

/** Longest sleep stage taken as real; the export repeats and merges spans, and a day-long one is a broken one. */
const MAX_SLEEP_SPAN_SEC = 24 * 3600;

const SLEEP_KINDS = new Map<string, number>([
  ["PROFESSIONAL_SLEEP_SHALLOW", 0x06],
  ["PROFESSIONAL_SLEEP_DEEP", 0x07],
  ["PROFESSIONAL_SLEEP_DREAM", 0x5656],
  ["PROFESSIONAL_SLEEP_WAKE", 0x5658],
  ["PROFESSIONAL_SLEEP_NOON", 0x5659],
]);

/** `SleepSync.stageForRawKind`. */
function stageForRawKind(raw: number): string | null {
  switch (raw) {
    case 0x07:
      return "deep";
    case 0x06:
    case 0x5659:
      return "light";
    case 0x5656:
      return "rem";
    case 0x5658:
      return "awake";
    default:
      return null;
  }
}

const HEART_RATE_KEYS = new Set(["DATA_POINT_DYNAMIC_HEARTRATE", "DYNAMIC_HEART_RATE"]);
const RESTING_KEYS = new Set([
  "DATA_POINT_REST_HEARTRATE",
  "DATA_POINT_NEW_REST_HEARTRATE",
  "RESTING_HEART_RATE",
]);

/** `health_metrics` rows: key -> type, the fields that carry the number, the range it is believed in. */
interface MetricRule {
  type: string;
  fields: string[];
  min: number;
  max: number;
}

const METRICS = new Map<string, MetricRule>([
  [
    "STRESS_DATA",
    { type: MetricTypes.STRESS, fields: ["score", "stress", "value"], min: 1, max: 100 },
  ],
  [
    "STRESS",
    { type: MetricTypes.STRESS, fields: ["stressScore", "score", "value"], min: 1, max: 100 },
  ],
  [
    "HEART_RATE_VARIABILITY",
    {
      type: MetricTypes.HRV,
      fields: ["heartRateVariabilityRMSSD", "rmssd", "value"],
      min: 1,
      max: 400,
    },
  ],
  [
    "OBSTRUCTIVE_SLEEP_APNEA",
    { type: MetricTypes.SLEEP_APNEA, fields: ["osaLevel", "value"], min: 0, max: 10 },
  ],
  [
    "SKIN_TEMPERATURE",
    { type: MetricTypes.SKIN_TEMPERATURE, fields: ["skinTemperature", "value"], min: 20, max: 45 },
  ],
  [
    "VASCULAR_HEALTH",
    {
      type: MetricTypes.ARTERIAL_STIFFNESS,
      fields: ["pulseWaveVelocity", "value"],
      min: 1,
      max: 40,
    },
  ],
  [
    "ARRHYTHMIA_RESULT",
    { type: MetricTypes.ARRHYTHMIA, fields: ["ppgIrregularHeartbeat", "value"], min: 0, max: 10 },
  ],
]);

export function parseHealthDetail(record: JObject, out: Collector) {
  const points = optArray(record, "samplePoints");
  if (!points) return;
  const recordStart = epochMs(record.startTime);
  const recordEnd = epochMs(record.endTime);
  const weights = new CollectedWeights();
  const zone = optString(record, "timeZone", "");
  const recordId = optString(record, "recordId", "");
  for (let i = 0; i < points.length; i++) {
    const point = optObjectAt(points, i);
    if (!point) continue;
    const key = optString(point, "key", "");
    if (key.length === 0) continue;
    const startMs = epochMs(point.startTime) ?? recordStart;
    const endMs = epochMs(point.endTime) ?? recordEnd ?? startMs;
    if (handles(key)) {
      parseDiary(
        key,
        point.value,
        startMs,
        zone,
        recordId.length === 0 ? `${startMs}` : `${recordId}:${i}`,
        out,
      );
    } else {
      parsePoint(key, point.value, startMs, endMs, out, weights);
    }
  }
  weights.emit(out);
}

function parsePoint(
  key: string,
  value: unknown,
  startMs: number | null,
  endMs: number | null,
  out: Collector,
  weights: CollectedWeights,
) {
  const sleepKind = SLEEP_KINDS.get(key);
  const weightKey = isWeightKey(key);
  const metric = METRICS.get(key);
  const known =
    sleepKind !== undefined ||
    weightKey ||
    metric !== undefined ||
    HEART_RATE_KEYS.has(key) ||
    RESTING_KEYS.has(key) ||
    key === KEY_SPO2;
  if (!known) {
    out.unmapped(key);
    return;
  }
  if (startMs === null) {
    out.rejected(key, "no-time", null);
    return;
  }
  const startSec = Math.trunc(startMs / 1000);
  if (sleepKind !== undefined) {
    const endSec = Math.trunc((endMs ?? startMs) / 1000);
    if (endSec <= startSec || endSec - startSec > MAX_SLEEP_SPAN_SEC) {
      out.rejected(key, "bad-span", `${endSec - startSec}s`);
    } else {
      out.sleep({
        start: startSec,
        end: endSec,
        type: sleepKind,
        stage: stageForRawKind(sleepKind),
      });
    }
  } else if (weightKey) {
    if (!weights.add(key, value, startMs)) out.rejected(key, "no-weight", sampleOf(value));
  } else if (HEART_RATE_KEYS.has(key)) {
    reading(key, value, 20, 250, out, ["bpm", "value"], (n) =>
      out.heartRate(startSec, roundToInt(n)),
    );
  } else if (RESTING_KEYS.has(key)) {
    reading(key, value, 20, 200, out, ["restBpm", "oldRestBpm", "value"], (n) =>
      out.restingHeartRate(startSec, roundToInt(n)),
    );
  } else if (key === KEY_SPO2) {
    reading(
      key,
      value,
      50,
      100,
      out,
      ["avgSaturation", "averageSaturation", "spo2", "saturation", "value"],
      (n) => out.spo2(startSec, roundToInt(n)),
    );
  } else if (metric) {
    reading(key, value, metric.min, metric.max, out, metric.fields, (n) =>
      out.metric({
        type: metric.type,
        ts: startSec,
        value: n,
        json: `{"${metric.fields[0]}":${trimmed(n)},"source":"huawei-export"}`,
      }),
    );
  }
}

function trimmed(v: number): string {
  return Number.isInteger(v) ? String(v) : javaDouble(v);
}

/** Reads `value` (a plain number or the first of `names` in an embedded object) and hands it over or says why not. */
function reading(
  key: string,
  value: unknown,
  min: number,
  max: number,
  out: Collector,
  names: string[],
  accept: (n: number) => void,
) {
  const n = embeddedNumber(value, names);
  if (n === null) {
    out.rejected(key, "no-number", sampleOf(value));
    return;
  }
  if (n >= min && n <= max) accept(n);
  else out.rejected(key, "out-of-range", trimmed(n));
}

/** The plain number in `value`, or the first of `names` found in the JSON object `value` carries. */
function embeddedNumber(value: unknown, names: string[]): number | null {
  const plain = number(value);
  if (plain !== null) return plain;
  if (names.length === 0) return null;
  const obj = embeddedObject(value);
  if (!obj) return null;
  for (const name of names) {
    const n = number(obj[name]);
    if (n !== null) return n;
  }
  return null;
}

const MAX_STEPS_PER_MINUTE = 400;
const MAX_METRES_PER_MINUTE = 1000;
/** Small calories: 60 kcal in a minute is beyond any human. */
const MAX_CAL_PER_MINUTE = 60_000;

/**
 * One record per day, `{recordDay, sportDataUserData:[{startTime, endTime, sportType, sportBasicInfos:[{steps, distance (m), calorie,
 * altitude, floor, duration, count}]}]}`. The entry starts at `startTime`; its n-th info is the n-th minute (a `duration` above one skips
 * ahead). The export repeats the same minutes in several entries, so the collector keeps the largest value per minute.
 */
export function parseSportPerMinute(record: JObject, out: Collector) {
  const entries = optArray(record, "sportDataUserData");
  if (!entries) return;
  for (let i = 0; i < entries.length; i++) {
    const entry = optObjectAt(entries, i);
    if (!entry) continue;
    const infos = optArray(entry, "sportBasicInfos");
    if (!infos) continue;
    const firstMinuteMs = epochMs(entry.startTime);
    if (firstMinuteMs === null) {
      out.rejected("sportDataUserData", "no-time", null);
      continue;
    }
    let minuteMs = firstMinuteMs;
    for (let j = 0; j < infos.length; j++) {
      const info = infos[j];
      if (!isObject(info)) continue;
      const steps = rounded(info.steps) ?? 0;
      const distance = rounded(info.distance) ?? 0;
      const calories = rounded(info.calorie) ?? 0;
      if (
        steps >= 0 &&
        steps <= MAX_STEPS_PER_MINUTE &&
        distance >= 0 &&
        distance <= MAX_METRES_PER_MINUTE &&
        calories >= 0 &&
        calories <= MAX_CAL_PER_MINUTE
      ) {
        if (steps > 0 || distance > 0 || calories > 0)
          out.steps(Math.trunc(minuteMs / 60_000) * 60, steps, distance, calories);
      } else {
        out.rejected(
          "sportBasicInfos",
          "out-of-range",
          `${steps} steps/${distance} m/${calories} cal`,
        );
      }
      const duration = rounded(info.duration);
      const minutes = duration === null ? 1 : Math.min(60, Math.max(1, duration));
      minuteMs += minutes * 60_000;
    }
  }
}

function rounded(value: unknown): number | null {
  const n = number(value);
  return n === null ? null : roundToInt(n);
}
