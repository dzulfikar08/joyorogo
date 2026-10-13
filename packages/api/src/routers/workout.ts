import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { exerciseLog, profile, weightLog } from "@joyorogo/db/schema/fitness";
import { workoutSession, workoutSet } from "@joyorogo/db/schema/plans";

import type { Database } from "@joyorogo/db";

import { protectedProcedure } from "../index";
import { jakartaToday, shiftDate } from "../lib/engine";
import { dateSchema } from "../lib/schemas";
import { EXERCISE_CATALOG, EQUIPMENT, MUSCLES, exerciseById } from "../lib/exercises";
import {
  type ExercisePR,
  type MissedMuscleWarning,
  type StrengthTrendHint,
  type WorkoutSessionLike,
  WORKOUT_TEMPLATES,
  missedMuscleWarnings,
  personalRecords,
  sessionKcal,
  strengthTrendHint,
  weeklySetsPerMuscle,
} from "../lib/workout";
import { planQueries, buildPlan } from "../lib/plan";

const STRENGTH_TYPE = "angkat_beban";

const setSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  reps: z.number().int().min(1).max(500),
  weightKg: z.number().min(0).max(500).nullable().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
});

const saveSchema = z.object({
  id: z.string().optional(),
  date: dateSchema.optional(),
  name: z.string().min(1).max(120),
  durationMin: z.number().min(1).max(600).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  sets: z.array(setSchema).min(1).max(200),
});

export type WorkoutSessionRow = typeof workoutSession.$inferSelect;
export type WorkoutSetRow = typeof workoutSet.$inferSelect;
export type SessionWithSets = { session: WorkoutSessionRow; sets: WorkoutSetRow[] };

/** One session plus its sets in exercise order; null when not owned by the user. */
async function loadSession(
  db: Database,
  userId: string,
  id: string,
): Promise<SessionWithSets | null> {
  const [session] = await db
    .select()
    .from(workoutSession)
    .where(and(eq(workoutSession.id, id), eq(workoutSession.userId, userId)))
    .limit(1);
  if (!session) return null;
  const sets = await db
    .select()
    .from(workoutSet)
    .where(eq(workoutSet.sessionId, id))
    .orderBy(asc(workoutSet.position));
  return { session, sets };
}

async function listSessionsWithSets(
  db: Database,
  userId: string,
  opts: { from?: string; to?: string; limit: number },
): Promise<SessionWithSets[]> {
  const conditions = [eq(workoutSession.userId, userId)];
  if (opts.from) conditions.push(gte(workoutSession.date, opts.from));
  if (opts.to) conditions.push(lte(workoutSession.date, opts.to));
  const sessions = await db
    .select()
    .from(workoutSession)
    .where(and(...conditions))
    .orderBy(desc(workoutSession.date), desc(workoutSession.createdAt))
    .limit(opts.limit);
  const ids = sessions.map((s) => s.id);
  const sets = ids.length
    ? await db
        .select()
        .from(workoutSet)
        .where(inArray(workoutSet.sessionId, ids))
        .orderBy(asc(workoutSet.sessionId), asc(workoutSet.position))
    : [];
  const bySession = new Map<string, typeof sets>();
  for (const set of sets) {
    const group = bySession.get(set.sessionId) ?? [];
    group.push(set);
    bySession.set(set.sessionId, group);
  }
  return sessions.map((session) => ({ session, sets: bySession.get(session.id) ?? [] }));
}

/** Latest known weight for kcal estimates: newest weigh-in, else onboarding weight. */
async function currentWeightKg(db: Database, userId: string): Promise<number> {
  const [[weighRow], [prof]] = await Promise.all([
    db
      .select({ weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(eq(weightLog.userId, userId))
      .orderBy(desc(weightLog.date))
      .limit(1),
    db
      .select({ startWeightKg: profile.startWeightKg })
      .from(profile)
      .where(eq(profile.userId, userId))
      .limit(1),
  ]);
  return weighRow?.weightKg ?? prof?.startWeightKg ?? 70;
}

export const workoutRouter = {
  catalog: protectedProcedure.handler(() => ({
    exercises: EXERCISE_CATALOG,
    muscles: MUSCLES,
    equipment: EQUIPMENT,
  })),

  templates: protectedProcedure.handler(() => WORKOUT_TEMPLATES),

  listSessions: protectedProcedure
    .input(
      z.object({
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        limit: z.number().int().min(1).max(60).default(20),
      }),
    )
    .handler(async ({ context, input }) => {
      const items = await listSessionsWithSets(context.db, context.session.user.id, input);
      return { items };
    }),

  getSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) =>
      loadSession(context.db, context.session.user.id, input.id),
    ),

  saveSession: protectedProcedure.input(saveSchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const date = input.date ?? jakartaToday();

    const unknown = input.sets.find((set) => !exerciseById(set.exerciseId));
    if (unknown) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Gerakan tidak dikenal: ${unknown.exerciseId}`,
      });
    }
    if (input.sets.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Tambahkan minimal satu set.",
      });
    }

    const kcal =
      input.durationMin != null
        ? sessionKcal(input.durationMin, await currentWeightKg(context.db, userId))
        : 0;
    const mirrorName = `Latihan beban: ${input.name.trim()}`;

    const existing = input.id ? await loadSession(context.db, userId, input.id) : null;
    if (input.id && !existing) {
      throw new ORPCError("NOT_FOUND", { message: "Sesi tidak ditemukan." });
    }

    // The kcal mirror lives in the same batch as the session: id is
    // generated up front (reused on edits), so Burn (exercise_log) and the
    // session are written atomically or not at all.
    const exerciseLogId = existing?.session.exerciseLogId ?? crypto.randomUUID();
    const logStatement = existing?.session.exerciseLogId
      ? context.db
          .update(exerciseLog)
          .set({ date, name: mirrorName, durationMin: input.durationMin ?? null, kcal })
          .where(
            and(eq(exerciseLog.id, existing.session.exerciseLogId), eq(exerciseLog.userId, userId)),
          )
      : context.db.insert(exerciseLog).values({
          id: exerciseLogId,
          userId,
          date,
          type: STRENGTH_TYPE,
          name: mirrorName,
          durationMin: input.durationMin ?? null,
          kcal,
          source: "manual",
        });

    const sessionId = existing?.session.id ?? crypto.randomUUID();
    const setRows = input.sets.map((set, position) => ({
      id: crypto.randomUUID(),
      sessionId,
      userId,
      exerciseId: set.exerciseId,
      position,
      reps: set.reps,
      weightKg: set.weightKg ?? null,
      rpe: set.rpe ?? null,
    }));

    await context.db.batch([
      logStatement,
      context.db
        .insert(workoutSession)
        .values({
          id: sessionId,
          userId,
          date,
          name: input.name.trim(),
          durationMin: input.durationMin ?? null,
          note: input.note ?? null,
          exerciseLogId,
        })
        .onConflictDoUpdate({
          target: workoutSession.id,
          set: {
            date,
            name: input.name.trim(),
            durationMin: input.durationMin ?? null,
            note: input.note ?? null,
            exerciseLogId,
          },
        }),
      context.db.delete(workoutSet).where(eq(workoutSet.sessionId, sessionId)),
      context.db.insert(workoutSet).values(setRows),
    ]);

    return loadSession(context.db, userId, sessionId);
  }),

  deleteSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [session] = await context.db
        .select({ exerciseLogId: workoutSession.exerciseLogId })
        .from(workoutSession)
        .where(and(eq(workoutSession.id, input.id), eq(workoutSession.userId, userId)))
        .limit(1);
      if (!session) {
        throw new ORPCError("NOT_FOUND", { message: "Sesi tidak ditemukan." });
      }
      await context.db.batch([
        context.db.delete(workoutSet).where(eq(workoutSet.sessionId, input.id)),
        context.db
          .delete(workoutSession)
          .where(and(eq(workoutSession.id, input.id), eq(workoutSession.userId, userId))),
        ...(session.exerciseLogId
          ? [
              context.db
                .delete(exerciseLog)
                .where(
                  and(eq(exerciseLog.id, session.exerciseLogId), eq(exerciseLog.userId, userId)),
                ),
            ]
          : []),
      ]);
      return { ok: true };
    }),

  /** "Ulangi sesi terakhir": latest session with its sets, or null. */
  lastSession: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [latest] = await listSessionsWithSets(context.db, userId, { limit: 1 });
    return latest ?? null;
  }),

  /** Beranda muscle map: this week's volumes, warnings, PRs, trend hint. */
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const today = jakartaToday();
    const weekStart = shiftDate(today, -6);
    const historyStart = shiftDate(today, -364);

    const [plan, sessions] = await Promise.all([
      (async () => {
        const [profileRows, latestRows, weighIns, intake, exercise] = await context.db.batch(
          planQueries(context.db, userId, today),
        );
        const prof = profileRows[0];
        if (!prof) return null;
        return buildPlan(
          prof,
          {
            latestWeightKg: latestRows[0]?.weightKg ?? null,
            weighIns,
            intake,
            exercise,
          },
          today,
        );
      })(),
      listSessionsWithSets(context.db, userId, {
        from: historyStart,
        to: today,
        limit: 60,
      }),
    ]);

    const asSessions: WorkoutSessionLike[] = sessions.map((s) => ({
      date: s.session.date,
      sets: s.sets,
    }));

    const weeklyTotals = weeklySetsPerMuscle(asSessions, weekStart, today);
    const weekly = MUSCLES.map((m) => ({
      muscle: m.key,
      label: m.label,
      sets: weeklyTotals[m.key],
    })).sort((a, b) => b.sets - a.sets);

    const warnings: MissedMuscleWarning[] = missedMuscleWarnings(asSessions, today);
    const prs: ExercisePR[] = personalRecords(asSessions).slice(0, 30);
    const trendHint: StrengthTrendHint | null = strengthTrendHint(asSessions, {
      today,
      weeklyWeightChangeKg: plan?.trend?.weeklyRateKg ?? null,
    });

    return {
      weekStart,
      weekly,
      warnings,
      prs,
      trendHint,
      lastSessionDate: sessions[0]?.session.date ?? null,
      sessionCount28d: asSessions.filter((s) => s.date >= shiftDate(today, -27)).length,
    };
  }),
};
