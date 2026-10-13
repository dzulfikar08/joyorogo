import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import {
  dailyActivity,
  exerciseLog,
  foodLog,
  sleepLog,
  weightLog,
} from "@joyorogo/db/schema/fitness";
import { workoutSession } from "@joyorogo/db/schema/plans";

import type { Meal } from "../lib/engine";

import { protectedProcedure } from "../index";
import {
  computeBurn,
  computeDeficit,
  effectiveRamadan,
  jakartaToday,
  proteinTargetG,
  shiftDate,
  streakFromDates,
  suggestMealNow,
} from "../lib/engine";
import { dateSchema } from "../lib/schemas";
import { loadIdeaValues } from "./plate";
import { mealIdeas } from "../lib/ideas";
import { buildPlan, planQueries } from "../lib/plan";

const ZERO_MEALS: Record<Meal, number> = {
  sarapan: 0,
  makan_siang: 0,
  makan_malam: 0,
  snack: 0,
  sahur: 0,
  berbuka: 0,
};

// Server-defined recap chips — the share card and home screen render these as-is.
function buildMilestones(streakDays: number, weightLostKg: number): string[] {
  return [
    ...(streakDays >= 30 ? ["Streak 30 hari"] : []),
    ...(streakDays >= 7 ? ["Streak 7 hari"] : []),
    ...(weightLostKg >= 10 ? ["Turun 10 kg"] : []),
    ...(weightLostKg >= 5 ? ["Turun 5 kg"] : []),
    ...(weightLostKg >= 2 ? ["Turun 2 kg"] : []),
  ];
}

export const dayRouter = {
  summary: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const today = jakartaToday();
      const date = input.date ?? today;
      const weekStart = shiftDate(today, -6);
      const streakStart = shiftDate(today, -45);

      const [
        profileRows,
        latestRows,
        weighIns,
        intake,
        exercise,
        eatenRows,
        exerciseRows,
        sleptRows,
        loggedRows,
        eatenWeek,
        burnedWeek,
        foodDates,
        weightDates,
        activityRows,
        workoutRows,
      ] = await context.db.batch([
        ...planQueries(context.db, userId, date),
        context.db
          .select({
            meal: foodLog.meal,
            kcal: sql<number | null>`sum(${foodLog.kcal})`,
            protein: sql<number | null>`sum(${foodLog.protein})`,
          })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), eq(foodLog.date, date)))
          .groupBy(foodLog.meal),
        context.db
          .select({ kcal: exerciseLog.kcal, source: exerciseLog.source })
          .from(exerciseLog)
          .where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.date, date))),
        context.db
          .select({ hours: sleepLog.hours })
          .from(sleepLog)
          .where(and(eq(sleepLog.userId, userId), eq(sleepLog.date, shiftDate(date, -1))))
          .limit(1),
        context.db
          .select({ logged: sql<number>`count(*)` })
          .from(weightLog)
          .where(and(eq(weightLog.userId, userId), eq(weightLog.date, today))),
        context.db
          .select({
            kcal: sql<number | null>`sum(${foodLog.kcal})`,
            meals: sql<number>`count(*)`,
            protein: sql<number | null>`sum(${foodLog.protein})`,
            carbs: sql<number | null>`sum(${foodLog.carbs})`,
            fat: sql<number | null>`sum(${foodLog.fat})`,
          })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), gte(foodLog.date, weekStart))),
        context.db
          .select({ total: sql<number | null>`sum(${exerciseLog.kcal})` })
          .from(exerciseLog)
          .where(and(eq(exerciseLog.userId, userId), gte(exerciseLog.date, weekStart))),
        context.db
          .selectDistinct({ date: foodLog.date })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), gte(foodLog.date, streakStart))),
        context.db
          .selectDistinct({ date: weightLog.date })
          .from(weightLog)
          .where(and(eq(weightLog.userId, userId), gte(weightLog.date, streakStart))),
        context.db
          .select({
            steps: dailyActivity.steps,
            distanceMeters: dailyActivity.distanceMeters,
            activeCalories: dailyActivity.activeCalories,
            exerciseMinutes: dailyActivity.exerciseMinutes,
          })
          .from(dailyActivity)
          .where(and(eq(dailyActivity.userId, userId), eq(dailyActivity.date, date)))
          .limit(1),
        // Strength session on this day bumps the protein target (1.6 g/kg).
        context.db
          .select({ id: workoutSession.id })
          .from(workoutSession)
          .where(and(eq(workoutSession.userId, userId), eq(workoutSession.date, date)))
          .limit(1),
      ]);

      const prof = profileRows[0];
      const streakDays = streakFromDates(
        [...foodDates.map((r) => r.date), ...weightDates.map((r) => r.date)],
        today,
      );
      if (!prof) {
        return {
          hasProfile: false,
          targets: null,
          eatenKcal: 0,
          eatenByMeal: { ...ZERO_MEALS },
          burnedKcal: 0,
          dailyActivity: null,
          latestWeightKg: null,
          weightLoggedToday: false,
          streakDays,
          weightLostKg: 0,
          weekEatenKcal: 0,
          weekBurnedKcal: 0,
          weekMeals: 0,
          milestones: [],
          trend: null,
          protein: null,
          ideas: [],
          date,
        };
      }

      const plan = buildPlan(
        prof,
        { latestWeightKg: latestRows[0]?.weightKg ?? null, weighIns, intake, exercise },
        date,
      );
      const { targets } = plan;

      const eatenByMeal = { ...ZERO_MEALS };
      let eatenKcal = 0;
      let eatenProteinG = 0;
      for (const row of eatenRows) {
        eatenByMeal[row.meal as Meal] = row.kcal ?? 0;
        eatenKcal += row.kcal ?? 0;
        eatenProteinG += row.protein ?? 0;
      }
      const weightLostKg = Math.round((prof.startWeightKg - plan.weightNowKg) * 10) / 10;
      const burn = computeBurn({
        profile: plan.profileInput,
        weightNowKg: plan.weightNowKg,
        exerciseLogs: exerciseRows,
        tdeeKcal: targets.tdee,
        // past days are complete; today prorates by the live WIB clock
        ...(date === today ? {} : { dayFraction: 1 }),
      });
      const weekTrendStart = shiftDate(date, -7);

      return {
        hasProfile: true,
        targets,
        deficit: computeDeficit(eatenKcal, burn, targets.eatKcal),
        eatenKcal,
        eatenByMeal,
        burnedKcal: burn.exerciseKcal,
        // Health Connect rollup (null until the Android app syncs it)
        dailyActivity: activityRows[0] ?? null,
        sleepHoursLastNight: sleptRows[0]?.hours ?? null,
        latestWeightKg: plan.latestWeightKg,
        weightLoggedToday: (loggedRows[0]?.logged ?? 0) > 0,
        streakDays,
        weightLostKg,
        weekEatenKcal: Math.round(eatenWeek[0]?.kcal ?? 0),
        weekTrend: plan.weighIns
          .filter((w) => w.date >= weekTrendStart)
          .toReversed()
          .map((w) => ({ date: w.date, weightKg: w.weightKg })),
        weekBurnedKcal: Math.round(burnedWeek[0]?.total ?? 0),
        weekMeals: eatenWeek[0]?.meals ?? 0,
        weekProtein: Math.round(eatenWeek[0]?.protein ?? 0),
        weekCarbs: Math.round(eatenWeek[0]?.carbs ?? 0),
        weekFat: Math.round(eatenWeek[0]?.fat ?? 0),
        milestones: buildMilestones(streakDays, weightLostKg),
        trend: plan.trend,
        protein: {
          eatenG: Math.round(eatenProteinG),
          targetG: proteinTargetG(plan.weightNowKg, prof.heightCm, workoutRows.length > 0),
        },
        ideas:
          date === today
            ? mealIdeas(
                targets.eatKcal - eatenKcal,
                suggestMealNow(new Date(), effectiveRamadan(prof.ramadanMode)),
                3,
                (await loadIdeaValues(context.db, userId)) ?? undefined,
              )
            : [],
        date,
      };
    }),
};
