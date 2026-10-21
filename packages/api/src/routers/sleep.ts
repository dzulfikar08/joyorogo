import { and, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { sleepLog } from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";

import { protectedProcedure } from "../index";
import { userZone } from "../lib/user-zone";
import { shiftDate, wibYesterday } from "../lib/engine";
import { dateSchema } from "../lib/schemas";
import { WATCH_SLEEP_SOURCE, pickNightSleep } from "../lib/sleep-night";

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
      const zone = await userZone(context);
      const [row] = await context.db
        .insert(sleepLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          // "Tidur tadi malam" — a sleep entry belongs to the WIB day whose
          // morning it ended, so the default key is yesterday, not today.
          date: input.date ?? wibYesterday(undefined, zone),
          hours: input.hours,
          source: input.source,
        })
        .onConflictDoUpdate({
          target: [sleepLog.userId, sleepLog.date],
          set: { hours: input.hours, source: input.source },
          // Manual rows are only ever replaced by the user's own manual
          // edit; an import sync may refresh rows of its own source.
          // A reading from the other import source (Health Connect vs Apple Health, two phones) replaces it only
          // when it is longer: one body sleeps once, and the fuller night is the better record.
          ...(input.source === "manual"
            ? {}
            : {
                setWhere: or(
                  eq(sleepLog.source, input.source),
                  and(ne(sleepLog.source, "manual"), sql`${input.hours} > ${sleepLog.hours}`),
                ),
              }),
        })
        .returning();
      // Empty when the conflict target was a manual row that imports must not clobber.
      return row ?? null;
    }),

  /**
   * The night keyed `date` (the WIB day it started, yesterday by default). It is the sleep_log row; when the person has
   * no manual entry and JoyoFit measured hours for the morning that night ended, those hours come back as a row with
   * source 'joyofit' (see pickNightSleep), so the Tidur screen shows what the watch recorded.
   */
  getForDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const date = input.date ?? wibYesterday(undefined, zone);
      const [logRows, scoreRows] = await context.db.batch([
        context.db
          .select()
          .from(sleepLog)
          .where(and(eq(sleepLog.userId, userId), eq(sleepLog.date, date)))
          .limit(1),
        context.db
          .select({ sleepHours: fitnessScore.sleepHours, updatedAt: fitnessScore.updatedAt })
          .from(fitnessScore)
          .where(and(eq(fitnessScore.userId, userId), eq(fitnessScore.date, shiftDate(date, 1))))
          .limit(1),
      ]);
      const row = logRows[0];
      const score = scoreRows[0];
      const night = pickNightSleep(row, score?.sleepHours);
      if (!night) return null;
      if (!score || night.source !== WATCH_SLEEP_SOURCE) return row ?? null;
      return {
        id: `${WATCH_SLEEP_SOURCE}:${date}`,
        userId,
        date,
        hours: night.hours,
        source: night.source,
        createdAt: score.updatedAt,
      };
    }),
};
