// Reads the rows a weekly recap is built from (stats.weekRecap) and the week's plan. Shared by the recap screen and the
// weekly reflection (lib/recap-reflection.ts), so both judge the same days against the same budgets.

import { and, eq, gte, lte, ne, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { exerciseLog, foodLog } from "@joyorogo/db/schema/fitness";
import type { DayZone } from "@joyorogo/i18n";

import { jakartaToday, shiftDate } from "./engine";
import { budgetKcal, exerciseCredit } from "./exercise-credit";
import { readCalibrationPrefs } from "./calibration-store";
import {
  addBackPrefQuery,
  creditDayQueries,
  dayReadings,
  readAddBackPrefs,
} from "./exercise-credit-store";
import { buildPlan, planQueries, proteinGoalG } from "./plan";
import type { Plan, ProfileRow } from "./plan";
import { buildWeekRecap, weekStartOf } from "./recap";
import type { WeekRecap } from "./recap";
import { loadUserStreak } from "./streak-store";

export interface LoadedWeekRecap {
  recap: WeekRecap;
  plan: Plan;
  prof: ProfileRow;
  today: string;
}

/**
 * Recap of the week (Monday-Sunday, in the person's zone) containing `requestedWeek`, default the current week. Only days before today
 * are judged, so a running week is never scored on a half-logged today. Future weeks resolve to this week. Null
 * without a profile.
 *
 * `excludeStrava` leaves Strava rows out of each day's budget (they stay in the screen's recap): Strava's API terms keep
 * its data out of AI, so the reflection never builds on a number a Strava activity moved.
 */
export async function loadWeekRecap(
  db: Database,
  userId: string,
  requestedWeek: string | undefined,
  zone: DayZone,
  opts: { excludeStrava?: boolean } = {},
): Promise<LoadedWeekRecap | null> {
  const today = jakartaToday(undefined, zone);
  const thisWeek = weekStartOf(today);
  const requested = weekStartOf(requestedWeek ?? today);
  const weekStart = requested > thisWeek ? thisWeek : requested;
  const weekEnd = shiftDate(weekStart, 6);
  const refDay = weekEnd < today ? weekEnd : today;

  const [
    profileRows,
    latestRows,
    weighIns,
    intake,
    exercise,
    calibrationRows,
    foodRows,
    exerciseRows,
  ] = await db.batch([
    ...planQueries(db, userId, refDay),
    db
      .select({
        date: foodLog.date,
        kcal: sql<number>`sum(${foodLog.kcal})`,
        protein: sql<number | null>`sum(${foodLog.protein})`,
      })
      .from(foodLog)
      .where(
        and(eq(foodLog.userId, userId), gte(foodLog.date, weekStart), lte(foodLog.date, weekEnd)),
      )
      .groupBy(foodLog.date),
    db
      .select({
        date: exerciseLog.date,
        kcal: sql<number>`sum(${exerciseLog.kcal})`,
        minutes: sql<number | null>`sum(${exerciseLog.durationMin})`,
        sessions: sql<number>`count(*)`,
      })
      .from(exerciseLog)
      .where(
        and(
          eq(exerciseLog.userId, userId),
          gte(exerciseLog.date, weekStart),
          lte(exerciseLog.date, weekEnd),
          ne(exerciseLog.source, "rest"),
          ...(opts.excludeStrava ? [ne(exerciseLog.source, "strava")] : []),
        ),
      )
      .groupBy(exerciseLog.date),
  ]);

  const prof = profileRows[0];
  if (!prof) return null;
  const plan = buildPlan(
    prof,
    {
      latestWeightKg: latestRows[0]?.weightKg ?? null,
      weighIns,
      intake,
      exercise,
      prefs: readCalibrationPrefs(calibrationRows),
    },
    refDay,
  );

  // Each judged day gets the budget Beranda showed for it: the base plus that day's counted activity above the factor.
  const judgedDates = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i)).filter(
    (date) => date < today,
  );
  const [prefRows, ...dayRows] = (await db.batch([
    addBackPrefQuery(db, userId),
    ...judgedDates.flatMap((date) => creditDayQueries(db, userId, date)),
  ] as unknown as Parameters<typeof db.batch>[0])) as unknown as [
    Parameters<typeof readAddBackPrefs>[0],
    ...unknown[],
  ];
  const settings = readAddBackPrefs(prefRows).settings;
  const dayTargets: Record<string, number> = {};
  judgedDates.forEach((date, i) => {
    const [rows, activity, score] = dayRows.slice(i * 3, i * 3 + 3) as [
      { kcal: number; source: string; externalId: string | null }[],
      { steps: number | null; activeCalories: number; source: string }[],
      { activeKcal: number | null }[],
    ];
    const credit = exerciseCredit({
      settings,
      rows: opts.excludeStrava ? rows.filter((row) => row.source !== "strava") : rows,
      readings: dayReadings(activity[0], score[0]),
      steps: activity[0]?.steps ?? null,
      includedKcal: plan.targets.includedKcal,
    });
    dayTargets[date] = budgetKcal(plan.targets.eatKcal, credit);
  });

  const recap = buildWeekRecap({
    weekStart,
    today,
    targetKcal: plan.targets.eatKcal,
    proteinTargetG: proteinGoalG(plan, prof.heightCm),
    dayTargets,
    food: foodRows,
    exercise: exerciseRows.map((row) => ({ ...row, minutes: row.minutes ?? 0 })),
    trendPoints: plan.trend?.points ?? [],
    // No streak pressure in Hamil / Menyusui; Naikin BB counts days at 90% or more of the target (lib/streak-store).
    streakDays: plan.maternal
      ? 0
      : (await loadUserStreak(db, userId, refDay, plan.targets.gain ? plan.targets.eatKcal : null))
          .days,
    gain: plan.targets.gain ? true : undefined,
  });
  return { recap, plan, prof, today };
}
