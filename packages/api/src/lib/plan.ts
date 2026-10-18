import { and, asc, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { exerciseLog, foodLog, profile, weightLog } from "@joyorogo/db/schema/fitness";
import { workoutSession } from "@joyorogo/db/schema/plans";

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
  computeTargets,
  proteinTargetG,
  shiftDate,
  weightTrend,
} from "./engine";
import { isRapidLoss } from "./gain";
import { computeMaternalTargets, maternalFromRow, maternalNutrient } from "./maternal";
import type { MaternalState } from "./maternal";

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
          // Strava API policy 5.4: no combining Strava data with weight/food analytics (adaptive TDEE).
          ne(exerciseLog.source, "strava"),
        ),
      )
      .groupBy(exerciseLog.date),
  ] as const;
}

/**
 * One row when `date` was a training day, none otherwise: a legacy `workout_session` that day, or a
 * strength row JoyoFit mirrored (`source = 'joyofit'`, `type = 'angkat_beban'`). Manual quick entries
 * never count. Both halves use an index on (user_id, date) / the session user+date lookup; a single
 * UNION ALL keeps it one statement for `db.batch`.
 */
export function trainingDayQuery(db: Database, userId: string, date: string) {
  return db
    .select({ id: workoutSession.id })
    .from(workoutSession)
    .where(and(eq(workoutSession.userId, userId), eq(workoutSession.date, date)))
    .unionAll(
      db
        .select({ id: exerciseLog.id })
        .from(exerciseLog)
        .where(
          and(
            eq(exerciseLog.userId, userId),
            eq(exerciseLog.date, date),
            eq(exerciseLog.source, "joyofit"),
            eq(exerciseLog.type, "angkat_beban"),
          ),
        ),
    )
    .limit(1);
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
  /** Hamil / Menyusui state of the profile row; null for the normal plan */
  maternal: MaternalState | null;
};

/** The 3 numbers for `date`: BMR less the deficit (gain: plus the surplus), Hamil / Menyusui from AKG. */
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
    goal: row.goal,
  };
  const weightNowKg = history.latestWeightKg ?? row.startWeightKg;
  // Hamil / Menyusui: no deficit, no weight target, no measured-TDEE drift.
  const maternal = maternalFromRow(row);
  if (maternal.mode !== "none") {
    return {
      profileInput,
      latestWeightKg: history.latestWeightKg,
      weightNowKg,
      weighIns: history.weighIns,
      targets: computeMaternalTargets(profileInput, maternal, { today: date, weightNow: weightNowKg }),
      trend: null,
      maternal,
    };
  }
  // The base is the BMR less the deficit. The measured TDEE (adaptiveTdee) is not applied: it measures everything the
  // person burns outside logged workouts, which is the daily movement that now comes from real data (the watch's
  // all-day energy, lib/exercise-credit) and would be counted twice.
  const targets = computeTargets(profileInput, { weightNow: weightNowKg });
  const trend = weightTrend(history.weighIns, row.targetWeightKg, date);
  // A fast fall while the plan is to gain gets the see-a-doctor note (the one flag that needs the trend).
  if (targets.gain && isRapidLoss(trend?.weeklyRateKg ?? null, weightNowKg)) {
    targets.gain.flags.push("RAPID_LOSS");
  }
  return {
    profileInput,
    latestWeightKg: history.latestWeightKg,
    weightNowKg,
    weighIns: history.weighIns,
    targets,
    trend,
    maternal: null,
  };
}

/**
 * Daily protein goal of a plan: the AKG 2019 figure (with the stage's addition)
 * for Hamil / Menyusui, the ISSN / Iraki target while gaining, else the
 * weight-based cut target.
 */
export function proteinGoalG(
  plan: Pick<Plan, "targets" | "weightNowKg">,
  heightCm: number,
  trainingDay = false,
): number {
  return (
    maternalNutrient(plan.targets, "protein")?.target ??
    plan.targets.gain?.protein.targetG ??
    proteinTargetG(plan.weightNowKg, heightCm, trainingDay)
  );
}

/** Kg gained since a gain plan began (the stored baseline, else the onboarding weight); never negative. */
export function gainedKg(
  row: Pick<ProfileRow, "goalStartKg" | "startWeightKg">,
  weightNowKg: number,
): number {
  return Math.max(0, Math.round((weightNowKg - (row.goalStartKg ?? row.startWeightKg)) * 10) / 10);
}
