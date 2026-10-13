import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { dailyActivity } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dateSchema } from "../lib/schemas";

// US-013: Health Connect is the primary activity source on Android. The
// client aggregates cumulative metrics through Health Connect itself, so the
// server just persists one normalized rollup row per WIB day.
export const activityRouter = {
  upsert: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        steps: z.number().int().min(0).max(300_000),
        distanceMeters: z.number().min(0).max(500_000),
        activeCalories: z.number().min(0).max(20_000),
        exerciseMinutes: z.number().min(0).max(1440),
        // health_connect (Android) and apple_health (iOS) rows come from
        // on-device imports; the default keeps older clients working.
        source: z.enum(["health_connect", "apple_health"]).default("health_connect"),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(dailyActivity)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date: input.date ?? jakartaToday(),
          steps: input.steps,
          distanceMeters: input.distanceMeters,
          activeCalories: input.activeCalories,
          exerciseMinutes: input.exerciseMinutes,
          source: input.source,
        })
        .onConflictDoUpdate({
          target: [dailyActivity.userId, dailyActivity.date],
          set: {
            steps: input.steps,
            distanceMeters: input.distanceMeters,
            activeCalories: input.activeCalories,
            exerciseMinutes: input.exerciseMinutes,
            source: input.source,
          },
        })
        .returning();
      return row;
    }),

  byDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select()
        .from(dailyActivity)
        .where(
          and(
            eq(dailyActivity.userId, context.session.user.id),
            eq(dailyActivity.date, input.date ?? jakartaToday()),
          ),
        )
        .limit(1);
      return row ?? null;
    }),
};
