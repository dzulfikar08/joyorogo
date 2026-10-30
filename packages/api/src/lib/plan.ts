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
  computeTargets,
  idealWeightRange,
  macroTargets,
  proteinTargetG,
  shiftDate,
  weightTrend,
} from "./engine";
import { CALIBRATION_HISTORY_DAYS, resolveCalibration } from "./calibration";
import type { CalibrationInfo } from "./calibration";
import { calibrationPrefQuery } from "./calibration-store";
import type { CalibrationPrefs } from "./calibration-store";
import { isRapidLoss } from "./gain";
import { resolveManualTdee } from "./manual-tdee";
import { computeMaternalTargets, maternalFromRow, maternalNutrient } from "./maternal";
import type { MaternalState } from "./maternal";

/** Weigh-in history for trend warm-up; the EMA forgets ~99% of a reading in 45 days. */
const TREND_HISTORY_DAYS = 60;

/**
 * Queries the plan needs for `date`, shaped for `db.batch` so callers fold
 * them into their own single round trip: profile, latest weigh-in ever,
 * 60 days of weigh-ins, the intake + exercise totals of the days before `date`
 * the calibration's weekly windows reach (41 days: 28 before the Monday before
 * the one on or before `date`), and the calibration preferences.
 */
export function planQueries(db: Database, userId: string, date: string) {
  const windowStart = shiftDate(date, -CALIBRATION_HISTORY_DAYS);
  return [
    db.select().from(profile).where(eq(profile.userId, userId)).limit(1),
    db
      .select({ date: weightLog.date, weightKg: weightLog.weightKg })
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
    calibrationPrefQuery(db, userId),
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
  /** where the automatic calibration stands (also on `targets.calibration`); null for Hamil / Menyusui */
  calibration: CalibrationInfo | null;
  /** the base eat target the pure level formula gives; what the plan was before calibration, for Beranda's notice */
  formulaEatKcal: number;
  /** the person's calibration preferences, for callers that also need the acknowledged figure */
  prefs: CalibrationPrefs;
};

/**
 * The 3 numbers for `date`: TDEE (BMR x activity factor, or the calibrated TDEE once the weight trend has earned one)
 * less the deficit (gain: plus the surplus), Hamil / Menyusui from AKG. `history` is what `planQueries` loads; `prefs`
 * is required so that no caller can build a plan that ignores the person's calibration switch.
 */
export function buildPlan(
  row: ProfileRow,
  history: {
    latestWeightKg: number | null;
    weighIns: WeighIn[];
    intake: DayKcal[];
    exercise: DayKcal[];
    prefs: CalibrationPrefs;
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
    sleepTargetHours: row.sleepTargetHours,
  };
  const weightNowKg = history.latestWeightKg ?? row.startWeightKg;
  // Hamil / Menyusui: no deficit, no weight target, no measured-TDEE drift.
  const maternal = maternalFromRow(row);
  const manualKcal = row.manualTdeeKcal ?? null;
  const manualInput = {
    manualKcal,
    date,
    calibrationEnabled: history.prefs.enabled,
    dismissedOn: row.manualTdeeDismissedOn ?? null,
    weighIns: history.weighIns,
    intake: history.intake,
    exercise: history.exercise,
  };
  if (maternal.mode !== "none") {
    const computed = computeMaternalTargets(profileInput, maternal, { today: date, weightNow: weightNowKg });
    // A typed TDEE replaces the pre-pregnancy base; the AKG addition goes on top of it as always.
    const targets =
      manualKcal === null
        ? computed
        : computeMaternalTargets(profileInput, maternal, { today: date, weightNow: weightNowKg, tdeeKcal: manualKcal });
    // Maternal plans have no weight drift to measure, so there is nothing to suggest from.
    targets.manualTdee = resolveManualTdee({
      ...manualInput,
      computedKcal: computed.tdee,
      bmrKcal: computed.bmr,
      calibrationEnabled: false,
    });
    return {
      profileInput,
      latestWeightKg: history.latestWeightKg,
      weightNowKg,
      weighIns: history.weighIns,
      targets,
      trend: null,
      maternal,
      calibration: null,
      formulaEatKcal: 0,
      prefs: history.prefs,
    };
  }
  // The base is TDEE less the deficit. TDEE is BMR x the chosen activity factor until the weight trend has earned a
  // calibrated one (lib/calibration: enough logs, held weekly, within +-15% of the formula, workouts taken out once).
  const formula = computeTargets(profileInput, { weightNow: weightNowKg });
  const { info, tdeeKcal } = resolveCalibration({
    enabled: history.prefs.enabled,
    date,
    weighIns: history.weighIns,
    intake: history.intake,
    exercise: history.exercise,
    formulaKcal: formula.tdee,
  });
  const computedKcal = tdeeKcal ?? formula.tdee;
  // A typed TDEE wins over the calibrated one: the calibration keeps measuring, but only to suggest (lib/manual-tdee).
  const targets =
    manualKcal !== null
      ? computeTargets(profileInput, { weightNow: weightNowKg, tdeeKcal: manualKcal })
      : tdeeKcal === null
        ? formula
        : computeTargets(profileInput, { weightNow: weightNowKg, tdeeKcal });
  targets.calibration =
    manualKcal === null ? info : { ...info, status: "manual", usedKcal: null, clamped: false };
  targets.manualTdee = resolveManualTdee({ ...manualInput, computedKcal, bmrKcal: formula.bmr });
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
    calibration: targets.calibration,
    formulaEatKcal: formula.eatKcal,
    prefs: history.prefs,
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

/**
 * The day's protein, carb, fat and fibre targets for a budget of `eatKcal`, all from the person's own weight: protein
 * as `proteinGoalG`, fat and carbs from that protein and the same basis weight (the lesser of current weight and the
 * top of the healthy range, which is also the gain plan's protein basis). Every server caller uses this.
 */
export function macroGoals(
  plan: Pick<Plan, "targets" | "weightNowKg">,
  heightCm: number,
  trainingDay: boolean,
  eatKcal: number,
): { proteinG: number; carbsG: number; fatG: number; fiberG: number } {
  const proteinG = proteinGoalG(plan, heightCm, trainingDay);
  const basisKg = Math.min(plan.weightNowKg, idealWeightRange(heightCm).maxKg);
  return { proteinG, ...macroTargets(eatKcal, proteinG, basisKg) };
}

/** Kg gained since a gain plan began (the stored baseline, else the onboarding weight); never negative. */
export function gainedKg(
  row: Pick<ProfileRow, "goalStartKg" | "startWeightKg">,
  weightNowKg: number,
): number {
  return Math.max(0, Math.round((weightNowKg - (row.goalStartKg ?? row.startWeightKg)) * 10) / 10);
}
