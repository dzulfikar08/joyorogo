// Port of `HuaweiDiaryParser.kt`: the parts of `Health detail data` that go to JoyoRogo's diary and water log and to the profile:
// `NUTRITION_RECORD` (one meal per point), `DRINK_WATER` (ml per drink, summed per local day by the importer) and `USER_HEIGHT` (cm,
// 0 when never set).

import { javaDouble, roundToInt, toIntOrNull } from "./java";
import { embeddedObject, epochMs, number, sampleOf } from "./json";
import type { JObject } from "./json";
import type { Collector } from "./model";

export const KEY_MEAL = "NUTRITION_RECORD";
export const KEY_WATER = "DRINK_WATER";
export const KEY_HEIGHT = "USER_HEIGHT";

/** The diary row's name: the export says what was eaten in kcal and grams, not what it was. */
export const MEAL_NAME = "Makanan dari Huawei Health";

const MAX_ML_PER_DRINK = 5000;

export function handles(key: string): boolean {
  return key === KEY_MEAL || key === KEY_WATER || key === KEY_HEIGHT;
}

export function parseDiary(
  key: string,
  value: unknown,
  startMs: number | null,
  zone: string,
  id: string,
  out: Collector,
) {
  if (startMs === null) {
    out.rejected(key, "no-time", null);
    return;
  }
  const obj = embeddedObject(value);
  switch (key) {
    case KEY_HEIGHT: {
      const cm = number(obj?.userHeight);
      if (cm === null) out.rejected(key, "no-number", sampleOf(value));
      else if (cm === 0) return; // never set
      else if (cm >= 100 && cm <= 250) out.profileFact("height", cm, startMs);
      else out.rejected(key, "out-of-range", javaDouble(cm));
      return;
    }
    case KEY_WATER: {
      const n = number(obj?.drinkWater);
      const ml = n === null ? null : roundToInt(n);
      if (ml === null) out.rejected(key, "no-number", sampleOf(value));
      else if (ml >= 1 && ml <= MAX_ML_PER_DRINK) out.water(localDate(startMs, zone), ml, id);
      else out.rejected(key, "out-of-range", String(ml));
      return;
    }
    case KEY_MEAL:
      meal(obj, startMs, zone, id, out);
  }
}

function meal(obj: JObject | null, startMs: number, zone: string, id: string, out: Collector) {
  const kcal = number(obj?.dietaryEnergy);
  if (kcal === null) {
    out.rejected(KEY_MEAL, "no-number", sampleOf(obj ?? undefined));
    return;
  }
  if (kcal <= 0 || kcal > 5000) {
    out.rejected(KEY_MEAL, "out-of-range", javaDouble(kcal));
    return;
  }
  const eatenSec = seconds(obj?.mealEatTime);
  const recordedSec = seconds(obj?.mealRecordTime);
  const eatenMs = eatenSec === null ? null : eatenSec * 1000;
  const recordedMs = recordedSec === null ? null : recordedSec * 1000;
  const code = number(obj?.meal);
  out.meal({
    key: id,
    date: localDate(startMs, zone),
    meal: slot(code === null ? null : roundToInt(code), eatenMs ?? recordedMs ?? startMs, zone),
    name: MEAL_NAME,
    kcal: Math.round(kcal * 10) / 10,
    protein: grams(obj?.protein),
    carbs: grams(obj?.carbohydrates),
    fat: grams(obj?.fat),
    eatenAtMs: eatenMs,
  });
}

function grams(value: unknown): number | null {
  const n = number(value);
  return n !== null && n >= 0 && n <= 500 ? Math.round(n * 10) / 10 : null;
}

/** A unix time in seconds as seconds, a millisecond one converted; null when absent or not a plausible date. */
function seconds(value: unknown): number | null {
  const ms = epochMs(value);
  return ms === null ? null : Math.trunc(ms / 1000);
}

/** JoyoRogo's slot for Huawei's `meal` code; a code not listed goes by the local hour it was eaten. */
export function slot(code: number | null, atMs: number, zone: string): string {
  switch (code) {
    case 10:
      return "sarapan";
    case 20:
      return "makan_siang";
    case 30:
      return "makan_malam";
    case 11:
    case 21:
    case 31:
      return "snack";
  }
  const hour = hourOf(atMs, zone);
  if (hour >= 4 && hour <= 9) return "sarapan";
  if (hour >= 10 && hour <= 14) return "makan_siang";
  if (hour >= 17 && hour <= 21) return "makan_malam";
  return "snack";
}

/** Seconds east of UTC of a zone text like `+0700`; +07:00 (the zone JoyoRogo files days under by default) when it is none. */
function offsetSeconds(zone: string): number {
  const text = zone.trim();
  if (text.length === 5 && (text[0] === "+" || text[0] === "-")) {
    const h = toIntOrNull(text.slice(1, 3));
    const m = toIntOrNull(text.slice(3, 5));
    if (h !== null && m !== null && h <= 18 && m < 60)
      return (h * 3600 + m * 60) * (text[0] === "-" ? -1 : 1);
  }
  return 7 * 3600;
}

/** `YYYY-MM-DD` of `ms` on the clock of `zone` (`+0700`). */
export function localDate(ms: number, zone: string): string {
  return new Date(ms + offsetSeconds(zone) * 1000).toISOString().slice(0, 10);
}

function hourOf(ms: number, zone: string): number {
  return new Date(ms + offsetSeconds(zone) * 1000).getUTCHours();
}
