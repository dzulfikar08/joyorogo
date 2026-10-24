import { and, desc, eq, gte, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";
import {
  dailyActivity,
  exerciseLog,
  foodLog,
  sleepLog,
  weightLog,
} from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";

import type { Meal } from "../lib/engine";

import { protectedProcedure } from "../index";
import {
  computeBurn,
  computeDeficit,
  effectiveRamadan,
  jakartaToday,
  macroTargets,
  shiftDate,
  suggestMealNow,
} from "../lib/engine";
import { calibrationNotice } from "../lib/calibration";
import { readCalibrationPrefs } from "../lib/calibration-store";
import { energyNotice, showEnergyNotice } from "../lib/energy-notice";
import { budgetKcal, exerciseCredit } from "../lib/exercise-credit";
import {
  addBackPrefQuery,
  dayReadings,
  loadDayCredit,
  readAddBackPrefs,
} from "../lib/exercise-credit-store";
import { READINESS_LABELS, hasFitnessData } from "../lib/fitness-hint";
import { IMPORT_SOURCE, IMPORTED_WEIGHT_SOURCES } from "../lib/history-import";
import { dateSchema } from "../lib/schemas";
import { loadIdeaValues } from "./plate";
import { gainMealIdeas, mealIdeas } from "../lib/ideas";
import { buildPlan, gainedKg, planQueries, proteinGoalG, trainingDayQuery } from "../lib/plan";
import { pickNightSleep } from "../lib/sleep-night";
import { caffeineOfDay } from "../lib/maternal";
import {
  DIARY_MACRO_REFERENCE_KG,
  HISTORY_DAYS,
  MIN_HISTORY_DAYS,
  buildGuidance,
  premiumUnlocked,
} from "../lib/readiness-food";
import type { GuidanceTargets, HistoryFood } from "../lib/readiness-food";
import { fastLossNote } from "../lib/safety";
import { STREAK_WINDOW_DAYS } from "../lib/streak";
import { loadStreak } from "../lib/streak-store";
import { paywallConfig } from "../lib/tiers";
import { userZone } from "../lib/user-zone";

const ZERO_MEALS: Record<Meal, number> = {
  sarapan: 0,
  makan_siang: 0,
  makan_malam: 0,
  snack: 0,
  sahur: 0,
  berbuka: 0,
};

/** The sources a recorded workout can come from, in the order the "Olahraga hari ini" tile lists them. */
const EXERCISE_SOURCES = ["manual", "joyofit", "health_connect", "apple_health", "strava", "coros", "garmin"] as const;

export type Milestone = { kind: "streak" | "lost" | "gained"; value: number };

// Recap chips as data: the home screen words them in the viewer's language.
function buildMilestones(
  streakDays: number,
  weightLostKg: number,
  weightGainedKg: number,
): Milestone[] {
  return [
    ...(streakDays >= 30 ? [{ kind: "streak" as const, value: 30 }] : []),
    ...(streakDays >= 7 ? [{ kind: "streak" as const, value: 7 }] : []),
    ...(weightLostKg >= 10 ? [{ kind: "lost" as const, value: 10 }] : []),
    ...(weightLostKg >= 5 ? [{ kind: "lost" as const, value: 5 }] : []),
    ...(weightLostKg >= 2 ? [{ kind: "lost" as const, value: 2 }] : []),
    ...(weightGainedKg >= 5 ? [{ kind: "gained" as const, value: 5 }] : []),
    ...(weightGainedKg >= 3 ? [{ kind: "gained" as const, value: 3 }] : []),
    ...(weightGainedKg >= 1 ? [{ kind: "gained" as const, value: 1 }] : []),
  ];
}

/** 0..1 share of the way from the start weight to the goal weight; null without a gap to cover. */
function weightGoalProgress(startKg: number, nowKg: number, targetKg: number): number | null {
  const span = targetKg - startKg;
  if (Math.abs(span) < 0.5) return null;
  return Math.min(1, Math.max(0, (nowKg - startKg) / span));
}

export const dayRouter = {
  summary: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const zone = await userZone(context);
      const today = jakartaToday(undefined, zone);
      const date = input.date ?? today;
      const weekStart = shiftDate(today, -6);
      const streakStart = shiftDate(today, -STREAK_WINDOW_DAYS);

      const [
        profileRows,
        latestRows,
        weighIns,
        intake,
        exercise,
        calibrationRows,
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
        prefRows,
        scoreRows,
      ] = await context.db.batch([
        ...planQueries(context.db, userId, date),
        context.db
          .select({
            meal: foodLog.meal,
            kcal: sql<number | null>`sum(${foodLog.kcal})`,
            protein: sql<number | null>`sum(${foodLog.protein})`,
            carbs: sql<number | null>`sum(${foodLog.carbs})`,
            fat: sql<number | null>`sum(${foodLog.fat})`,
          })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), eq(foodLog.date, date)))
          .groupBy(foodLog.meal),
        context.db
          .select({
            kcal: exerciseLog.kcal,
            source: exerciseLog.source,
            externalId: exerciseLog.externalId,
            type: exerciseLog.type,
            durationMin: exerciseLog.durationMin,
          })
          .from(exerciseLog)
          .where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.date, date))),
        context.db
          .select({ hours: sleepLog.hours, source: sleepLog.source })
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
        // One row per logged day with its kcal: the normal streak reads the dates, a gain plan the totals.
        context.db
          .select({
            date: foodLog.date,
            kcal: sql<number>`sum(${foodLog.kcal})`,
            // Distinct meal slots that day: the fast-loss note only counts days that look fully logged.
            meals: sql<number>`count(distinct ${foodLog.meal})`,
          })
          .from(foodLog)
          // Imported history (source "huawei") never counts toward a streak.
          .where(
            and(
              eq(foodLog.userId, userId),
              gte(foodLog.date, streakStart),
              ne(foodLog.source, IMPORT_SOURCE),
            ),
          )
          .groupBy(foodLog.date),
        context.db
          .selectDistinct({ date: weightLog.date })
          .from(weightLog)
          .where(
            and(
              eq(weightLog.userId, userId),
              gte(weightLog.date, streakStart),
              notInArray(weightLog.source, IMPORTED_WEIGHT_SOURCES),
            ),
          ),
        context.db
          .select({
            steps: dailyActivity.steps,
            distanceMeters: dailyActivity.distanceMeters,
            activeCalories: dailyActivity.activeCalories,
            exerciseMinutes: dailyActivity.exerciseMinutes,
            source: dailyActivity.source,
          })
          .from(dailyActivity)
          .where(and(eq(dailyActivity.userId, userId), eq(dailyActivity.date, date)))
          .limit(1),
        // Strength training on this day (legacy session or a JoyoFit strength row) bumps the protein target (1.6 g/kg).
        trainingDayQuery(context.db, userId, date),
        // "Kalori olahraga" settings and the notice dismissal, from the synced account preferences.
        addBackPrefQuery(context.db, userId),
        // The watch's (JoyoFit) all-day active energy of the day, the main input of the activity credit, and the hours it
        // measured for the night that ended on this day.
        context.db
          .select({ activeKcal: fitnessScore.activeKcal, sleepHours: fitnessScore.sleepHours })
          .from(fitnessScore)
          .where(and(eq(fitnessScore.userId, userId), eq(fitnessScore.date, date)))
          .limit(1),
      ]);

      const prof = profileRows[0];
      if (!prof) {
        // No plan yet: the plain streak (no Naikin BB rule, no Hamil / Menyusui to exclude).
        const { days: streakDays } = await loadStreak(
          context.db,
          userId,
          today,
          streakStart,
          { food: foodDates, weight: weightDates },
          null,
        );
        return {
          hasProfile: false,
          targets: null,
          exerciseCredit: null,
          exerciseSources: [],
          energyNotice: null,
          calibrationNotice: null,
          addBackNotice: false, // COMPAT, old clients read it (see below)
          eatenKcal: 0,
          eatenByMeal: { ...ZERO_MEALS },
          burnedKcal: 0,
          dailyActivity: null,
          latestWeightKg: null,
          weightLoggedToday: false,
          streakDays,
          streak: null,
          weightLostKg: 0,
          weekEatenKcal: 0,
          weekBurnedKcal: 0,
          weekMeals: 0,
          milestones: [],
          trend: null,
          fastLoss: null,
          protein: null,
          maternal: null,
          ideas: [],
          date,
          zone,
        };
      }

      const plan = buildPlan(
        prof,
        {
          latestWeightKg: latestRows[0]?.weightKg ?? null,
          weighIns,
          intake,
          exercise,
          prefs: readCalibrationPrefs(calibrationRows),
        },
        date,
      );
      const { targets: planTargets } = plan;
      // Sisa = budget - eaten, the budget being the plan's base (TDEE less the deficit) plus the counted activity that
      // goes beyond the activity factor (lib/exercise-credit). Every client and the MCP read this one number;
      // `exerciseKcal` tells how much of `eatKcal` came from the activity.
      const { settings, noticeDismissed } = readAddBackPrefs(prefRows);
      const credit = exerciseCredit({
        settings,
        rows: exerciseRows,
        readings: dayReadings(activityRows[0], scoreRows[0]),
        steps: activityRows[0]?.steps ?? null,
        includedKcal: planTargets.includedKcal,
      });
      const targets = {
        ...planTargets,
        eatKcal: budgetKcal(planTargets.eatKcal, credit),
        exerciseKcal: credit.countedKcal,
      };

      const eatenByMeal = { ...ZERO_MEALS };
      let eatenKcal = 0;
      let eatenProteinG = 0;
      let eatenCarbsG = 0;
      let eatenFatG = 0;
      for (const row of eatenRows) {
        eatenCarbsG += row.carbs ?? 0;
        eatenFatG += row.fat ?? 0;
        eatenByMeal[row.meal as Meal] = row.kcal ?? 0;
        eatenKcal += row.kcal ?? 0;
        eatenProteinG += row.protein ?? 0;
      }
      const maternal = plan.maternal !== null;
      const weightLostKg = Math.round((prof.startWeightKg - plan.weightNowKg) * 10) / 10;
      // Naikin BB: the recap speaks of kg gained, never "lost"; the streak counts days at 90% of the target.
      const gaining = targets.gain !== null;
      const weightGainedKg = gaining ? gainedKg(prof, plan.weightNowKg) : 0;
      // No streak pressure in Hamil / Menyusui. A run that fills the window is followed further back (lib/streak-store).
      const streak = maternal
        ? null
        : await loadStreak(
            context.db,
            userId,
            today,
            streakStart,
            { food: foodDates, weight: weightDates },
            gaining ? planTargets.eatKcal : null,
          );
      const planStreakDays = streak?.days ?? 0;
      // Pregnant and breastfeeding users are exempt from fasting: "auto" Ramadan stays off for them.
      const ramadanPref = maternal && prof.ramadanMode === "auto" ? "off" : prof.ramadanMode;
      const loggedNames = async () =>
        (
          await context.db
            .select({ name: foodLog.name })
            .from(foodLog)
            .where(and(eq(foodLog.userId, userId), eq(foodLog.date, date)))
        ).map((row) => row.name);
      const burn = computeBurn({
        profile: plan.profileInput,
        weightNowKg: plan.weightNowKg,
        exerciseLogs: exerciseRows,
        tdeeKcal: targets.tdee,
        zone,
        // past days are complete; today prorates by the live clock in the user's zone
        ...(date === today ? {} : { dayFraction: 1 }),
      });
      const weekTrendStart = shiftDate(date, -7);
      // The calm "slow down a bit" note: today only, never for Hamil / Menyusui or a gain plan (lib/safety), from
      // data this query already loaded (60 days of weigh-ins, the per-day intake of the streak window).
      const fastLoss =
        date === today
          ? fastLossNote({
              today,
              weighIns: plan.weighIns,
              days: foodDates,
              bmrKcal: planTargets.bmr,
              maternal,
              gaining,
            })
          : null;

      return {
        hasProfile: true,
        targets,
        exerciseCredit: credit,
        // Where today's recorded exercise came from (for the "Olahraga hari ini" tile); rest rows are not movement.
        exerciseSources: EXERCISE_SOURCES.filter((source) =>
          exerciseRows.some((row) => row.source === source),
        ),
        // The one-time notice that the target is built on TDEE now (old target -> new target): accounts made before
        // the change, until closed.
        energyNotice: showEnergyNotice({
          accountCreatedAtMs: new Date(context.session.user.createdAt).getTime(),
          dismissed: noticeDismissed,
        })
          ? energyNotice(plan, today)
          : null,
        // The calibrated base target moved by 50 kcal or more since the person last saw one (Beranda's one-line notice,
        // today's plan only: a browsed past day must not acknowledge a past figure).
        calibrationNotice:
          date === today
            ? calibrationNotice({
                calibration: plan.calibration,
                baseKcal: planTargets.eatKcal,
                formulaBaseKcal: plan.formulaEatKcal,
                seenKcal: plan.prefs.seenKcal,
              })
            : null,
        // COMPAT, old clients (native builds up to 1932, web tabs opened before the TDEE deploy) show the "how Sisa is
        // counted changed" card when this is true. That notice is retired in favour of `energyNotice`: always false.
        addBackNotice: false,
        // Legacy: see computeDeficit. Not read by the current clients.
        deficit: computeDeficit(eatenKcal, burn, targets.eatKcal),
        eatenKcal,
        eatenByMeal,
        burnedKcal: burn.exerciseKcal,
        // Health Connect rollup (null until the Android app syncs it)
        dailyActivity: activityRows[0] ?? null,
        // The night that ended on `date`: the person's own log, else the watch's hours (JoyoFit), else an import.
        sleepHoursLastNight: pickNightSleep(sleptRows[0], scoreRows[0]?.sleepHours)?.hours ?? null,
        latestWeightKg: plan.latestWeightKg,
        // The day that weight was logged (on or before the viewed day), so a tile never shows an old weight as today's.
        latestWeightDate: latestRows[0]?.date ?? null,
        weightLoggedToday: (loggedRows[0]?.logged ?? 0) > 0,
        // No streak pressure or weight-loss recap in Hamil / Menyusui.
        streakDays: planStreakDays,
        // The streak's state for Beranda's chip and the home-screen widget; null in Hamil / Menyusui.
        streak,
        weightLostKg: maternal || gaining ? 0 : weightLostKg,
        weightGainedKg,
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
        milestones: maternal
          ? []
          : buildMilestones(planStreakDays, gaining ? 0 : weightLostKg, weightGainedKg),
        trend: plan.trend,
        fastLoss,
        protein: {
          eatenG: Math.round(eatenProteinG),
          targetG: proteinGoalG(plan, prof.heightCm, workoutRows.length > 0),
        },
        // The other two macros of the day and the progress toward the goal weight, for the share stickers.
        carbsEatenG: Math.round(eatenCarbsG),
        fatEatenG: Math.round(eatenFatG),
        weightGoalProgress: maternal
          ? null
          : weightGoalProgress(prof.startWeightKg, plan.weightNowKg, prof.targetWeightKg),
        // Exact weights: they only reach a sticker when the user turns "hide numbers" off.
        weightStartKg: maternal ? null : prof.startWeightKg,
        weightNowKg: maternal ? null : plan.weightNowKg,
        weightGoalKg: maternal ? null : prof.targetWeightKg,
        // Hamil / Menyusui: caffeine against the daily limit, estimated from the logged names.
        maternal: plan.maternal ? { caffeine: caffeineOfDay(await loggedNames()) } : null,
        ideas:
          date !== today
            ? []
            : targets.gain
              ? // Naikin BB: calorie-dense ideas for what is still to eat.
                gainMealIdeas(
                  targets.eatKcal - eatenKcal,
                  suggestMealNow(new Date(), effectiveRamadan(ramadanPref, new Date(), zone), zone),
                  3,
                  context.locale,
                )
              : mealIdeas(
                  targets.eatKcal - eatenKcal,
                  suggestMealNow(new Date(), effectiveRamadan(ramadanPref, new Date(), zone), zone),
                  3,
                  (await loadIdeaValues(context.db, userId, zone)) ?? undefined,
                  context.locale,
                ),
        date,
        // The person's day zone: a client that only holds this response (the home-screen widget) cuts "today" in it.
        zone,
      };
    }),

  /**
   * Calories logged per day over [from, to] for the weight chart's bars. Only
   * food_log counts (imported Strava workouts live in exercise_log and are
   * excluded from plan and analytics). A day with no food rows is `kcal: null`
   * ("not tracked"), never 0, so the chart can tell a skipped day from a fast.
   */
  kcalSeries: protectedProcedure
    .input(
      z
        .object({ from: dateSchema, to: dateSchema })
        .refine((v) => v.from <= v.to, "from must not be after to")
        .refine((v) => shiftDate(v.to, -400) <= v.from, "range is capped at 400 days"),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const rows = await context.db
        .select({ date: foodLog.date, kcal: sql<number>`sum(${foodLog.kcal})` })
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, userId),
            gte(foodLog.date, input.from),
            lte(foodLog.date, input.to),
          ),
        )
        .groupBy(foodLog.date);
      const byDate = new Map(rows.map((r) => [r.date, Math.round(r.kcal)]));
      const out: { date: string; kcal: number | null }[] = [];
      for (let d = input.from; d <= input.to; d = shiftDate(d, 1)) {
        out.push({ date: d, kcal: byDate.get(d) ?? null });
      }
      return out;
    }),

  /**
   * Founder food guidance for today from JoyoFit readiness, what is logged
   * today and the user's own food history (lib/readiness-food). Premium is
   * decided here: a free caller only ever gets `locked`, never the numbers.
   * Lives on `day` so every diary mutation (which invalidates `day`) refreshes it.
   */
  readinessGuidance: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const zone = await userZone(context);
    const [userRow] = await context.db
      .select({ tier: user.tier, founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!premiumUnlocked(userRow, paywallConfig(context.env))) {
      return { status: "locked" as const };
    }

    const today = jakartaToday(undefined, zone);
    const dayCount = sql`count(distinct ${foodLog.date})`;
    const [
      scoreRows,
      profileRows,
      latestRows,
      weighIns,
      intake,
      exercise,
      calibrationRows,
      todayRows,
      historyRows,
      workoutRows,
    ] = await context.db.batch([
      context.db
        .select({
          recoveryPct: fitnessScore.recoveryPct,
          strain: fitnessScore.strain,
          sleepPct: fitnessScore.sleepPct,
          readiness: fitnessScore.readiness,
        })
        .from(fitnessScore)
        .where(and(eq(fitnessScore.userId, userId), eq(fitnessScore.date, today)))
        .limit(1),
      ...planQueries(context.db, userId, today),
      context.db
        .select({
          name: foodLog.name,
          kcal: foodLog.kcal,
          protein: foodLog.protein,
          carbs: foodLog.carbs,
        })
        .from(foodLog)
        .where(and(eq(foodLog.userId, userId), eq(foodLog.date, today))),
      // Foods logged on at least MIN_HISTORY_DAYS days of the last HISTORY_DAYS,
      // before today; avg() skips null macros, so unknown stays unknown.
      context.db
        .select({
          name: sql<string>`min(${foodLog.name})`,
          days: sql<number>`${dayCount}`,
          kcal: sql<number>`avg(${foodLog.kcal})`,
          protein: sql<number | null>`avg(${foodLog.protein})`,
          carbs: sql<number | null>`avg(${foodLog.carbs})`,
          meals: sql<string>`group_concat(distinct ${foodLog.meal})`,
        })
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, userId),
            gte(foodLog.date, shiftDate(today, -HISTORY_DAYS)),
            lt(foodLog.date, today),
          ),
        )
        .groupBy(sql`lower(trim(${foodLog.name}))`)
        .having(sql`${dayCount} >= ${MIN_HISTORY_DAYS}`)
        .orderBy(desc(dayCount))
        .limit(80),
      trainingDayQuery(context.db, userId, today),
    ]);

    const score = scoreRows[0];
    const fitnessDay = score && {
      ...score,
      // free text in the column; only JoyoFit's four words are meaningful
      readiness: READINESS_LABELS.find((label) => label === score.readiness) ?? null,
    };
    if (!hasFitnessData(fitnessDay)) return { status: "none" as const };

    const prof = profileRows[0];
    let targets: GuidanceTargets | null = null;
    if (prof) {
      const builtPlan = buildPlan(
        prof,
        {
          latestWeightKg: latestRows[0]?.weightKg ?? null,
          weighIns,
          intake,
          exercise,
          prefs: readCalibrationPrefs(calibrationRows),
        },
        today,
      );
      // The diary's bar and Sisa use the plan plus the counted exercise; guidance reads the same budget.
      const credit = await loadDayCredit(context.db, userId, today, builtPlan.targets.includedKcal);
      const eatKcal = budgetKcal(builtPlan.targets.eatKcal, credit);
      targets = {
        eatKcal,
        proteinG: proteinGoalG(builtPlan, prof.heightCm, workoutRows.length > 0),
        carbsG: macroTargets(eatKcal, DIARY_MACRO_REFERENCE_KG).carbsG,
      };
    }

    const history: HistoryFood[] = historyRows.map((row) => ({
      name: row.name,
      days: row.days,
      kcal: row.kcal,
      proteinG: row.protein,
      carbsG: row.carbs,
      meals: row.meals ? row.meals.split(",") : [],
    }));
    const guidance = buildGuidance(
      {
        day: fitnessDay,
        targets,
        eaten: {
          kcal: todayRows.reduce((sum, row) => sum + row.kcal, 0),
          proteinG: todayRows.reduce((sum, row) => sum + (row.protein ?? 0), 0),
          carbsG: todayRows.reduce((sum, row) => sum + (row.carbs ?? 0), 0),
          names: todayRows.map((row) => row.name),
        },
        history,
        slot: suggestMealNow(
          new Date(),
          effectiveRamadan(prof?.ramadanMode, new Date(), zone),
          zone,
        ),
      },
      context.locale,
    );
    return { status: "ready" as const, guidance };
  }),
};
