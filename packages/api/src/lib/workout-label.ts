import type { Locale } from "@joyorogo/i18n";

import { exerciseTypeLabel } from "./met";
import type { ExerciseTypeKey } from "./met";

/** Diary workout type (the Strava-style vocabulary) → the exercise label an imported activity without a title of its own is named after. */
export const WORKOUT_LABEL_KEYS: Readonly<Record<string, ExerciseTypeKey>> = {
  Run: "lari",
  TrailRun: "lari",
  Treadmill: "lari",
  Ride: "sepeda",
  VirtualRide: "sepeda",
  EBikeRide: "sepeda",
  Swim: "berenang",
  Walk: "jalan_cepat",
  Hike: "jalan_cepat",
  WeightTraining: "angkat_beban",
  Yoga: "yoga",
  Badminton: "badminton",
  Soccer: "futsal",
};

/** "Lari" / "Jalan cepat" for a type the diary has a label for, else null. */
export function workoutTypeLabel(locale: Locale, type: string): string | null {
  const key = WORKOUT_LABEL_KEYS[type];
  return key ? exerciseTypeLabel(key, locale) : null;
}
