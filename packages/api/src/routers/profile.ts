import { and, eq, isNotNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { LOCALES } from "@joyorogo/i18n";
import { user } from "@joyorogo/db/schema/auth";
import { foodLog, profile, weightLog } from "@joyorogo/db/schema/fitness";

import { deleteUserMedia } from "../lib/privacy";

import type { Database } from "@joyorogo/db";
import type { Targets } from "../lib/engine";

import { protectedProcedure } from "../index";
import { checkTargetDate, computeTargets, jakartaToday, shiftDate } from "../lib/engine";
import { FEEDING_TYPES, NO_MATERNAL, computeMaternalTargets, maternalFromRow, maternalToRow, resolveMaternalInput } from "../lib/maternal";
import type { MaternalState } from "../lib/maternal";
import { dateSchema, maternalInputSchema, profileInputSchema } from "../lib/schemas";
import { buildPlan, planQueries } from "../lib/plan";
import { serverT } from "../lib/messages";
import { effectiveTier } from "../lib/tiers";

/**
 * Entering Hamil / Menyusui: fasting reminders and the public progress page go off.
 * Fasting is not part of these modes, and health data is never shared by default.
 */
const MATERNAL_DEFAULTS = {
  fastingPattern: "off",
  fastingNotify: false,
  shareEnabled: false,
} as const;

/**
 * Hamil / Menyusui compute no weight target, but the columns are NOT NULL: they
 * hold a maintenance target (today's weight) one year out, the plan that applies
 * if the mode ends. No deficit comes from it.
 */
function holdWeight(weightKg: number, today: string) {
  return { targetWeightKg: weightKg, targetDate: shiftDate(today, 365) };
}

/** Today's plan exactly as day.summary computes it (latest weigh-in + measured TDEE). */
async function loadPlan(db: Database, userId: string) {
  const today = jakartaToday();
  const [[userRow], [row], [latest], weighIns, intake, exercise] = await db.batch([
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
    { latestWeightKg: latest?.weightKg ?? null, weighIns, intake, exercise },
    today,
  );
  return { row, plan, tier, founderUntil };
}

export const profileRouter = {
  myProfile: protectedProcedure.handler(async ({ context }) => {
    const { row, plan, tier, founderUntil } = await loadPlan(context.db, context.session.user.id);
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
      }),
    )
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const today = jakartaToday();
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
      const targetWeightKg = held?.targetWeightKg ?? input.targetWeightKg;
      const targetDate = held?.targetDate ?? input.targetDate;
      if (targetWeightKg === undefined || targetDate === undefined) {
        throw new ORPCError("BAD_REQUEST", { message: t("profile.targetDateInvalid") });
      }
      const fields = {
        birthYear: input.birthYear,
        gender: input.gender,
        heightCm: input.heightCm,
        startWeightKg: input.weightKg,
        targetWeightKg,
        targetDate,
        activityLevel: input.activityLevel,
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
      const profileInput = {
        birthYear: input.birthYear,
        gender: input.gender,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        targetWeightKg,
        targetDate,
        activityLevel: input.activityLevel,
      };
      return {
        targets:
          maternal.mode === "none"
            ? computeTargets(profileInput, { weightNow: input.weightKg })
            : computeMaternalTargets(profileInput, maternal, { today, weightNow: input.weightKg }),
      };
    }),

  // Editing the plan from /profil must not touch startWeightKg (the history
  // baseline) — that column is owned by onboarding and weigh-ins.
  updateTargets: protectedProcedure
    .input(
      z.object({
        targetWeightKg: z.number().min(25).max(400),
        targetDate: dateSchema,
      }),
    )
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const { row, plan: current } = await loadPlan(context.db, userId);
      if (!row || !current) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      // A weight edit re-sends the stored date, which may have lapsed; only a
      // date the user is actually changing has to be in the future.
      if (input.targetDate !== row.targetDate) {
        const check = checkTargetDate({
          weightNowKg: current.weightNowKg,
          targetWeightKg: input.targetWeightKg,
          targetDate: input.targetDate,
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
        .set({ targetWeightKg: input.targetWeightKg, targetDate: input.targetDate })
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
      }
      const { plan } = await loadPlan(context.db, userId);
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
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const today = jakartaToday();
      const [[row], [latest], weighIns, intake, exercise] = await context.db.batch(
        planQueries(context.db, userId, today),
      );
      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: serverT(context.locale, "errors")("profile.onboardingRequired"),
        });
      }
      const history = { latestWeightKg: latest?.weightKg ?? null, weighIns, intake, exercise };
      const now = buildPlan(row, history, today);
      const next = buildPlan(
        { ...row, targetWeightKg: input.targetWeightKg, targetDate: input.targetDate },
        history,
        today,
      );
      return {
        check: checkTargetDate({
          weightNowKg: next.weightNowKg,
          targetWeightKg: input.targetWeightKg,
          targetDate: input.targetDate,
        }),
        current: now.targets,
        next: next.targets,
      };
    }),

  // Hamil / Menyusui on or off, from Settings > Profile. Turning it off returns to a
  // maintenance plan (target weight = today's weight): the old weight-loss target
  // pre-dates the pregnancy and is only set again on purpose, after a doctor visit.
  setMaternal: protectedProcedure.input(maternalInputSchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const t = serverT(context.locale, "errors");
    const today = jakartaToday();
    const { row, plan } = await loadPlan(context.db, userId);
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
    const next = await loadPlan(context.db, userId);
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
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const today = jakartaToday();
      const { row, plan } = await loadPlan(context.db, userId);
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
      const next = await loadPlan(context.db, userId);
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
