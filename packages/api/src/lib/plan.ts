import { and, asc, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { exerciseLog, foodLog, profile, weightLog } from "@joyorogo/db/schema/fitness";

import type {
  ActivityLevel,
  DayKcal,
  Gender,
  ProfileInput,
  Targets,
  WeighIn,
  WeightTrend,
} from "./engine";
import {
  ADAPTIVE_WINDOW_DAYS,
  adaptiveTdee,
  computeTargets,
  shiftDate,
  weightTrend,
} from "./engine";

/** Weigh-in history for trend warm-up; the EMA forgets ~99% of a reading in 45 days. */
const TREND_HISTORY_DAYS = 60;

/**
 * Queries the plan needs for `date`, shaped for `db.batch` so callers fold
 * them into their own single round trip: profile, latest weigh-in ever,
 * 60 days of weigh-ins, and 28 complete days of intake + exercise totals.
 */
export function planQueries(db: Database, userId: string, date: string) {
  const windowStart = shiftDate(date, -ADAPTIVE_WINDOW_DAYS);
  return [
    db.select().from(profile).where(eq(profile.userId, userId)).limit(1),
    db
      .select({ weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(and(eq(weightLog.userId, userId), lte(weightLog.date, date)))
      .orderBy(desc(weightLog.date))
      .limit(1),
    db
      .select({ date: weightLog.date, weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(
        and(
          eq(weightLog.userId, userId),
          gte(weightLog.date, shiftDate(date, -TREND_HISTORY_DAYS)),
          lte(weightLog.date, date),
        ),
      )
      .orderBy(asc(weightLog.date)),
    db
      .select({ date: foodLog.date, kcal: sql<number>`sum(${foodLog.kcal})` })
      .from(foodLog)
      .where(
        and(eq(foodLog.userId, userId), gte(foodLog.date, windowStart), lt(foodLog.date, date)),
      )
      .groupBy(foodLog.date),
    db
      .select({ date: exerciseLog.date, kcal: sql<number>`sum(${exerciseLog.kcal})` })
      .from(exerciseLog)
      .where(
        and(
          eq(exerciseLog.userId, userId),
          gte(exerciseLog.date, windowStart),
          lt(exerciseLog.date, date),
          ne(exerciseLog.source, "rest"),
        ),
      )
      .groupBy(exerciseLog.date),
  ] as const;
}

export type ProfileRow = typeof profile.$inferSelect;

export type Plan = {
  profileInput: ProfileInput;
  /** most recent weigh-in on/before the date; null when never weighed */
  latestWeightKg: number | null;
  /** weight the targets use: latest weigh-in, else the onboarding weight */
  weightNowKg: number;
  weighIns: WeighIn[];
  targets: Targets;
  trend: WeightTrend | null;
};

/** The 3 numbers for `date`: formula first, then measured TDEE when the data supports it. */
export function buildPlan(
  row: ProfileRow,
  history: {
    latestWeightKg: number | null;
    weighIns: WeighIn[];
    intake: DayKcal[];
    exercise: DayKcal[];
  },
  date: string,
): Plan {
  const profileInput: ProfileInput = {
    birthYear: row.birthYear,
    gender: row.gender as Gender,
    heightCm: row.heightCm,
    weightKg: row.startWeightKg,
    targetWeightKg: row.targetWeightKg,
    targetDate: row.targetDate,
    activityLevel: row.activityLevel as ActivityLevel,
  };
  const weightNowKg = history.latestWeightKg ?? row.startWeightKg;
  const formula = computeTargets(profileInput, { weightNow: weightNowKg });
  const measured = adaptiveTdee({
    date,
    weighIns: history.weighIns,
    intake: history.intake,
    exercise: history.exercise,
    // A day logged under half the budget is a forgotten day, not a fast.
    minDayKcal: formula.eatKcal * 0.5,
  });
  return {
    profileInput,
    latestWeightKg: history.latestWeightKg,
    weightNowKg,
    weighIns: history.weighIns,
    targets:
      measured === null
        ? formula
        : computeTargets(profileInput, { weightNow: weightNowKg, adaptiveTdee: measured }),
    trend: weightTrend(history.weighIns, row.targetWeightKg, date),
  };
}
