import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { sleepLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { wibYesterday } from "../lib/engine";
import { dateSchema } from "../lib/schemas";

export const sleepRouter = {
  log: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        hours: z.number().min(0).max(24),
        // US-013: imports fill gaps and refresh their own rows; a manual
        // entry is explicit user intent and is never auto-overwritten.
        source: z.enum(["manual", "health_connect", "apple_health"]).default("manual"),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(sleepLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          // "Tidur tadi malam" — a sleep entry belongs to the WIB day whose
          // morning it ended, so the default key is yesterday, not today.
          date: input.date ?? wibYesterday(),
          hours: input.hours,
          source: input.source,
        })
        .onConflictDoUpdate({
          target: [sleepLog.userId, sleepLog.date],
          set: { hours: input.hours, source: input.source },
          // Manual rows are only ever replaced by the user's own manual
          // edit; an import sync may refresh rows of its own source.
          ...(input.source === "manual" ? {} : { setWhere: eq(sleepLog.source, input.source) }),
        })
        .returning();
      // Empty when the conflict target was a manual row that imports must not clobber.
      return row ?? null;
    }),

  getForDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select()
        .from(sleepLog)
        .where(
          and(
            eq(sleepLog.userId, context.session.user.id),
            eq(sleepLog.date, input.date ?? wibYesterday()),
          ),
        )
        .limit(1);
      return row ?? null;
    }),
};
