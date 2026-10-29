// Port of `HuaweiWeightParser.kt`: weigh-ins in the `Health detail data` files. A point counts as a weigh-in when its key says weight,
// body fat, body composition or BMI, and every numeric field is classified by what its name says. A value that cannot be what its name
// says (a body fat of 400 %) is dropped; a weigh-in without a plausible weight is not stored.

import { javaDouble, javaJson } from "./java";
import { embeddedObject, number } from "./json";
import type { Collector } from "./model";

const KEY_PARTS = ["weight", "bodyfat", "bodycomposition", "bmi"];
const KEY_EXCLUDED = ["goal", "target", "plan", "remind"];

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{Nd}]/gu, "");
}

export function isWeightKey(key: string): boolean {
  const n = normalize(key);
  return (
    KEY_PARTS.some((part) => n.includes(part)) && !KEY_EXCLUDED.some((part) => n.includes(part))
  );
}

function isRate(normalised: string): boolean {
  return ["rate", "percent", "pct"].some((part) => normalised.includes(part));
}

const NOT_BODY = [
  "skeletal",
  "arm",
  "leg",
  "trunk",
  "hf",
  "balance",
  "ratio",
  "shape",
  "score",
  "healthy",
];

/**
 * The `ReportedBody` field (or `weight` / `impedance`) a numeric field called `name` holds, null when it is none of them. The names
 * are those of Huawei's `BroadBodyFat` description; per-limb, per-frequency and skeletal values are left out.
 */
export function classify(name: string): string | null {
  const n = normalize(name);
  // The profile the scale weighed with: height cm, gender 1 male / 0 female, age in years. Not body values; they go to the profile.
  if (n === "height" || n === "gender" || n === "age") return n;
  if (NOT_BODY.some((part) => n.includes(part)) && !n.includes("proteinratio")) return null;
  if (n === "impedance" || n === "resistance") return "impedance";
  if (n.includes("bmi")) return "bmi";
  if (n.includes("visceral")) return "visceralFat";
  if (n.includes("bmr") || n.includes("basalmetab")) return "bmrKcal";
  if (n.includes("bodyage")) return "bodyAge";
  if (n.includes("protein")) return "proteinPct";
  if (n.includes("bone")) return "boneKg";
  if (n.includes("water") || n.includes("moisture")) return isRate(n) ? "waterPct" : null;
  if (
    n.includes("fatfree") ||
    n.includes("leanbody") ||
    n.includes("leanmass") ||
    n.includes("bodyfatfree")
  )
    return "leanKg";
  if (n.includes("muscle")) return isRate(n) ? "musclePct" : "muscleKg";
  if (n.includes("fat")) return isRate(n) ? "bodyFatPct" : null;
  if (n.includes("weight")) return n.includes("unit") || n.includes("division") ? null : "weight";
  return null;
}

const PCT_FIELDS = new Set(["bodyFatPct", "waterPct", "musclePct", "proteinPct"]);

const RANGES = new Map<string, [number, number]>([
  ["bodyFatPct", [1, 75]],
  ["waterPct", [20, 90]],
  ["musclePct", [10, 90]],
  ["muscleKg", [5, 120]],
  ["boneKg", [0.5, 10]],
  ["bmi", [8, 80]],
  ["visceralFat", [1, 59]],
  ["bmrKcal", [500, 5000]],
  ["proteinPct", [5, 40]],
  ["leanKg", [10, 200]],
  ["bodyAge", [5, 99]],
]);

/** Kilograms: a value of 10..500 is taken as kg, one of 10 000..500 000 as grams. */
function weightKg(raw: number | undefined): number | null {
  if (raw === undefined) return null;
  if (raw >= 10 && raw <= 500) return Math.round(raw * 100) / 100;
  if (raw >= 10_000 && raw <= 500_000) return Math.round(raw / 10) / 100;
  return null;
}

/** The weigh-ins of one record: fields of points within the same minute belong to one weighing. */
export class CollectedWeights {
  private readonly byMinute = new Map<number, { ts: number; fields: Map<string, number> }>();

  /** False when the point carried no numeric field this parser knows. */
  add(key: string, value: unknown, startMs: number): boolean {
    const fields = new Map<string, number>();
    const obj = embeddedObject(value);
    if (obj) {
      for (const name of Object.keys(obj)) {
        const field = classify(name);
        if (field === null) continue;
        const n = number(obj[name]);
        if (n !== null) fields.set(field, n);
      }
    } else {
      const field = classify(key);
      const n = number(value);
      if (field !== null && n !== null) fields.set(field, n);
    }
    if (fields.size === 0) return false;
    const minute = Math.floor(startMs / 60_000);
    let slot = this.byMinute.get(minute);
    if (!slot) {
      slot = { ts: startMs, fields: new Map() };
      this.byMinute.set(minute, slot);
    }
    for (const [field, n] of fields) if (!slot.fields.has(field)) slot.fields.set(field, n);
    return true;
  }

  emit(out: Collector) {
    for (const { ts, fields } of this.byMinute.values()) {
      const weight = weightKg(fields.get("weight"));
      if (weight === null) {
        const raw = fields.get("weight");
        out.rejected("weight", "no-weight", raw === undefined ? null : javaDouble(raw));
        continue;
      }
      const reported: Record<string, number> = {};
      let reportedCount = 0;
      for (const [field, raw] of fields) {
        const range = RANGES.get(field);
        if (!range) continue;
        const value = PCT_FIELDS.has(field) && raw > 0 && raw <= 1 ? raw * 100 : raw;
        if (value >= range[0] && value <= range[1]) {
          reported[field] = Math.round(value * 100) / 100;
          reportedCount++;
        }
      }
      const impedance = fields.get("impedance");
      out.weighIn({
        tsMs: ts,
        weightKg: weight,
        impedanceOhm:
          impedance !== undefined && impedance >= 50 && impedance <= 5000 ? impedance : null,
        reportedJson: reportedCount === 0 ? null : javaJson(reported),
      });
      const height = fields.get("height");
      if (height !== undefined && height >= 100 && height <= 250)
        out.profileFact("height", height, ts);
      const gender = fields.get("gender");
      if (gender !== undefined && (gender === 0 || gender === 1))
        out.profileFact("male", gender, ts);
      const age = fields.get("age");
      if (age !== undefined && age >= 10 && age <= 100) out.profileFact("age", age, ts);
      out.profileFact("weight", weight, ts);
    }
  }
}
