import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { LOCALES, matchDayZone } from "@joyorogo/i18n";
import type { DayZone, Locale } from "@joyorogo/i18n";
import { user } from "@joyorogo/db/schema/auth";
import { dailyActivity, foodLog, profile, weightLog } from "@joyorogo/db/schema/fitness";

import { deleteUserMedia } from "../lib/privacy";

import type { Database } from "@joyorogo/db";
import type { Targets } from "../lib/engine";

import { protectedProcedure } from "../index";
import { checkTargetDate, jakartaToday, shiftDate } from "../lib/engine";
import { GOALS, goalTargetError, resolveGoal } from "../lib/gain";
import type { Goal } from "../lib/gain";
import { FEEDING_TYPES, NO_MATERNAL, maternalFromRow, maternalToRow, resolveMaternalInput } from "../lib/maternal";
import type { MaternalState } from "../lib/maternal";
import {
  STEPS_WINDOW_DAYS,
  activityOptions,
  calibrationRecommendation,
  stepsRecommendation,
} from "../lib/activity-guide";
import { activityLevelSchema, dateSchema, manualTdeeKcalSchema, maternalInputSchema, profileInputSchema, sleepTargetHoursSchema } from "../lib/schemas";
import { readCalibrationPrefs } from "../lib/calibration-store";
import { buildPlan, planQueries } from "../lib/plan";
import { serverT } from "../lib/messages";
import { userZone } from "../lib/user-zone";
import { effectiveTier, paywallConfig, scanAllowance, scansUsedToday } from "../lib/tiers";

/**
 * Entering Hamil / Menyusui: fasting reminders and the public progress page go off, and
 * the plan holds weight (a gain goal is off while these modes are on).
 * Fasting is not part of these modes, and health data is never shared by default.
 */
const MATERNAL_DEFAULTS = {
  fastingPattern: "off",
  fastingNotify: false,
  shareEnabled: false,
  goal: "maintain",
  goalStartKg: null,
} as const;

/**
 * Hamil / Menyusui compute no weight target, but the columns are NOT NULL: they
 * hold a maintenance target (today's weight) one year out, the plan that applies
 * if the mode ends. No deficit comes from it. A held weight is the "maintain" goal.
 */
function holdWeight(weightKg: number, today: string) {
  return {
    targetWeightKg: weightKg,
    targetDate: shiftDate(today, 365),
    goal: "maintain",
    goalStartKg: null,
  } as const;
}

/**
 * The goal, target weight and date a target edit stores. An explicit goal wins and has to
 * sit on the right side of the target ("Jaga BB" holds today's weight); otherwise the goal
 * is derived from the target vs the weight, or kept while the target is unchanged (lib/gain
 * resolveGoal).
 */
function settleTarget(
  locale: Locale,
  args: {
    explicit: Goal | undefined;
    stored: Goal;
    /** the stored gain baseline; null when none */
    storedStartKg: number | null;
    weightNowKg: number;
    /** the stored target; null when there is none yet (onboarding) */
    currentTargetKg: number | null;
    targetWeightKg: number;
    targetDate: string;
    today: string;
  },
): { goal: Goal; goalStartKg: number | null; targetWeightKg: number; targetDate: string } {
  if (args.explicit === "maintain") return holdWeight(args.weightNowKg, args.today);
  if (args.explicit) {
    const error = goalTargetError(args.explicit, args.weightNowKg, args.targetWeightKg);
    if (error) throw new ORPCError("BAD_REQUEST", { message: serverT(locale, "errors")(`profile.${error}`) });
  }
  const goal = resolveGoal({
    explicit: args.explicit,
    stored: args.stored,
    weightNowKg: args.weightNowKg,
    currentTargetKg: args.currentTargetKg ?? Number.NaN,
    nextTargetKg: args.targetWeightKg,
  });
  // The "naik X kg" baseline is the weight when the plan became a gain; it stays while it remains one.
  const goalStartKg =
    goal !== "gain" ? null : args.stored === "gain" && args.storedStartKg !== null ? args.storedStartKg : args.weightNowKg;
  return { goal, goalStartKg, targetWeightKg: args.targetWeightKg, targetDate: args.targetDate };
}

/** Today's plan exactly as day.summary computes it (latest weigh-in + measured TDEE). */
async function loadPlan(db: Database, userId: string, zone: DayZone) {
  const today = jakartaToday(undefined, zone);
  const [[userRow], [row], [latest], weighIns, intake, exercise, prefRows] = await db.batch([
    db
      .select({ tier: user.tier, founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
    ...planQueries(db, userId, today),
  ]);
  const tier = effectiveTier(userRow);
  // Only a paid period has an end date; manual comps never expire.
  const founderUntil = userRow?.tier === "free" ? (userRow.founderUntil ?? null) : null;
  if (!row) return { row: null, plan: null, tier, founderUntil };
  const plan = buildPlan(
    row,
    { latestWeightKg: latest?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(prefRows) },
    today,
  );
  return { row, plan, tier, founderUntil };
}

export const profileRouter = {
  myProfile: protectedProcedure.handler(async ({ context }) => {
    const zone = await userZone(context);
    const { row, plan, tier, founderUntil } = await loadPlan(context.db, context.session.user.id, zone);
    if (!row || !plan) {
      return { profile: null, targets: null, latestWeightKg: null, tier, founderUntil };
    }
    return {
      profile: row,
      targets: plan.targets,
      latestWeightKg: plan.weightNowKg,
      tier,
      founderUntil,
    };
  }),

  // The device's zone, sent by the apps at start-up and when it changes: the calendar days (diary, streaks, the daily
  // scan quota, recaps) are cut in it from now on. A zone we do not serve (anything but Jakarta, Kuala Lumpur,
  // Singapore, Kuching) is ignored. No profile yet: nothing to store, onboarding sends it with the profile.
  setTimezone: protectedProcedure
    .input(z.object({ timezone: z.string().max(64) }))
    .handler(async ({ context, input }) => {
      const zone = matchDayZone(input.timezone);
      if (!zone) return { timezone: await userZone(context) };
      await context.db.update(profile).set({ timezone: zone }).where(eq(profile.userId, context.session.user.id));
      return { timezone: zone };
    }),

  // Today's AI scan allowance, so the scan screen can say "2 of 3 free scans left" before the limit hits. The same
  // rule requireAiQuota enforces (quota.ts); `quota`/`left` are null for an unlimited account or a server without a paywall.
  scanAllowance: protectedProcedure.handler(async ({ context }) => {
    const zone = await userZone(context);
    const userId = context.session.user.id;
    const [[userRow], used] = await Promise.all([
      context.db
        .select({ tier: user.tier, founderUntil: user.founderUntil, aiUnlimited: user.aiUnlimited })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
      scansUsedToday(context.db, userId, jakartaToday(undefined, zone), zone),
    ]);
    return scanAllowance(effectiveTier(userRow), userRow?.aiUnlimited ?? false, used, paywallConfig(context.env));
  }),

  // Where the activity level is chosen: what each of the five levels would make of THIS person's target, plus the two
  // "lebih akurat" recommendations (from steps; from the weight trend). Works before onboarding too (no profile:
  // only the steps recommendation can exist). Recommendations are never applied here; setActivityLevel does that.
  activityGuide: protectedProcedure.handler(async ({ context }) => {
    const zone = await userZone(context);
    const userId = context.session.user.id;
    const today = jakartaToday(undefined, zone);
    const [[row], [latest], weighIns, intake, exercise, prefRows, stepRows] = await context.db.batch([
      ...planQueries(context.db, userId, today),
      context.db
        .select({ date: dailyActivity.date, steps: dailyActivity.steps })
        .from(dailyActivity)
        .where(
          and(
            eq(dailyActivity.userId, userId),
            gte(dailyActivity.date, shiftDate(today, -STEPS_WINDOW_DAYS)),
            lt(dailyActivity.date, today),
          ),
        ),
    ]);
    const steps = stepsRecommendation(stepRows, today);
    if (!row) return { level: null, maternal: false, options: [], steps, calibration: null, autoCalibration: null };
    const plan = buildPlan(
      row,
      { latestWeightKg: latest?.weightKg ?? null, weighIns, intake, exercise, prefs: readCalibrationPrefs(prefRows) },
      today,
    );
    return {
      level: plan.targets.level,
      maternal: plan.maternal !== null,
      options: activityOptions(plan.profileInput, plan.maternal, plan.weightNowKg, today, row.manualTdeeKcal ?? null),
      steps,
      // The level suggestion from the weight trend. With the automatic calibration on it supersedes it (the target is
      // already built on the measured figure), so it shows only while the calibration is off. Hamil / Menyusui: the
      // weight is expected to move, so it says nothing about the activity level.
      calibration:
        plan.maternal === null && !plan.prefs.enabled
          ? calibrationRecommendation({
              date: today,
              weighIns,
              intake,
              exercise,
              bmrKcal: plan.targets.bmr,
              currentLevel: plan.targets.level,
            })
          : null,
      // The automatic calibration: switch, progress, formula / measured / used. Null for Hamil / Menyusui.
      autoCalibration: plan.calibration,
    };
  }),

  setActivityLevel: protectedProcedure
    .input(z.object({ level: activityLevelSchema }))
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const updated = await context.db
        .update(profile)
        .set({ activityLevel: input.level })
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      const { plan } = await loadPlan(context.db, userId, zone);
      if (!plan) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      return { targets: plan.targets };
    }),

  setSleepTarget: protectedProcedure
    .input(z.object({ hours: sleepTargetHoursSchema }))
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const updated = await context.db
        .update(profile)
        .set({ sleepTargetHours: input.hours })
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      const { plan } = await loadPlan(context.db, userId, zone);
      if (!plan) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      return { targets: plan.targets };
    }),

  // "Pakai TDEE sendiri": the person's own maintenance kcal. Saving it clears an earlier "Biarkan" of the calibration's
  // suggestion (a new number deserves new suggestions); the same call serves "Pakai angka ini".
  setManualTdee: protectedProcedure
    .input(z.object({ kcal: manualTdeeKcalSchema }))
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const updated = await context.db
        .update(profile)
        .set({ manualTdeeKcal: input.kcal, manualTdeeSetAt: new Date(), manualTdeeDismissedOn: null })
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      const { plan } = await loadPlan(context.db, userId, zone);
      if (!plan) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      return { targets: plan.targets };
    }),

  // "Kembali ke hitungan otomatis".
  clearManualTdee: protectedProcedure.handler(async ({ context }): Promise<{ targets: Targets }> => {
    const zone = await userZone(context);
    const userId = context.session.user.id;
    const t = serverT(context.locale, "errors");
    const updated = await context.db
      .update(profile)
      .set({ manualTdeeKcal: null, manualTdeeSetAt: null, manualTdeeDismissedOn: null })
      .where(eq(profile.userId, userId))
      .returning({ userId: profile.userId });
    if (updated.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
    }
    const { plan } = await loadPlan(context.db, userId, zone);
    if (!plan) {
      throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
    }
    return { targets: plan.targets };
  }),

  // "Biarkan": the suggestion stays away for MANUAL_TDEE_DISMISS_DAYS.
  dismissManualTdeeSuggestion: protectedProcedure.handler(async ({ context }): Promise<{ targets: Targets }> => {
    const zone = await userZone(context);
    const userId = context.session.user.id;
    const t = serverT(context.locale, "errors");
    const updated = await context.db
      .update(profile)
      .set({ manualTdeeDismissedOn: jakartaToday(undefined, zone) })
      .where(and(eq(profile.userId, userId), isNotNull(profile.manualTdeeKcal)))
      .returning({ userId: profile.userId });
    if (updated.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
    }
    const { plan } = await loadPlan(context.db, userId, zone);
    if (!plan) {
      throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
    }
    return { targets: plan.targets };
  }),

  // Opt-in public progress page (/u/<code>); code is generated once.
  shareToggle: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [row] = await context.db
        .select()
        .from(profile)
        .where(eq(profile.userId, userId))
        .limit(1);
      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: serverT(context.locale, "errors")("profile.onboardingRequired"),
        });
      }
      if (input.enabled && row.maternalMode !== "none") {
        throw new ORPCError("BAD_REQUEST", {
          message: serverT(context.locale, "errors")("profile.shareMaternal"),
        });
      }
      const shareCode =
        input.enabled && !row.shareCode
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
          : row.shareCode;
      await context.db
        .update(profile)
        .set({ shareEnabled: input.enabled, shareCode })
        .where(eq(profile.userId, userId));
      return { shareEnabled: input.enabled, shareCode: shareCode ?? null };
    }),

  upsert: protectedProcedure
    .input(
      profileInputSchema.extend({
        // Not asked in Hamil / Menyusui: those modes have no weight target.
        targetWeightKg: z.number().min(25).max(400).optional(),
        targetDate: dateSchema.optional(),
        maternal: maternalInputSchema.optional(),
        // "Turunin BB / Jaga BB / Naikin BB". Absent: derived from the target vs the weight.
        goal: z.enum(GOALS).optional(),
        // The device's IANA zone (Intl): a profile's days are cut in it when we serve it, else in the region's zone.
        timezone: z.string().max(64).optional(),
      }),
    )
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const zone = matchDayZone(input.timezone) ?? (await userZone(context));
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const today = jakartaToday(undefined, zone);
      const resolved = resolveMaternalInput(input.maternal ?? { mode: "none" }, today);
      if (!resolved.ok) {
        throw new ORPCError("BAD_REQUEST", { message: t(`profile.${resolved.error}`) });
      }
      const maternal = resolved.state;
      if (maternal.mode !== "none" && input.gender !== "female") {
        throw new ORPCError("BAD_REQUEST", { message: t("profile.maternalFemaleOnly") });
      }
      const held =
        maternal.mode === "none"
          ? null
          : holdWeight(maternal.prePregnancyWeightKg ?? input.weightKg, today);
      if (held === null && (input.targetWeightKg === undefined || input.targetDate === undefined)) {
        throw new ORPCError("BAD_REQUEST", { message: t("profile.targetDateInvalid") });
      }
      const settled =
        held ??
        settleTarget(context.locale, {
          explicit: input.goal,
          stored: "lose",
          storedStartKg: null,
          weightNowKg: input.weightKg,
          currentTargetKg: null,
          targetWeightKg: input.targetWeightKg!,
          targetDate: input.targetDate!,
          today,
        });
      const { targetWeightKg, targetDate, goal, goalStartKg } = settled;
      // Omitted: keep the stored sleep goal (onboarding never asks for it).
      const sleepTargetHours =
        input.sleepTargetHours !== undefined
          ? input.sleepTargetHours
          : ((await context.db
              .select({ hours: profile.sleepTargetHours })
              .from(profile)
              .where(eq(profile.userId, userId))
              .limit(1))[0]?.hours ?? null);
      const fields = {
        birthYear: input.birthYear,
        gender: input.gender,
        heightCm: input.heightCm,
        startWeightKg: input.weightKg,
        targetWeightKg,
        targetDate,
        goal,
        goalStartKg,
        activityLevel: input.activityLevel,
        sleepTargetHours,
        timezone: zone,
        ...maternalToRow(maternal),
        ...(maternal.mode !== "none" ? MATERNAL_DEFAULTS : {}),
      };
      // the onboarding weight doubles as the first weigh-in; one atomic batch
      await context.db.batch([
        context.db
          .insert(profile)
          .values({ userId, ...fields })
          .onConflictDoUpdate({ target: profile.userId, set: fields }),
        context.db
          .insert(weightLog)
          .values({
            id: crypto.randomUUID(),
            userId,
            date: today,
            weightKg: input.weightKg,
          })
          .onConflictDoUpdate({
            target: [weightLog.userId, weightLog.date],
            set: { weightKg: input.weightKg },
          }),
      ]);
      const { plan } = await loadPlan(context.db, userId, zone);
      if (!plan) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      return { targets: plan.targets };
    }),

  // Editing the plan from /profil must not touch startWeightKg (the history
  // baseline) — that column is owned by onboarding and weigh-ins.
  updateTargets: protectedProcedure
    .input(
      z.object({
        targetWeightKg: z.number().min(25).max(400),
        targetDate: dateSchema,
        goal: z.enum(GOALS).optional(),
      }),
    )
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const today = jakartaToday(undefined, zone);
      const { row, plan: current } = await loadPlan(context.db, userId, zone);
      if (!row || !current) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      const settled = settleTarget(context.locale, {
        explicit: input.goal,
        stored: row.goal,
        storedStartKg: row.goalStartKg,
        weightNowKg: current.weightNowKg,
        currentTargetKg: row.targetWeightKg,
        targetWeightKg: input.targetWeightKg,
        targetDate: input.targetDate,
        today,
      });
      // Gain is off while Hamil / Menyusui are on.
      if (settled.goal === "gain" && row.maternalMode !== "none") {
        throw new ORPCError("BAD_REQUEST", { message: t("profile.gainMaternal") });
      }
      // A weight edit re-sends the stored date, which may have lapsed; only a
      // date the user is actually changing has to be in the future.
      if (settled.targetDate !== row.targetDate) {
        const check = checkTargetDate({
          weightNowKg: current.weightNowKg,
          targetWeightKg: settled.targetWeightKg,
          targetDate: settled.targetDate,
          goal: settled.goal,
          heightCm: row.heightCm,
        });
        if (check.status === "invalid" || check.status === "past" || check.status === "tooFar") {
          const key = {
            invalid: "profile.targetDateInvalid",
            past: "profile.targetDatePast",
            tooFar: "profile.targetDateTooFar",
          } as const;
          throw new ORPCError("BAD_REQUEST", { message: t(key[check.status]) });
        }
      }
      const updated = await context.db
        .update(profile)
        .set({
          targetWeightKg: settled.targetWeightKg,
          targetDate: settled.targetDate,
          goal: settled.goal,
          goalStartKg: settled.goalStartKg,
        })
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      const { plan } = await loadPlan(context.db, userId, zone);
      if (!plan) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      return { targets: plan.targets };
    }),

  // What the plan would be for a candidate target, without saving: the date
  // sheet shows the daily numbers move before the user commits.
  previewTargets: protectedProcedure
    .input(
      z.object({
        targetWeightKg: z.number().min(25).max(400),
        targetDate: dateSchema,
        goal: z.enum(GOALS).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const today = jakartaToday(undefined, zone);
      const [[row], [latest], weighIns, intake, exercise, prefRows] = await context.db.batch(
        planQueries(context.db, userId, today),
      );
      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: serverT(context.locale, "errors")("profile.onboardingRequired"),
        });
      }
      const history = {
        latestWeightKg: latest?.weightKg ?? null,
        weighIns,
        intake,
        exercise,
        prefs: readCalibrationPrefs(prefRows),
      };
      const now = buildPlan(row, history, today);
      const settled = settleTarget(context.locale, {
        explicit: input.goal,
        stored: row.goal,
        storedStartKg: row.goalStartKg,
        weightNowKg: now.weightNowKg,
        currentTargetKg: row.targetWeightKg,
        targetWeightKg: input.targetWeightKg,
        targetDate: input.targetDate,
        today,
      });
      const next = buildPlan({ ...row, ...settled }, history, today);
      return {
        check: checkTargetDate({
          weightNowKg: next.weightNowKg,
          targetWeightKg: settled.targetWeightKg,
          targetDate: settled.targetDate,
          goal: settled.goal,
          heightCm: row.heightCm,
        }),
        goal: settled.goal,
        current: now.targets,
        next: next.targets,
      };
    }),

  // Hamil / Menyusui on or off, from Settings > Profile. Turning it off returns to a
  // maintenance plan (target weight = today's weight): the old weight-loss target
  // pre-dates the pregnancy and is only set again on purpose, after a doctor visit.
  setMaternal: protectedProcedure.input(maternalInputSchema).handler(async ({ context, input }) => {
    const zone = await userZone(context);
    const userId = context.session.user.id;
    const t = serverT(context.locale, "errors");
    const today = jakartaToday(undefined, zone);
    const { row, plan } = await loadPlan(context.db, userId, zone);
    if (!row || !plan) {
      throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
    }
    if (input.mode !== "none" && row.gender !== "female") {
      throw new ORPCError("BAD_REQUEST", { message: t("profile.maternalFemaleOnly") });
    }
    const resolved = resolveMaternalInput(input, today);
    if (!resolved.ok) {
      throw new ORPCError("BAD_REQUEST", { message: t(`profile.${resolved.error}`) });
    }
    const previous = maternalFromRow(row);
    // Pregnant -> breastfeeding without a new answer keeps the pre-pregnancy weight already stored.
    const state =
      resolved.state.mode === "breastfeeding" && resolved.state.prePregnancyWeightKg === null
        ? { ...resolved.state, prePregnancyWeightKg: previous.prePregnancyWeightKg }
        : resolved.state;
    await context.db
      .update(profile)
      .set({
        ...maternalToRow(state),
        ...(state.mode !== "none" ? MATERNAL_DEFAULTS : {}),
        ...(state.mode === "none" && previous.mode !== "none"
          ? holdWeight(plan.weightNowKg, today)
          : {}),
      })
      .where(eq(profile.userId, userId));
    const next = await loadPlan(context.db, userId, zone);
    return { targets: next.plan?.targets ?? plan.targets };
  }),

  // "Sudah melahirkan": pregnancy ends; the baby's birth date starts Menyusui, or the
  // account goes back to a maintenance plan (no deficit until the user sets a target).
  endPregnancy: protectedProcedure
    .input(
      z.object({
        next: z.enum(["breastfeeding", "none"]),
        birthDate: dateSchema.optional(),
        feeding: z.enum(FEEDING_TYPES).default("exclusive"),
      }),
    )
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const today = jakartaToday(undefined, zone);
      const { row, plan } = await loadPlan(context.db, userId, zone);
      if (!row || !plan) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      const previous = maternalFromRow(row);
      if (previous.mode !== "pregnant") {
        throw new ORPCError("BAD_REQUEST", { message: t("profile.notPregnant") });
      }
      const birthDate = input.birthDate ?? today;
      if (birthDate > today || birthDate < shiftDate(today, -730)) {
        throw new ORPCError("BAD_REQUEST", { message: t("profile.birthDateInvalid") });
      }
      const state: MaternalState =
        input.next === "breastfeeding"
          ? {
              ...previous,
              mode: "breastfeeding",
              pregnancyLmp: null,
              pregnancyDateKind: null,
              twins: false,
              feedingType: input.feeding,
              babyBirthDate: birthDate,
            }
          : NO_MATERNAL;
      await context.db
        .update(profile)
        .set({
          ...maternalToRow(state),
          ...(state.mode === "none" ? holdWeight(plan.weightNowKg, today) : {}),
        })
        .where(eq(profile.userId, userId));
      const next = await loadPlan(context.db, userId, zone);
      return { mode: state.mode, targets: next.plan?.targets ?? plan.targets };
    }),
  // Saved app language. Clients resolve saved > device choice > device language
  // and send the result as x-locale; this stores the explicit choice so it
  // follows the account across devices and drives push/email text. No profile
  // row yet (before onboarding) is not an error: the device keeps the choice
  // and syncs it once the profile exists.
  setLocale: protectedProcedure
    .input(z.object({ locale: z.enum(LOCALES) }))
    .handler(async ({ context, input }) => {
      const updated = await context.db
        .update(profile)
        .set({ locale: input.locale })
        .where(eq(profile.userId, context.session.user.id))
        .returning({ userId: profile.userId });
      return { locale: input.locale, saved: updated.length > 0 };
    }),
  // Ramadan schedule toggle (US-022). 'auto' follows the Hijri calendar.
  setRamadanMode: protectedProcedure
    .input(z.object({ mode: z.enum(["auto", "on", "off"]) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await context.db
        .update(profile)
        .set({ ramadanMode: input.mode })
        .where(eq(profile.userId, userId));
      return { ramadanMode: input.mode };
    }),
  // "Simpan foto asli" (opt-in). Turning it off also deletes the originals
  // already kept, so off always means no photos on the server.
  setKeepPhotos: protectedProcedure
    .input(z.object({ keep: z.boolean() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const updated = await context.db
        .update(profile)
        .set({ keepPhotos: input.keep })
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: serverT(context.locale, "errors")("profile.onboardingRequired"),
        });
      }
      if (!input.keep) {
        await context.db
          .update(foodLog)
          .set({ photoId: null })
          .where(and(eq(foodLog.userId, userId), isNotNull(foodLog.photoId)));
        const bucket = context.env.STICKERS;
        if (bucket) await deleteUserMedia(bucket, userId, []);
      }
      return { keepPhotos: input.keep };
    }),
};
