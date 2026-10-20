/**
 * Which context line the Beranda "Berat" row shows under the last weight. Platform-neutral: the caller passes what the day
 * summary has and turns the result into text (`when` is the YYYY-MM-DD the weight was logged, for relativeDayLabel).
 */
export type WeightSecondary =
  | { kind: "today"; when?: undefined }
  | { kind: "last"; when: string }
  | { kind: "lastUnknown"; when?: undefined }
  | { kind: "none"; when?: undefined };

export function weightSecondary(input: {
  /** The weight shown in the row (trend or last logged), null when the person never weighed in. */
  weightKg: number | null;
  /** Day the last weight on or before the viewed day was logged; null or undefined when the backend does not say. */
  latestWeightDate: string | null | undefined;
  /** Today in Jakarta, YYYY-MM-DD. */
  today: string;
  /** The weight was logged today (only meaningful when the viewed day is today). */
  loggedToday?: boolean;
}): WeightSecondary {
  if (input.weightKg === null) return { kind: "none" };
  const date = input.latestWeightDate ?? null;
  if (date === input.today || (date === null && input.loggedToday === true)) return { kind: "today" };
  if (date === null) return { kind: "lastUnknown" };
  return { kind: "last", when: date };
}
