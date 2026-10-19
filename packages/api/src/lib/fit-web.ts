// Read views of the JoyoFit web app (apps/fit): a person's own recovery days and cloud workouts over a calendar
// window, as plain JSON for dashboards and tables. The recovery days come from the same reader the MCP connector and the
// coach use (fit-data.ts getRecoveryDays), so a night never reads differently on the web than in the AI apps.
//
// Same conventions as fit-data.ts: days are WIB calendar days 'YYYY-MM-DD'; units sit in the key name.
// No auth and no paywall here: the router (routers/fit-web.ts) decides who may read.

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";

import { getRecoveryDays } from "./fit-data";
import type { RecoveryDayView } from "./fit-data";
import { wibDayBounds } from "./tiers";

export const FIT_WEB_LIMITS = {
  /** One window may span a year (and a leap day); the dashboards compare a window with the one before it in a second call. */
  days: 366,
  /** A list returns at most this many workouts; `truncated` says there were more (oldest ones are cut). */
  workouts: 2000,
} as const;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface FitWebWorkout {
  /** Unix seconds the workout started: the id of the cloud workout (`watchWorkout.detail`). */
  start: number;
  /** WIB calendar day the workout started on. */
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
): Promise<FitWebWorkoutList> {
  const startSec = Math.floor(wibDayBounds(from).startMs / 1000);
  const endSec = Math.floor(wibDayBounds(to).endMs / 1000);
  const rows = await db
    .select()
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
      date: new Date(row.start * 1000 + WIB_OFFSET_MS).toISOString().slice(0, 10),
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
