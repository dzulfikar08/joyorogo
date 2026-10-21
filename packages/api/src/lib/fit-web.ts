// Read views of the JoyoFit web app (apps/fit): a person's own recovery days and cloud workouts over a calendar
// window, as plain JSON for dashboards and tables. The recovery days come from the same reader the MCP connector and the
// coach use (fit-data.ts getRecoveryDays), so a night never reads differently on the web than in the AI apps.
//
// Same conventions as fit-data.ts: days are calendar days in the person's day zone 'YYYY-MM-DD'; units sit in the key name.
// No auth and no paywall here: the router (routers/fit-web.ts) decides who may read.

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";
import { dayOfMs } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

import { getRecoveryDays } from "./fit-data";
import type { RecoveryDayView } from "./fit-data";
import { dayBounds } from "./tiers";

export const FIT_WEB_LIMITS = {
  /** One window may span a year (and a leap day); the dashboards compare a window with the one before it in a second call. */
  days: 366,
  /** A list returns at most this many workouts; `truncated` says there were more (oldest ones are cut). */
  workouts: 2000,
} as const;


export interface FitWebWorkout {
  /** Unix seconds the workout started: the id of the cloud workout (`watchWorkout.detail`). */
  start: number;
  /** Calendar day the workout started on, in the person's day zone. */
  date: string;
  sportName: string;
  /** run, walk, ride, swim or other. */
  sportKind: string;
  elapsedSec: number;
  movingSec: number;
  distanceM: number | null;
  elevGainM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  calories: number;
  hasGps: boolean;
  hasAnalysis: boolean;
  /** From a Huawei export or a FIT file instead of the watch. */
  imported: boolean;
}

export interface FitWebWorkoutList {
  from: string;
  to: string;
  /** Newest first. */
  items: FitWebWorkout[];
  truncated: boolean;
}

export interface FitWebRecovery {
  from: string;
  to: string;
  /** One row per day with any sleep, score or activity number, oldest first (charts read left to right). */
  days: RecoveryDayView[];
}

export async function getFitWebRecovery(
  db: Database,
  userId: string,
  from: string,
  to: string,
): Promise<FitWebRecovery> {
  const days = await getRecoveryDays(db, userId, from, to);
  return { from, to, days: days.toReversed() };
}

export async function getFitWebWorkouts(
  db: Database,
  userId: string,
  from: string,
  to: string,
  zone: DayZone,
): Promise<FitWebWorkoutList> {
  const startSec = Math.floor(dayBounds(from, zone).startMs / 1000);
  const endSec = Math.floor(dayBounds(to, zone).endMs / 1000);
  const rows = await db
    .select({
      start: watchWorkout.start,
      sportName: watchWorkout.sportName,
      sportKind: watchWorkout.sportKind,
      elapsedSec: watchWorkout.elapsedSec,
      movingSec: watchWorkout.movingSec,
      distanceM: watchWorkout.distanceM,
      elevGainM: watchWorkout.elevGainM,
      avgHr: watchWorkout.avgHr,
      maxHr: watchWorkout.maxHr,
      calories: watchWorkout.calories,
      hasGps: watchWorkout.hasGps,
      hasAnalysis: watchWorkout.hasAnalysis,
      imported: watchWorkout.imported,
    })
    .from(watchWorkout)
    .where(
      and(
        eq(watchWorkout.userId, userId),
        isNull(watchWorkout.deletedAt),
        gte(watchWorkout.start, startSec),
        sql`${watchWorkout.start} < ${endSec}`,
      ),
    )
    .orderBy(desc(watchWorkout.start))
    .limit(FIT_WEB_LIMITS.workouts + 1);
  const page = rows.slice(0, FIT_WEB_LIMITS.workouts);
  return {
    from,
    to,
    truncated: rows.length > FIT_WEB_LIMITS.workouts,
    items: page.map((row) => ({
      start: row.start,
      date: dayOfMs(row.start * 1000, zone),
      sportName: row.sportName,
      sportKind: row.sportKind,
      elapsedSec: row.elapsedSec,
      movingSec: row.movingSec,
      distanceM: row.distanceM,
      elevGainM: row.elevGainM,
      avgHr: row.avgHr,
      maxHr: row.maxHr,
      calories: row.calories,
      hasGps: row.hasGps,
      hasAnalysis: row.hasAnalysis,
      imported: row.imported,
    })),
  };
}
