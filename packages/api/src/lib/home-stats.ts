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
  /** Today in the user's day zone, YYYY-MM-DD. */
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

/**
 * Change of the smoothed trend weight over the last `windowDays` of the chart points (oldest first, YYYY-MM-DD dates):
 * latest minus the point closest to `windowDays` before it, so the header can say "−0,4 kg / 7 hari". `days` is the span
 * actually covered (shorter than the window when the history is). Null with fewer than two points or no span.
 */
export function trendChange(
  points: ReadonlyArray<{ date: string; trendKg: number }>,
  windowDays = 7,
): { deltaKg: number; days: number } | null {
  const last = points.at(-1);
  if (!last || points.length < 2) return null;
  const lastMs = Date.parse(`${last.date}T00:00:00Z`);
  const dayMs = 86_400_000;
  let base: { date: string; trendKg: number } | null = null;
  let baseDays = 0;
  for (const p of points.slice(0, -1)) {
    const days = Math.round((lastMs - Date.parse(`${p.date}T00:00:00Z`)) / dayMs);
    if (days < 1 || days > windowDays) continue;
    if (base === null || days > baseDays) {
      base = p;
      baseDays = days;
    }
  }
  if (base === null) {
    base = points[points.length - 2]!;
    baseDays = Math.max(1, Math.round((lastMs - Date.parse(`${base.date}T00:00:00Z`)) / dayMs));
  }
  return { deltaKg: last.trendKg - base.trendKg, days: baseDays };
}
