import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { profile, weightLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dateSchema } from "../lib/schemas";

export const weightRouter = {
  checkIn: protectedProcedure
    .input(
      z.object({
        weightKg: z.number().min(25).max(400),
        date: dateSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(weightLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date: input.date ?? jakartaToday(),
          weightKg: input.weightKg,
        })
        .onConflictDoUpdate({
          target: [weightLog.userId, weightLog.date],
          set: { weightKg: input.weightKg },
        })
        .returning();
      return row;
    }),

  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(365).default(90) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const rows = await context.db
        .select()
        .from(weightLog)
        .where(eq(weightLog.userId, userId))
        .orderBy(desc(weightLog.date))
        .limit(input.limit);
      const entries = rows.toReversed();
      const first = entries[0];
      const latest = entries.at(-1);
      if (!first || !latest) {
        return {
          entries,
          summary: {
            startKg: null,
            latestKg: null,
            deltaKg: null,
            remainingKg: null,
            targetKg: null,
          },
        };
      }
      const [prof] = await context.db
        .select()
        .from(profile)
        .where(eq(profile.userId, userId))
        .limit(1);
      const startKg = prof?.startWeightKg ?? first.weightKg;
      return {
        entries,
        summary: {
          startKg,
          latestKg: latest.weightKg,
          deltaKg: Math.round((latest.weightKg - startKg) * 10) / 10,
          remainingKg: prof ? Math.round((latest.weightKg - prof.targetWeightKg) * 10) / 10 : null,
          targetKg: prof?.targetWeightKg ?? null,
        },
      };
    }),
};
