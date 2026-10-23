import { daysBetween, shiftDate, streakFromDates } from "./engine";

/**
 * Logging streak and its lapse, one definition for Beranda's chip and the home-screen streak widget.
 *
 * The streak is the run of consecutive logged days ending today, or ending yesterday while today is not logged yet
 * (engine `streakFromDates`). A day is a 'YYYY-MM-DD' cut in the person's zone (`userZone`); the dates handed in are
 * the days that count (food and weigh-ins for a normal plan, days at 90% of the target for Naikin BB, never imports).
 *
 *   done     a day counts today: the flame is lit
 *   at_risk  yesterday counts, today does not yet: the streak survives until midnight
 *   broken   neither today nor yesterday counts: the run is over, `lapseDays` says how long
 *   none     nothing counted in the days we looked at (a new account, or a lapse longer than the window)
 */
export type StreakStatus = "done" | "at_risk" | "broken" | "none";

export interface StreakState {
  /** The live run: 0 once broken. Ends today when done, yesterday when at risk. */
  days: number;
  status: StreakStatus;
  /** Latest counted day on or before today; null when none was seen. */
  lastLoggedDate: string | null;
  /** Calendar days from the last counted day to today: 0 done, 1 at risk, 2 or more broken ("3 hari tanpa catat"). */
  lapseDays: number;
}

/** What the clients keep of a streak: the status follows from these two and the date it is read on. */
export interface StreakStamp {
  days: number;
  lastLoggedDate: string | null;
}

/** Days of history the summary reads for a streak; a run that reaches it is extended with older days (streak-store). */
export const STREAK_WINDOW_DAYS = 45;

/** Furthest back a streak is followed, so one request never reads years of rows. */
export const STREAK_MAX_DAYS = 1000;

/**
 * Status and lapse of a stamp on `today`. Pure, so a widget can age its stored snapshot on the phone's own date:
 * a lit flame turns "at risk" at midnight and "broken" a day later without waiting for the next refresh.
 */
export function streakAt(stamp: StreakStamp, today: string): StreakState {
  const { lastLoggedDate } = stamp;
  if (lastLoggedDate === null) return { days: 0, status: "none", lastLoggedDate, lapseDays: 0 };
  // A last day after today (the phone's clock behind the server's) reads as today.
  const lapseDays = Math.max(0, daysBetween(lastLoggedDate, today));
  if (lapseDays === 0) return { days: stamp.days, status: "done", lastLoggedDate, lapseDays };
  if (lapseDays === 1) return { days: stamp.days, status: "at_risk", lastLoggedDate, lapseDays };
  return { days: 0, status: "broken", lastLoggedDate, lapseDays };
}

/** Streak state from the counted days of a person, on `today` in their zone. */
export function streakState(dates: Iterable<string>, today: string): StreakState {
  const counted = [...dates].filter((date) => date <= today);
  let last: string | null = null;
  for (const date of counted) if (last === null || date > last) last = date;
  return streakAt({ days: streakFromDates(counted, today), lastLoggedDate: last }, today);
}

/** True when the live run reaches back to `windowStart`, so days before it may still belong to the run. */
export function runReachesWindow(state: StreakState, today: string, windowStart: string): boolean {
  if (state.days === 0) return false;
  const end = state.status === "done" ? today : shiftDate(today, -1);
  return shiftDate(end, -(state.days - 1)) <= windowStart;
}
