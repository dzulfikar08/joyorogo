import { and, eq, gte, lt, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { foodLog, weightLog } from "@joyorogo/db/schema/fitness";

import { shiftDate } from "./engine";
import { gainDayHit } from "./gain";
import { IMPORT_SOURCE } from "./history-import";
import { STREAK_MAX_DAYS, runReachesWindow, streakState } from "./streak";
import type { StreakState } from "./streak";

/**
 * The streak of a person from the days the summary already read, followed further back only when the run reaches the
 * start of that window (so a 124-day streak reads 124, not 46, and almost every request adds no query).
 *
 * `days` are the counted days in the window: food and weigh-in days for a normal plan, or the per-day intake of a
 * Naikin BB plan (`gainTargetKcal` set), where a day counts from 90% of the target.
 */
export async function loadStreak(
  db: Database,
  userId: string,
  today: string,
  windowStart: string,
  days: { food: Array<{ date: string; kcal: number }>; weight: Array<{ date: string }> },
  gainTargetKcal: number | null,
): Promise<StreakState> {
  const counted = (food: Array<{ date: string; kcal: number }>, weight: Array<{ date: string }>): string[] =>
    gainTargetKcal === null
      ? [...food.map((row) => row.date), ...weight.map((row) => row.date)]
      : food.filter((row) => gainDayHit(row.kcal, gainTargetKcal)).map((row) => row.date);

  const inWindow = counted(days.food, days.weight);
  const state = streakState(inWindow, today);
  if (!runReachesWindow(state, today, windowStart)) return state;

  // Imported history (source "huawei") never counts toward a streak.
  const floor = shiftDate(today, -STREAK_MAX_DAYS);
  const [food, weight] = await db.batch([
    db
      .select({ date: foodLog.date, kcal: sql<number>`sum(${foodLog.kcal})` })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, floor), lt(foodLog.date, windowStart), ne(foodLog.source, IMPORT_SOURCE)))
      .groupBy(foodLog.date),
    db
      .selectDistinct({ date: weightLog.date })
      .from(weightLog)
      .where(and(eq(weightLog.userId, userId), gte(weightLog.date, floor), lt(weightLog.date, windowStart), ne(weightLog.source, IMPORT_SOURCE))),
  ]);
  return streakState([...inWindow, ...counted(food, weight)], today);
}
