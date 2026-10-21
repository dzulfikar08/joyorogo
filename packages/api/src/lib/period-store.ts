// Reads the rows a "Progres" period is built from (stats.periodProgress) and hands them to lib/period-progress.

import { and, asc, desc, eq, gte, lte, min, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dailyActivity, exerciseLog, foodLog, weightLog } from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";

import { gainStreak, jakartaToday, shiftDate, streakFromDates } from "./engine";
import { readCalibrationPrefs } from "./calibration-store";
import { exerciseCredit } from "./exercise-credit";
import { addBackPrefQuery, dayReadings, readAddBackPrefs } from "./exercise-credit-store";
import { buildPlan, planQueries } from "./plan";
import { buildPeriodProgress } from "./period-progress";
import type { PeriodProgress } from "./period-progress";

/** The API's calendar cap on a period, and the weigh-in history the Berat screen reads. */
export const PERIOD_MAX_DAYS = 400;
const WEIGH_IN_HISTORY = 365;
/** Same look-back the Beranda streak uses. */
const STREAK_WINDOW_DAYS = 45;

/**
 * Progress over [from, to] (WIB days; `to` defaults to today and never passes it, `from` defaults to the first weigh-in
 * or food log, at most PERIOD_MAX_DAYS back). Null without a profile and for Hamil / Menyusui, who have no weight or
 * deficit framing.
 *
 * Burn per day is the plan's TDEE (calibrated when the calibration is on) plus that day's counted activity above the
 * activity factor (lib/exercise-credit), the same figures Beranda's Sisa is built on. The plan's TDEE is today's: past
 * days use it too, which is why the card calls the deficit an estimate.
 */
export async function loadPeriodProgress(
  db: Database,
  userId: string,
  requested: { from?: string; to?: string },
): Promise<PeriodProgress | null> {
  const today = jakartaToday();
  const to = requested.to !== undefined && requested.to < today ? requested.to : today;

  const [profileRows, latestRows, planWeighIns, planIntake, planExercise, calibrationRows, historyRows, firstFoodRows] =
    await db.batch([
      ...planQueries(db, userId, to),
      db
        .select({ date: weightLog.date, weightKg: weightLog.weightKg })
        .from(weightLog)
        .where(and(eq(weightLog.userId, userId), lte(weightLog.date, to)))
        .orderBy(desc(weightLog.date))
        .limit(WEIGH_IN_HISTORY),
      db.select({ date: min(foodLog.date) }).from(foodLog).where(eq(foodLog.userId, userId)),
    ]);
  const prof = profileRows[0];
  if (!prof || prof.maternalMode !== "none") return null;

  const weighIns = historyRows.toReversed();
  const earliest = [weighIns[0]?.date, firstFoodRows[0]?.date].filter((d): d is string => !!d).toSorted()[0] ?? to;
  const floor = shiftDate(to, -(PERIOD_MAX_DAYS - 1));
  const wanted = requested.from ?? earliest;
  const from = wanted > floor ? wanted : floor;
  if (from > to) return null;

  const plan = buildPlan(
    prof,
    {
      latestWeightKg: latestRows[0]?.weightKg ?? null,
      weighIns: planWeighIns,
      intake: planIntake,
      exercise: planExercise,
      prefs: readCalibrationPrefs(calibrationRows),
    },
    to,
  );

  const streakStart = shiftDate(today, -STREAK_WINDOW_DAYS);
  const [foodRows, exerciseRows, activityRows, scoreRows, prefRows, foodDates, weightDates] = await db.batch([
    db
      .select({ date: foodLog.date, kcal: sql<number>`sum(${foodLog.kcal})` })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, from), lte(foodLog.date, to)))
      .groupBy(foodLog.date)
      .orderBy(asc(foodLog.date)),
    db
      .select({ date: exerciseLog.date, kcal: exerciseLog.kcal, source: exerciseLog.source, externalId: exerciseLog.externalId })
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, userId), gte(exerciseLog.date, from), lte(exerciseLog.date, to))),
    db
      .select({
        date: dailyActivity.date,
        steps: dailyActivity.steps,
        activeCalories: dailyActivity.activeCalories,
        source: dailyActivity.source,
      })
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, userId), gte(dailyActivity.date, from), lte(dailyActivity.date, to))),
    db
      .select({ date: fitnessScore.date, activeKcal: fitnessScore.activeKcal })
      .from(fitnessScore)
      .where(and(eq(fitnessScore.userId, userId), gte(fitnessScore.date, from), lte(fitnessScore.date, to))),
    addBackPrefQuery(db, userId),
    db
      .select({ date: foodLog.date, kcal: sql<number>`sum(${foodLog.kcal})` })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, streakStart)))
      .groupBy(foodLog.date),
    db
      .selectDistinct({ date: weightLog.date })
      .from(weightLog)
      .where(and(eq(weightLog.userId, userId), gte(weightLog.date, streakStart))),
  ]);

  const { settings } = readAddBackPrefs(prefRows);
  const rowsByDate = new Map<string, typeof exerciseRows>();
  for (const row of exerciseRows) rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row]);
  const activityByDate = new Map(activityRows.map((row) => [row.date, row]));
  const scoreByDate = new Map(scoreRows.map((row) => [row.date, row]));
  // Only days with food enter the deficit, so only those need a burn estimate.
  const burn: Record<string, number> = {};
  for (const { date } of foodRows) {
    const activity = activityByDate.get(date);
    const credit = exerciseCredit({
      settings,
      rows: rowsByDate.get(date) ?? [],
      readings: dayReadings(activity, scoreByDate.get(date)),
      steps: activity?.steps ?? null,
      includedKcal: plan.targets.includedKcal,
    });
    burn[date] = plan.targets.tdee + credit.countedKcal;
  }

  const gain = plan.targets.gain !== null;
  const streakDays = gain
    ? gainStreak(foodDates, plan.targets.eatKcal, today)
    : streakFromDates([...foodDates.map((r) => r.date), ...weightDates.map((r) => r.date)], today);
  return buildPeriodProgress({
    from,
    to,
    today,
    weighIns,
    food: foodRows,
    burn,
    targetKcal: plan.targets.eatKcal,
    goalKg: prof.targetWeightKg,
    streakDays,
    gain,
  });
}
