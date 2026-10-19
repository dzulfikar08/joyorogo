import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { exerciseLog, foodLog, weightLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { gainStreak, jakartaToday, shiftDate } from "../lib/engine";
import { budgetKcal, exerciseCredit } from "../lib/exercise-credit";
import { addBackPrefQuery, creditDayQueries, dayReadings, readAddBackPrefs } from "../lib/exercise-credit-store";
import { readCalibrationPrefs } from "../lib/calibration-store";
import { buildPlan, planQueries, proteinGoalG } from "../lib/plan";
import { buildWeekRecap, weekStartOf } from "../lib/recap";
import { dateSchema } from "../lib/schemas";

/** Same look-back the Beranda streak uses. */
const STREAK_WINDOW_DAYS = 45;

export const statsRouter = {
  /**
   * Recap of the WIB week (Monday-Sunday) containing `weekStart`, default the
   * current week. Only days before today are judged, so a running week is
   * never scored on a half-logged today. Future weeks resolve to this week.
   */
  weekRecap: protectedProcedure
    .input(z.object({ weekStart: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const today = jakartaToday();
      const thisWeek = weekStartOf(today);
      const requested = weekStartOf(input.weekStart ?? today);
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
        foodDates,
        weightDates,
      ] = await context.db.batch([
          ...planQueries(context.db, userId, refDay),
          context.db
            .select({
              date: foodLog.date,
              kcal: sql<number>`sum(${foodLog.kcal})`,
              protein: sql<number | null>`sum(${foodLog.protein})`,
            })
            .from(foodLog)
            .where(
              and(
                eq(foodLog.userId, userId),
                gte(foodLog.date, weekStart),
                lte(foodLog.date, weekEnd),
              ),
            )
            .groupBy(foodLog.date),
          context.db
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
              ),
            )
            .groupBy(exerciseLog.date),
          // One row per logged day with its kcal: the normal streak reads the dates, a gain plan the totals.
          context.db
            .select({ date: foodLog.date, kcal: sql<number>`sum(${foodLog.kcal})` })
            .from(foodLog)
            .where(
              and(
                eq(foodLog.userId, userId),
                gte(foodLog.date, shiftDate(refDay, -STREAK_WINDOW_DAYS)),
                lte(foodLog.date, refDay),
              ),
            )
            .groupBy(foodLog.date),
          context.db
            .selectDistinct({ date: weightLog.date })
            .from(weightLog)
            .where(
              and(
                eq(weightLog.userId, userId),
                gte(weightLog.date, shiftDate(refDay, -STREAK_WINDOW_DAYS)),
                lte(weightLog.date, refDay),
              ),
            ),
        ]);

      const prof = profileRows[0];
      if (!prof) return null;
      const plan = buildPlan(
        prof,
        { latestWeightKg: latestRows[0]?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(calibrationRows) },
        refDay,
      );

      // Each judged day gets the budget Beranda showed for it: the base plus that day's counted activity above the factor.
      const judgedDates = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i)).filter((date) => date < today);
      const [prefRows, ...dayRows] = await context.db.batch([
        addBackPrefQuery(context.db, userId),
        ...judgedDates.flatMap((date) => creditDayQueries(context.db, userId, date)),
      ] as unknown as Parameters<typeof context.db.batch>[0]) as unknown as [
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
          rows,
          readings: dayReadings(activity[0], score[0]),
          steps: activity[0]?.steps ?? null,
          includedKcal: plan.targets.includedKcal,
        });
        dayTargets[date] = budgetKcal(plan.targets.eatKcal, credit);
      });

      const streakRef = weekEnd < today ? weekEnd : today;
      return buildWeekRecap({
        weekStart,
        today,
        targetKcal: plan.targets.eatKcal,
        proteinTargetG: proteinGoalG(plan, prof.heightCm),
        dayTargets,
        food: foodRows,
        exercise: exerciseRows.map((row) => ({ ...row, minutes: row.minutes ?? 0 })),
        trendPoints: plan.trend?.points ?? [],
        // No streak pressure in Hamil / Menyusui.
        loggedDates: plan.maternal ? [] : [...foodDates, ...weightDates].map((row) => row.date),
        // Naikin BB: days at 90% or more of the target, not days with any log.
        gain: plan.targets.gain
          ? { streakDays: gainStreak(foodDates, plan.targets.eatKcal, streakRef) }
          : undefined,
      });
    }),
};
