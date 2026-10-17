// MET-based kcal estimates for quick exercise entry. MET values are
// publication-grade averages (Ainsworth compendium, rounded); the estimate is
// a planning aid, never a measurement. kcal/min = MET x 3.5 x kg / 200.

import { getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { localizedLabels } from "./engine";

export const EXERCISE_TYPES = [
  { key: "jalan", met: 3.5 },
  { key: "jalan_cepat", met: 5.0 },
  { key: "lari", met: 9.8 },
  { key: "sepeda", met: 6.8 },
  { key: "sepeda_cepat", met: 10.0 },
  { key: "berenang", met: 8.3 },
  { key: "yoga", met: 2.5 },
  { key: "angkat_beban", met: 5.0 },
  { key: "futsal", met: 7.0 },
  { key: "badminton", met: 5.5 },
] as const;

export type ExerciseTypeKey = (typeof EXERCISE_TYPES)[number]["key"];

/** "Jalan santai" / "Easy walk". Pass `locale` on the server. */
export function exerciseTypeLabel(key: ExerciseTypeKey, locale: Locale = getActiveLocale()): string {
  return getT(locale, "olahraga")(`type.${key}`);
}

/** Lazy label table following the active language; server code uses exerciseTypeLabel(key, locale). */
export const EXERCISE_TYPE_LABELS = localizedLabels(
  EXERCISE_TYPES.map((type) => type.key),
  exerciseTypeLabel,
);

/** Strava activity types → our MET keys. Unmapped types use DEFAULT_MET. */
export const STRAVA_MET_MAP: Record<string, ExerciseTypeKey> = {
  Ride: "sepeda",
  VirtualRide: "sepeda",
  EBikeRide: "sepeda",
  Run: "lari",
  TrailRun: "lari",
  Treadmill: "lari",
  Swim: "berenang",
  Walk: "jalan_cepat",
  Hike: "jalan_cepat",
  WeightTraining: "angkat_beban",
  Yoga: "yoga",
  Soccer: "futsal",
  Badminton: "badminton",
};

export const DEFAULT_MET = 6.0;

export function metByKey(key: string): number {
  return EXERCISE_TYPES.find((t) => t.key === key)?.met ?? DEFAULT_MET;
}

export function metForStravaType(stravaType: string): number {
  const mapped = STRAVA_MET_MAP[stravaType];
  return mapped ? metByKey(mapped) : DEFAULT_MET;
}

export function estimateKcal(met: number, weightKg: number, durationMin: number): number {
  return Math.round((met * 3.5 * weightKg * durationMin) / 200);
}
