// MET-based kcal estimates for quick exercise entry. MET values are
// publication-grade averages (Ainsworth compendium, rounded); the estimate is
// a planning aid, never a measurement. kcal/min = MET x 3.5 x kg / 200.

export const EXERCISE_TYPES = [
  { key: "jalan", label: "Jalan santai", met: 3.5 },
  { key: "jalan_cepat", label: "Jalan cepat", met: 5.0 },
  { key: "lari", label: "Lari", met: 9.8 },
  { key: "sepeda", label: "Sepeda santai", met: 6.8 },
  { key: "sepeda_cepat", label: "Sepeda cepat", met: 10.0 },
  { key: "berenang", label: "Berenang", met: 8.3 },
  { key: "yoga", label: "Yoga", met: 2.5 },
  { key: "angkat_beban", label: "Angkat beban", met: 5.0 },
  { key: "futsal", label: "Futsal / sepak bola", met: 7.0 },
  { key: "badminton", label: "Badminton", met: 5.5 },
] as const;

export type ExerciseTypeKey = (typeof EXERCISE_TYPES)[number]["key"];

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
