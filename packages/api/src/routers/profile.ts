import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";
import { profile, weightLog } from "@joyorogo/db/schema/fitness";

import type { Database } from "@joyorogo/db";
import type { Targets } from "../lib/engine";

import { protectedProcedure } from "../index";
import { computeTargets, jakartaToday } from "../lib/engine";
import { dateSchema, profileInputSchema } from "../lib/schemas";
import { buildPlan, planQueries } from "../lib/plan";
import { effectiveTier } from "../lib/tiers";

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
        throw new ORPCError("NOT_FOUND", { message: "Lengkapi onboarding dulu ya." });
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
    .input(profileInputSchema)
    .handler(async ({ context, input }): Promise<{ targets: Targets }> => {
      const userId = context.session.user.id;
      const fields = {
        birthYear: input.birthYear,
        gender: input.gender,
        heightCm: input.heightCm,
        startWeightKg: input.weightKg,
        targetWeightKg: input.targetWeightKg,
        targetDate: input.targetDate,
        activityLevel: input.activityLevel,
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
            date: jakartaToday(),
            weightKg: input.weightKg,
          })
          .onConflictDoUpdate({
            target: [weightLog.userId, weightLog.date],
            set: { weightKg: input.weightKg },
          }),
      ]);
      return { targets: computeTargets(input, { weightNow: input.weightKg }) };
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
      const updated = await context.db
        .update(profile)
        .set({ targetWeightKg: input.targetWeightKg, targetDate: input.targetDate })
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: "Lengkapi onboarding dulu." });
      }
      const { plan } = await loadPlan(context.db, userId);
      if (!plan) throw new ORPCError("NOT_FOUND", { message: "Lengkapi onboarding dulu." });
      return { targets: plan.targets };
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
};
