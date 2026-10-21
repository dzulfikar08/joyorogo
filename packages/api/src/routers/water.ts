import { and, eq, gte, lte, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import type { DayZone } from "@joyorogo/i18n";
import { profile, waterLog } from "@joyorogo/db/schema/fitness";

import { z } from "zod";

import { protectedProcedure } from "../index";
import { userZone } from "../lib/user-zone";
import { jakartaToday, shiftDate } from "../lib/engine";
import type { ActivityLevel, Gender } from "../lib/engine";
import { computeMaternalTargets, maternalFromRow, maternalNutrient } from "../lib/maternal";
import { dateSchema } from "../lib/schemas";

const GOAL = 8;
/** One glass in the water log, ml (the group view uses the same figure). */
const GLASS_ML = 250;
/** Longest range `water.series` serves (the 30-day chart is the largest the apps ask for). */
const SERIES_MAX_DAYS = 90;
const dateInput = z.object({ date: dateSchema.optional() });

/**
 * Daily glasses to aim for. 8 for everyone; in Hamil / Menyusui the AKG 2019
 * water figure of the stage (2,650 ml for a 26-year-old in pregnancy, which
 * counts water from food too) in whole glasses.
 */
async function waterGoal(db: Database, userId: string, zone: DayZone): Promise<number> {
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
    { today: jakartaToday(undefined, zone) },
  );
  const water = maternalNutrient(targets, "water");
  return water ? Math.round(water.target / GLASS_ML) : GOAL;
}

export const waterRouter = {
  today: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const zone = await userZone(context);
    const [row, goal] = await Promise.all([
      context.db
        .select()
        .from(waterLog)
        .where(
          and(
            eq(waterLog.userId, context.session.user.id),
            eq(waterLog.date, input?.date ?? jakartaToday(undefined, zone)),
          ),
        )
        .limit(1),
      waterGoal(context.db, context.session.user.id, zone),
    ]);
    return { glasses: row[0]?.glasses ?? 0, goal };
  }),

  /**
   * Glasses per day over `from`..`to` (inclusive, at most 90 days) and the daily goal, one row per day. A day
   * with no log is 0, so the trend chart draws it as an empty bar rather than skipping it.
   */
  series: protectedProcedure
    .input(
      z
        .object({ from: dateSchema, to: dateSchema })
        .refine((v) => v.from <= v.to, "from must not be after to")
        .refine((v) => shiftDate(v.to, -SERIES_MAX_DAYS) < v.from, `range is capped at ${SERIES_MAX_DAYS} days`),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const zone = await userZone(context);
      const [rows, goal] = await Promise.all([
        context.db
          .select({ date: waterLog.date, glasses: waterLog.glasses })
          .from(waterLog)
          .where(and(eq(waterLog.userId, userId), gte(waterLog.date, input.from), lte(waterLog.date, input.to))),
        waterGoal(context.db, userId, zone),
      ]);
      const byDate = new Map(rows.map((r) => [r.date, r.glasses]));
      const days: { date: string; glasses: number }[] = [];
      for (let d = input.from; d <= input.to; d = shiftDate(d, 1)) {
        days.push({ date: d, glasses: byDate.get(d) ?? 0 });
      }
      return { goal, days };
    }),

  add: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const zone = await userZone(context);
    const [row] = await context.db
      .insert(waterLog)
      .values({
        userId: context.session.user.id,
        date: input?.date ?? jakartaToday(undefined, zone),
        glasses: 1,
      })
      .onConflictDoUpdate({
        target: [waterLog.userId, waterLog.date],
        set: { glasses: sql`${waterLog.glasses} + 1` },
      })
      .returning();
    return { glasses: row?.glasses ?? 0, goal: await waterGoal(context.db, context.session.user.id, zone) };
  }),

  remove: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const zone = await userZone(context);
    const [row] = await context.db
      .update(waterLog)
      .set({ glasses: sql`max(${waterLog.glasses} - 1, 0)` })
      .where(
        and(
          eq(waterLog.userId, context.session.user.id),
          eq(waterLog.date, input?.date ?? jakartaToday(undefined, zone)),
        ),
      )
      .returning({ glasses: waterLog.glasses });
    return { glasses: row?.glasses ?? 0, goal: await waterGoal(context.db, context.session.user.id, zone) };
  }),
};
