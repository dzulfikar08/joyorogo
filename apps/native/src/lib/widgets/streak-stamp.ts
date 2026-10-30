import type { StreakStamp } from "@joyorogo/api/lib/streak";

/**
 * The streak as the widgets keep it: the server's stamp plus the last logged day *before* the one it names.
 *
 * The day summary only carries the latest logged day, but the widget greets a comeback (first log after a week or more
 * away) differently from an ordinary day one, so the app remembers what the stamp said before each update: when the last
 * logged day moves forward, the day it moved from is the log before it. Null when the app never saw an earlier log
 * (a fresh install, a new account): no comeback greeting, the plain day-one cheer.
 */
export interface WidgetStreakStamp extends StreakStamp {
  previousLoggedDate?: string | null;
}

/** `next` (what the summary just said) with the log before its last day, read from the stamp it replaces. */
export function withPreviousLog(next: WidgetStreakStamp, before: WidgetStreakStamp | null | undefined): WidgetStreakStamp {
  const { days, lastLoggedDate } = next;
  const last = before?.lastLoggedDate ?? null;
  if (lastLoggedDate === null || last === null) return { days, lastLoggedDate, previousLoggedDate: null };
  if (last === lastLoggedDate) return { days, lastLoggedDate, previousLoggedDate: before?.previousLoggedDate ?? null };
  return { days, lastLoggedDate, previousLoggedDate: last < lastLoggedDate ? last : null };
}
