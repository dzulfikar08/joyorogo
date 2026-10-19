// What the coach chat knows about the person besides the phone's snapshot, read server side from the account:
// profile + today's targets, latest weight, food of today and the last 7 days, the cloud workouts and the plan
// document. Plain `(db, userId, today)` readers; no oRPC dependencies.

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { foodLog } from "@joyorogo/db/schema/fitness";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";

import { readCoachDoc } from "./coach-doc";
import type { CoachDoc } from "./coach-doc";
import { shiftDate } from "./engine";
import { maternalFromRow } from "./maternal";
import { readCalibrationPrefs } from "./calibration-store";
import { buildPlan, planQueries } from "./plan";

export interface CoachProfileContext {
  /** Age in years from the birth year; null when unknown. */
  age: number | null;
  gender: string;
  heightCm: number;
  weightKg: number | null;
  goal: "lose" | "maintain" | "gain";
  maternal: "none" | "pregnant" | "breastfeeding";
  eatKcal: number | null;
  tdee: number | null;
}

export interface CoachFoodContext {
  todayKcal: number;
  todayProtein: number;
  /** Average over the last 7 complete days that have any log; null when none. */
  avgKcal7: number | null;
  avgProtein7: number | null;
  loggedDays7: number;
}

export interface CoachWorkoutContext {
  start: number;
  sport: string;
  durationMin: number;
  distanceKm: number | null;
  avgHr: number | null;
}

export interface CoachServerContext {
  profile: CoachProfileContext | null;
  food: CoachFoodContext;
  workouts: CoachWorkoutContext[];
  doc: CoachDoc | null;
}

export async function readProfileContext(
  db: Database,
  userId: string,
  today: string,
  nowYear: number,
): Promise<CoachProfileContext | null> {
  const [[row], [latest], weighIns, intake, exercise, prefRows] = await db.batch(planQueries(db, userId, today));
  if (!row) return null;
  const plan = buildPlan(
    row,
    { latestWeightKg: latest?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(prefRows) },
    today,
  );
  const age = row.birthYear > 1900 ? nowYear - row.birthYear : null;
  return {
    age,
    gender: row.gender,
    heightCm: row.heightCm,
    weightKg: plan.weightNowKg,
    goal: row.goal,
    maternal: maternalFromRow(row).mode,
    eatKcal: Number.isFinite(plan.targets.eatKcal) ? Math.round(plan.targets.eatKcal) : null,
    tdee: Number.isFinite(plan.targets.tdee) ? Math.round(plan.targets.tdee) : null,
  };
}

export async function readFoodContext(db: Database, userId: string, today: string): Promise<CoachFoodContext> {
  const rows = await db
    .select({
      date: foodLog.date,
      kcal: sql<number>`coalesce(sum(${foodLog.kcal}), 0)`,
      protein: sql<number>`coalesce(sum(${foodLog.protein}), 0)`,
    })
    .from(foodLog)
    .where(and(eq(foodLog.userId, userId), gte(foodLog.date, shiftDate(today, -7)), lt(foodLog.date, shiftDate(today, 1))))
    .groupBy(foodLog.date);
  const todayRow = rows.find((r) => r.date === today);
  const past = rows.filter((r) => r.date !== today && r.kcal > 0);
  const avg = (pick: (r: (typeof past)[number]) => number) =>
    past.length === 0 ? null : Math.round(past.reduce((sum, r) => sum + pick(r), 0) / past.length);
  return {
    todayKcal: Math.round(todayRow?.kcal ?? 0),
    todayProtein: Math.round(todayRow?.protein ?? 0),
    avgKcal7: avg((r) => r.kcal),
    avgProtein7: avg((r) => r.protein),
    loggedDays7: past.length,
  };
}

/** The newest cloud workouts (not deleted), for when the phone's snapshot carries fewer. */
export async function readRecentWorkouts(db: Database, userId: string, limit: number): Promise<CoachWorkoutContext[]> {
  const rows = await db
    .select({
      start: watchWorkout.start,
      sport: watchWorkout.sportName,
      movingSec: watchWorkout.movingSec,
      distanceM: watchWorkout.distanceM,
      avgHr: watchWorkout.avgHr,
    })
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), isNull(watchWorkout.deletedAt)))
    .orderBy(desc(watchWorkout.start))
    .limit(limit);
  return rows.map((r) => ({
    start: r.start,
    sport: r.sport,
    durationMin: Math.round(r.movingSec / 60),
    distanceKm: r.distanceM === null ? null : Math.round(r.distanceM / 100) / 10,
    avgHr: r.avgHr,
  }));
}

export async function readCoachServerContext(
  db: Database,
  userId: string,
  today: string,
  nowYear: number,
  wantWorkouts: number,
): Promise<CoachServerContext> {
  const [profile, food, workouts, stored] = await Promise.all([
    readProfileContext(db, userId, today, nowYear),
    readFoodContext(db, userId, today),
    wantWorkouts > 0 ? readRecentWorkouts(db, userId, wantWorkouts) : Promise.resolve([]),
    readCoachDoc(db, userId),
  ]);
  return { profile, food, workouts, doc: stored.doc };
}
