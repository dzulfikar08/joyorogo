import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { profile, waterLog } from "@joyorogo/db/schema/fitness";

import { z } from "zod";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import type { ActivityLevel, Gender } from "../lib/engine";
import { computeMaternalTargets, maternalFromRow, maternalNutrient } from "../lib/maternal";
import { dateSchema } from "../lib/schemas";

const GOAL = 8;
/** One glass in the water log, ml (the group view uses the same figure). */
const GLASS_ML = 250;
const dateInput = z.object({ date: dateSchema.optional() });

/**
 * Daily glasses to aim for. 8 for everyone; in Hamil / Menyusui the AKG 2019
 * water figure of the stage (2,650 ml for a 26-year-old in pregnancy, which
 * counts water from food too) in whole glasses.
 */
async function waterGoal(db: Database, userId: string): Promise<number> {
  const [row] = await db.select().from(profile).where(eq(profile.userId, userId)).limit(1);
  if (!row) return GOAL;
  const maternal = maternalFromRow(row);
  if (maternal.mode === "none") return GOAL;
  const targets = computeMaternalTargets(
    {
      birthYear: row.birthYear,
      gender: row.gender as Gender,
      heightCm: row.heightCm,
      weightKg: row.startWeightKg,
      targetWeightKg: row.targetWeightKg,
      targetDate: row.targetDate,
      activityLevel: row.activityLevel as ActivityLevel,
    },
    maternal,
  );
  const water = maternalNutrient(targets, "water");
  return water ? Math.round(water.target / GLASS_ML) : GOAL;
}

export const waterRouter = {
  today: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const [row, goal] = await Promise.all([
      context.db
        .select()
        .from(waterLog)
        .where(
          and(
            eq(waterLog.userId, context.session.user.id),
            eq(waterLog.date, input?.date ?? jakartaToday()),
          ),
        )
        .limit(1),
      waterGoal(context.db, context.session.user.id),
    ]);
    return { glasses: row[0]?.glasses ?? 0, goal };
  }),

  add: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const [row] = await context.db
      .insert(waterLog)
      .values({
        userId: context.session.user.id,
        date: input?.date ?? jakartaToday(),
        glasses: 1,
      })
      .onConflictDoUpdate({
        target: [waterLog.userId, waterLog.date],
        set: { glasses: sql`${waterLog.glasses} + 1` },
      })
      .returning();
    return { glasses: row?.glasses ?? 0, goal: await waterGoal(context.db, context.session.user.id) };
  }),

  remove: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const [row] = await context.db
      .update(waterLog)
      .set({ glasses: sql`max(${waterLog.glasses} - 1, 0)` })
      .where(
        and(
          eq(waterLog.userId, context.session.user.id),
          eq(waterLog.date, input?.date ?? jakartaToday()),
        ),
      )
      .returning({ glasses: waterLog.glasses });
    return { glasses: row?.glasses ?? 0, goal: await waterGoal(context.db, context.session.user.id) };
  }),
};
