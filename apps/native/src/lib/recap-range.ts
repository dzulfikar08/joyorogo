import type { WeekRecap } from "@joyorogo/api/lib/recap";

/** The week counts the recap screen offers; a window is that many whole weeks (Monday to Sunday), the last one ending the window. */
export const RECAP_WEEKS = { w1: 1, w4: 4, w13: 13 } as const;
export type RecapRangeKey = keyof typeof RECAP_WEEKS;

/** The Mondays of the `weeks` weeks that end with the week starting `endWeek`, oldest first. */
export function weekStartsOf(
  endWeek: string,
  weeks: number,
  shift: (date: string, days: number) => string,
): string[] {
  return Array.from({ length: weeks }, (_, i) => shift(endWeek, -7 * (weeks - 1 - i)));
}

/** Several weekly recaps read as one period. Every figure comes from the weeks' own days: nothing is re-judged here. */
export type PeriodRecap = {
  days: WeekRecap["days"];
  /** Days judged so far (every day before today). */
  evaluatedDays: number;
  /** Judged days with a food log. */
  loggedDays: number;
  daysOnTarget: number;
  /** Mean eaten kcal of the logged days; null when nothing was logged. */
  avgKcal: number | null;
  /** Mean budget of the logged days (each day was judged against its own); the base target when nothing was logged. */
  targetKcal: number;
  exercise: { kcal: number; minutes: number; sessions: number };
  /** First week's start to last week's end of the smoothed weight; null without two readings. */
  weight: { startKg: number; endKg: number; changeKg: number } | null;
  gain: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function combineRecaps(recaps: readonly WeekRecap[]): PeriodRecap {
  const days = recaps.flatMap((recap) => recap.days);
  const judged = days.filter((day) => day.status !== "pending");
  const logged = judged.filter((day) => day.status !== "empty");
  const last = recaps.at(-1);
  const weights = recaps.flatMap((recap) => (recap.weight ? [recap.weight] : []));
  const first = weights[0];
  const end = weights.at(-1);
  return {
    days,
    evaluatedDays: judged.length,
    loggedDays: logged.length,
    daysOnTarget: judged.filter((day) => day.status === "on_target").length,
    avgKcal:
      logged.length > 0
        ? Math.round(logged.reduce((sum, day) => sum + day.eatenKcal, 0) / logged.length)
        : null,
    targetKcal:
      logged.length > 0
        ? Math.round(logged.reduce((sum, day) => sum + day.targetKcal, 0) / logged.length)
        : (last?.targetKcal ?? 0),
    exercise: {
      kcal: recaps.reduce((sum, recap) => sum + recap.exercise.kcal, 0),
      minutes: recaps.reduce((sum, recap) => sum + recap.exercise.minutes, 0),
      sessions: recaps.reduce((sum, recap) => sum + recap.exercise.sessions, 0),
    },
    weight:
      first && end
        ? { startKg: first.startKg, endKg: end.endKg, changeKg: round1(end.endKg - first.startKg) }
        : null,
    gain: last?.gain ?? false,
  };
}
