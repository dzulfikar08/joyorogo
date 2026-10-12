import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { profile, waistLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import type { Gender } from "../lib/engine";
import { dateSchema } from "../lib/schemas";
import { assessWaist } from "../lib/waist";

export const waistRouter = {
  checkIn: protectedProcedure
    .input(
      z.object({
        waistCm: z.number().min(40).max(250),
        date: dateSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(waistLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date: input.date ?? jakartaToday(),
          waistCm: input.waistCm,
        })
        .onConflictDoUpdate({
          target: [waistLog.userId, waistLog.date],
          set: { waistCm: input.waistCm },
        })
        .returning();
      return row;
    }),

  /** Entries oldest first, plus the assessment of the latest one (null without a profile). */
  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(365).default(90) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [rows, [prof]] = await Promise.all([
        context.db
          .select()
          .from(waistLog)
          .where(eq(waistLog.userId, userId))
          .orderBy(desc(waistLog.date))
          .limit(input.limit),
        context.db
          .select({ gender: profile.gender, heightCm: profile.heightCm })
          .from(profile)
          .where(eq(profile.userId, userId))
          .limit(1),
      ]);
      const entries = rows.toReversed();
      const first = entries[0];
      const latest = entries.at(-1);
      return {
        entries,
        loggedToday: latest?.date === jakartaToday(),
        deltaCm:
          first && latest && first !== latest
            ? Math.round((latest.waistCm - first.waistCm) * 10) / 10
            : null,
        assessment:
          latest && prof ? assessWaist(latest.waistCm, prof.gender as Gender, prof.heightCm) : null,
      };
    }),
};
