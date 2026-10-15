import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fitnessScore } from "@joyorogo/db/schema/joyofit";

import { protectedProcedure } from "../index";
import { jakartaToday, shiftDate } from "../lib/engine";
import { READINESS_LABELS } from "../lib/fitness-hint";
import { dateSchema } from "../lib/schemas";

// JoyoFit pushes its last few days after every sync; 14 leaves room for a
// phone that was offline for a while and still stays well under D1's limits.
const MAX_DAYS_PER_PUSH = 14;
// Scores are recent history, not an archive: older or far-future keys are
// refused (one day ahead absorbs a phone clock that is slightly fast).
const PAST_WINDOW_DAYS = 60;

const scoreDateSchema = dateSchema.refine((date) => {
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return false;
  const today = jakartaToday();
  return date <= shiftDate(today, 1) && date >= shiftDate(today, -PAST_WINDOW_DAYS);
}, `Date must be a real day between ${PAST_WINDOW_DAYS} days ago and tomorrow`);

const dayInput = z.object({
  date: scoreDateSchema,
  recoveryPct: z.number().int().min(0).max(100).nullish(),
  strain: z.number().min(0).max(21).nullish(),
  sleepPct: z.number().int().min(0).max(300).nullish(),
  readiness: z.enum(READINESS_LABELS).nullish(),
});

export const fitnessRouter = {
  /**
   * Stores a batch of JoyoFit days. A score left out (or null) keeps whatever is
   * already stored for that day, so a past day pushed with strain only never
   * wipes the recovery pushed on the morning of that day.
   */
  upsertScores: protectedProcedure
    .input(z.object({ days: z.array(dayInput).min(1).max(MAX_DAYS_PER_PUSH) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      // The last entry wins when a batch repeats a date.
      const byDate = new Map(input.days.map((day) => [day.date, day]));
      const statements = [...byDate.values()].map((day) =>
        context.db
          .insert(fitnessScore)
          .values({
            id: crypto.randomUUID(),
            userId,
            date: day.date,
            recoveryPct: day.recoveryPct ?? null,
            strain: day.strain ?? null,
            sleepPct: day.sleepPct ?? null,
            readiness: day.readiness ?? null,
            source: "joyofit",
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [fitnessScore.userId, fitnessScore.date],
            set: {
              recoveryPct: sql`coalesce(excluded.recovery_pct, ${fitnessScore.recoveryPct})`,
              strain: sql`coalesce(excluded.strain, ${fitnessScore.strain})`,
              sleepPct: sql`coalesce(excluded.sleep_pct, ${fitnessScore.sleepPct})`,
              readiness: sql`coalesce(excluded.readiness, ${fitnessScore.readiness})`,
              source: "joyofit",
              updatedAt: new Date(),
            },
          }),
      );
      // min(1) guarantees a statement; drizzle's tuple type can't see it.
      await context.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
      return { saved: statements.length };
    }),

  /** The JoyoFit scores of one WIB day (today by default), or null when none were pushed. */
  byDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({
          date: fitnessScore.date,
          recoveryPct: fitnessScore.recoveryPct,
          strain: fitnessScore.strain,
          sleepPct: fitnessScore.sleepPct,
          readiness: fitnessScore.readiness,
          source: fitnessScore.source,
          updatedAt: fitnessScore.updatedAt,
        })
        .from(fitnessScore)
        .where(
          and(
            eq(fitnessScore.userId, context.session.user.id),
            eq(fitnessScore.date, input.date ?? jakartaToday()),
          ),
        )
        .limit(1);
      if (!row) return null;
      // readiness is free text in the column; only JoyoFit's four words reach clients.
      const readiness = READINESS_LABELS.find((label) => label === row.readiness) ?? null;
      return { ...row, readiness };
    }),
};
