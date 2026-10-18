import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { exerciseLog, profile, weightLog } from "@joyorogo/db/schema/fitness";
import {
  workoutCustomExercise,
  workoutRoutine,
  workoutSession,
  workoutSet,
} from "@joyorogo/db/schema/plans";

import type { Database } from "@joyorogo/db";

import { serverT } from "../lib/messages";
import { protectedProcedure } from "../index";
import { jakartaToday, shiftDate } from "../lib/engine";
import { dateSchema } from "../lib/schemas";
import {
  EQUIPMENT,
  EXERCISE_CATALOG,
  EXERCISE_TYPES,
  MUSCLES,
  type EquipmentKey,
  type Exercise,
  type ExerciseType,
  type MuscleKey,
} from "../lib/exercises";
import {
  type ExercisePR,
  type MissedMuscleWarning,
  type SetType,
  type StrengthTrendHint,
  type WorkoutSessionLike,
  WORKOUT_TEMPLATES,
  bestSetMetrics,
  missedMuscleWarnings,
  personalRecords,
  sessionKcal,
  sessionPRs,
  strengthTrendHint,
  weeklySetsPerMuscle,
  type WorkoutPR,
} from "../lib/workout";
import { planQueries, buildPlan } from "../lib/plan";

const STRENGTH_TYPE = "angkat_beban";

const MUSCLE_IDS = MUSCLES.map((m) => m.key) as [MuscleKey, ...MuscleKey[]];
const EQUIPMENT_IDS = EQUIPMENT.map((e) => e.key) as [
  EquipmentKey,
  ...EquipmentKey[],
];

const setTypeSchema = z.enum([
  "normal",
  "warmup",
  "drop",
  "failure",
]) satisfies z.ZodType<SetType>;

const setSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  reps: z.number().int().min(1).max(500).nullable().optional(),
  weightKg: z.number().min(0).max(500).nullable().optional(),
  // timed holds (plank, dead hang) log seconds instead of reps
  durationSec: z.number().int().min(1).max(7200).nullable().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
  setType: setTypeSchema.optional(),
  // per-exercise note; clients repeat it on every set row of that exercise
  note: z.string().max(1000).nullable().optional(),
  supersetGroup: z.number().int().min(1).max(99).nullable().optional(),
});

const saveSchema = z.object({
  id: z.string().optional(),
  date: dateSchema.optional(),
  name: z.string().min(1).max(120),
  // ISO timestamp of when the stopwatch started
  startedAt: z.string().max(40).optional(),
  durationMin: z.number().min(1).max(600).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  sets: z.array(setSchema).min(1).max(200),
});

const customExerciseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  muscle: z.enum(MUSCLE_IDS),
  equipment: z.enum(EQUIPMENT_IDS),
  type: z.enum(EXERCISE_TYPES),
});

const routineSetSchema = z.object({
  setType: setTypeSchema.default("normal"),
  reps: z.number().int().min(1).max(500).nullable(),
  weightKg: z.number().min(0).max(500).nullable(),
  durationSec: z.number().int().min(1).max(7200).nullable(),
});

const routineExerciseSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  restSec: z.number().int().min(0).max(600).nullable(),
  note: z.string().max(1000).nullable(),
  sets: z.array(routineSetSchema).min(1).max(20),
});

const routineSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  note: z.string().max(2000).nullable().optional(),
  exercises: z.array(routineExerciseSchema).min(1).max(30),
});

export type WorkoutSessionRow = typeof workoutSession.$inferSelect;
export type WorkoutSetRow = typeof workoutSet.$inferSelect;
export type SessionWithSets = {
  session: WorkoutSessionRow;
  sets: WorkoutSetRow[];
};

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
  return sessions.map((session) => ({
    session,
    sets: bySession.get(session.id) ?? [],
  }));
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

type CustomExerciseRow = typeof workoutCustomExercise.$inferSelect;

/** Catalog movement shape for a user-invented exercise. */
function customRowToExercise(row: CustomExerciseRow): Exercise {
  const muscle = row.muscle as MuscleKey;
  return {
    id: row.id,
    name: row.name,
    equipment: row.equipment as EquipmentKey,
    muscle,
    type: row.type as ExerciseType,
    primary: [muscle],
    secondary: [],
    custom: true,
  };
}

/** Fixed catalog plus the user's own movements — the picker and validation source. */
async function loadCatalog(db: Database, userId: string): Promise<Exercise[]> {
  const custom = await db
    .select()
    .from(workoutCustomExercise)
    .where(eq(workoutCustomExercise.userId, userId));
  return [...EXERCISE_CATALOG, ...custom.map(customRowToExercise)];
}

export type WorkoutSetInput = {
  setType: SetType;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  rpe: number | null;
  note: string | null;
  supersetGroup: number | null;
};

/**
 * Fills defaults and nulls reps for timed movements, so every downstream
 * consumer (rows, PR math) sees one canonical shape.
 */
function normalizeSets(
  sets: z.infer<typeof setSchema>[],
  typeById: Map<string, Exercise>,
): (WorkoutSetInput & { exerciseId: string })[] {
  return sets.map((set) => {
    const exercise = typeById.get(set.exerciseId);
    const timed =
      exercise?.type === "duration" || exercise?.type === "distance_duration";
    return {
      exerciseId: set.exerciseId,
      setType: set.setType ?? "normal",
      reps: timed ? null : (set.reps ?? null),
      weightKg: set.weightKg ?? null,
      durationSec: timed ? (set.durationSec ?? null) : null,
      rpe: set.rpe ?? null,
      note: set.note ?? null,
      supersetGroup: set.supersetGroup ?? null,
    };
  });
}

export const workoutRouter = {
  catalog: protectedProcedure.handler(async ({ context }) => {
    const custom = await context.db
      .select()
      .from(workoutCustomExercise)
      .where(eq(workoutCustomExercise.userId, context.session.user.id));
    return {
      exercises: [...EXERCISE_CATALOG, ...custom.map(customRowToExercise)],
      // `key` is kept alongside `id` so older clients reading .key keep working
      muscles: MUSCLES.map((m) => ({ id: m.key, key: m.key, label: m.label })),
      equipment: EQUIPMENT.map((e) => ({
        id: e.key,
        key: e.key,
        label: e.label,
      })),
    };
  }),

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
      const items = await listSessionsWithSets(
        context.db,
        context.session.user.id,
        input,
      );
      return { items };
    }),

  getSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) =>
      loadSession(context.db, context.session.user.id, input.id),
    ),

  saveSession: protectedProcedure
    .input(saveSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const date = input.date ?? jakartaToday();

      const catalog = await loadCatalog(context.db, userId);
      const catalogById = new Map(
        catalog.map((exercise) => [exercise.id, exercise]),
      );
      for (const set of input.sets) {
        const exercise = catalogById.get(set.exerciseId);
        if (!exercise) {
          throw new ORPCError("BAD_REQUEST", {
            message: serverT(context.locale, "olahraga")(
              "server.workout.unknownExercise",
              { id: set.exerciseId },
            ),
          });
        }
        const timed =
          exercise.type === "duration" || exercise.type === "distance_duration";
        if (timed && set.durationSec == null) {
          throw new ORPCError("BAD_REQUEST", {
            message: serverT(context.locale, "olahraga")(
              "server.workout.needsDuration",
              { name: exercise.name },
            ),
          });
        }
        if (!timed && set.reps == null) {
          throw new ORPCError("BAD_REQUEST", {
            message: serverT(context.locale, "olahraga")(
              "server.workout.needsReps",
              { name: exercise.name },
            ),
          });
        }
      }

      let startedAt: Date | null = null;
      if (input.startedAt !== undefined) {
        startedAt = new Date(input.startedAt);
        if (Number.isNaN(startedAt.getTime())) {
          throw new ORPCError("BAD_REQUEST", {
            message: serverT(
              context.locale,
              "olahraga",
            )("server.workout.invalidStart"),
          });
        }
      }

      const kcal =
        input.durationMin != null
          ? sessionKcal(
              input.durationMin,
              await currentWeightKg(context.db, userId),
            )
          : 0;
      const mirrorName = `Latihan beban: ${input.name.trim()}`;

      const existing = input.id
        ? await loadSession(context.db, userId, input.id)
        : null;
      if (input.id && !existing) {
        throw new ORPCError("NOT_FOUND", {
          message: serverT(
            context.locale,
            "olahraga",
          )("server.workout.sessionNotFound"),
        });
      }

      const sets = normalizeSets(input.sets, catalogById);

      // Records are measured against every other saved session (the session
      // being edited is excluded), never against warmup sets.
      const sessionId = existing?.session.id ?? crypto.randomUUID();
      const priorSessions = (
        await listSessionsWithSets(context.db, userId, { limit: 500 })
      )
        .filter((session) => session.session.id !== sessionId)
        .map((session) => ({ sets: session.sets }));
      const prs: WorkoutPR[] = sessionPRs(priorSessions, sets);

      // The kcal mirror lives in the same batch as the session: id is
      // generated up front (reused on edits), so Burn (exercise_log) and the
      // session are written atomically or not at all.
      const exerciseLogId =
        existing?.session.exerciseLogId ?? crypto.randomUUID();
      const logStatement = existing?.session.exerciseLogId
        ? context.db
            .update(exerciseLog)
            .set({
              date,
              name: mirrorName,
              durationMin: input.durationMin ?? null,
              kcal,
            })
            .where(
              and(
                eq(exerciseLog.id, existing.session.exerciseLogId),
                eq(exerciseLog.userId, userId),
              ),
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

      const setRows = sets.map((set, position) => ({
        id: crypto.randomUUID(),
        sessionId,
        userId,
        exerciseId: set.exerciseId,
        position,
        reps: set.reps,
        weightKg: set.weightKg,
        durationSec: set.durationSec,
        rpe: set.rpe,
        setType: set.setType,
        note: set.note,
        supersetGroup: set.supersetGroup,
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
            startedAt,
            durationMin: input.durationMin ?? null,
            note: input.note ?? null,
            exerciseLogId,
          })
          .onConflictDoUpdate({
            target: workoutSession.id,
            set: {
              date,
              name: input.name.trim(),
              startedAt,
              durationMin: input.durationMin ?? null,
              note: input.note ?? null,
              exerciseLogId,
            },
          }),
        context.db
          .delete(workoutSet)
          .where(eq(workoutSet.sessionId, sessionId)),
        context.db.insert(workoutSet).values(setRows),
      ]);

      // session+sets keep old clients working; id+prs are the v2 contract.
      const saved = await loadSession(context.db, userId, sessionId);
      if (!saved) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: serverT(
            context.locale,
            "olahraga",
          )("server.workout.saveFailed"),
        });
      }
      return { ...saved, id: sessionId, prs };
    }),

  deleteSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [session] = await context.db
        .select({ exerciseLogId: workoutSession.exerciseLogId })
        .from(workoutSession)
        .where(
          and(
            eq(workoutSession.id, input.id),
            eq(workoutSession.userId, userId),
          ),
        )
        .limit(1);
      if (!session) {
        throw new ORPCError("NOT_FOUND", {
          message: serverT(
            context.locale,
            "olahraga",
          )("server.workout.sessionNotFound"),
        });
      }
      await context.db.batch([
        context.db.delete(workoutSet).where(eq(workoutSet.sessionId, input.id)),
        context.db
          .delete(workoutSession)
          .where(
            and(
              eq(workoutSession.id, input.id),
              eq(workoutSession.userId, userId),
            ),
          ),
        ...(session.exerciseLogId
          ? [
              context.db
                .delete(exerciseLog)
                .where(
                  and(
                    eq(exerciseLog.id, session.exerciseLogId),
                    eq(exerciseLog.userId, userId),
                  ),
                ),
            ]
          : []),
      ]);
      return { ok: true };
    }),

  /** "Ulangi sesi terakhir": latest session with its sets, or null. */
  lastSession: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [latest] = await listSessionsWithSets(context.db, userId, {
      limit: 1,
    });
    return latest ?? null;
  }),

  /** SEBELUMNYA column: each exercise's sets from its most recent session. */
  previous: protectedProcedure
    .input(
      z.object({
        exerciseIds: z.array(z.string().min(1).max(100)).min(1).max(100),
      }),
    )
    .handler(async ({ context, input }) => {
      const uniqueIds = [...new Set(input.exerciseIds)];
      const rows = await context.db
        .select({
          sessionId: workoutSet.sessionId,
          exerciseId: workoutSet.exerciseId,
          setType: workoutSet.setType,
          reps: workoutSet.reps,
          weightKg: workoutSet.weightKg,
          durationSec: workoutSet.durationSec,
        })
        .from(workoutSet)
        .innerJoin(workoutSession, eq(workoutSet.sessionId, workoutSession.id))
        .where(
          and(
            eq(workoutSet.userId, context.session.user.id),
            inArray(workoutSet.exerciseId, uniqueIds),
          ),
        )
        // newest session first, sets within a session in logged order
        .orderBy(
          desc(workoutSession.date),
          desc(workoutSession.createdAt),
          asc(workoutSet.position),
        )
        .limit(4000);
      const takenSession = new Map<string, string>();
      const result: Record<
        string,
        {
          setType: string;
          reps: number | null;
          weightKg: number | null;
          durationSec: number | null;
        }[]
      > = {};
      for (const row of rows) {
        const session = takenSession.get(row.exerciseId);
        if (session === undefined)
          takenSession.set(row.exerciseId, row.sessionId);
        else if (session !== row.sessionId) continue;
        const group = result[row.exerciseId] ?? [];
        group.push({
          setType: row.setType,
          reps: row.reps,
          weightKg: row.weightKg,
          durationSec: row.durationSec,
        });
        result[row.exerciseId] = group;
      }
      return result;
    }),

  /** Per-exercise history: sets per session, best records, e1RM chart line. */
  exerciseHistory: protectedProcedure
    .input(
      z.object({
        exerciseId: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(50).default(50),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const sessions = await context.db
        .selectDistinct({ id: workoutSession.id, date: workoutSession.date })
        .from(workoutSession)
        .innerJoin(workoutSet, eq(workoutSet.sessionId, workoutSession.id))
        .where(
          and(
            eq(workoutSession.userId, userId),
            eq(workoutSet.exerciseId, input.exerciseId),
          ),
        )
        .orderBy(desc(workoutSession.date))
        .limit(input.limit);
      const ids = sessions.map((session) => session.id);
      const sets = ids.length
        ? await context.db
            .select()
            .from(workoutSet)
            .where(
              and(
                inArray(workoutSet.sessionId, ids),
                eq(workoutSet.exerciseId, input.exerciseId),
              ),
            )
            .orderBy(asc(workoutSet.sessionId), asc(workoutSet.position))
        : [];
      const bySession = new Map<string, typeof sets>();
      for (const set of sets) {
        const group = bySession.get(set.sessionId) ?? [];
        group.push(set);
        bySession.set(set.sessionId, group);
      }
      const items = sessions.map((session) => ({
        sessionId: session.id,
        date: session.date,
        sets: bySession.get(session.id) ?? [],
      }));

      const best = bestSetMetrics(items.flatMap((item) => item.sets));
      // chart line runs oldest -> newest and skips sessions with no weighted set
      const oneRmByDate = [...items].reverse().flatMap((item) => {
        const oneRm = bestSetMetrics(item.sets).oneRm;
        return oneRm === null ? [] : [{ date: item.date, oneRm }];
      });
      return { sessions: items, best, oneRmByDate };
    }),

  createCustomExercise: protectedProcedure
    .input(customExerciseSchema)
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(workoutCustomExercise)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          name: input.name,
          muscle: input.muscle,
          equipment: input.equipment,
          type: input.type,
        })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: serverT(
            context.locale,
            "olahraga",
          )("server.workout.exerciseCreateFailed"),
        });
      }
      return customRowToExercise(row);
    }),

  deleteCustomExercise: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({ id: workoutCustomExercise.id })
        .from(workoutCustomExercise)
        .where(
          and(
            eq(workoutCustomExercise.id, input.id),
            eq(workoutCustomExercise.userId, context.session.user.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: serverT(
            context.locale,
            "olahraga",
          )("server.workout.exerciseNotFound"),
        });
      }
      await context.db
        .delete(workoutCustomExercise)
        .where(
          and(
            eq(workoutCustomExercise.id, input.id),
            eq(workoutCustomExercise.userId, context.session.user.id),
          ),
        );
      return { ok: true };
    }),

  routines: {
    listRoutines: protectedProcedure.handler(async ({ context }) => {
      const rows = await context.db
        .select()
        .from(workoutRoutine)
        .where(eq(workoutRoutine.userId, context.session.user.id))
        .orderBy(desc(workoutRoutine.updatedAt));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        note: row.note,
        exercises: row.exercises,
        updatedAt: row.updatedAt.toISOString(),
      }));
    }),

    saveRoutine: protectedProcedure
      .input(routineSchema)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const catalog = await loadCatalog(context.db, userId);
        const knownIds = new Set(catalog.map((exercise) => exercise.id));
        const unknown = input.exercises.find(
          (exercise) => !knownIds.has(exercise.exerciseId),
        );
        if (unknown) {
          throw new ORPCError("BAD_REQUEST", {
            message: serverT(context.locale, "olahraga")(
              "server.workout.unknownExercise",
              { id: unknown.exerciseId },
            ),
          });
        }
        const exercises = input.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          restSec: exercise.restSec,
          note: exercise.note,
          sets: exercise.sets.map((set) => ({
            setType: set.setType,
            reps: set.reps,
            weightKg: set.weightKg,
            durationSec: set.durationSec,
          })),
        }));

        if (input.id !== undefined) {
          const [owned] = await context.db
            .select({ id: workoutRoutine.id })
            .from(workoutRoutine)
            .where(
              and(
                eq(workoutRoutine.id, input.id),
                eq(workoutRoutine.userId, userId),
              ),
            )
            .limit(1);
          if (!owned) {
            throw new ORPCError("NOT_FOUND", {
              message: serverT(
                context.locale,
                "olahraga",
              )("server.workout.routineNotFound"),
            });
          }
          await context.db
            .update(workoutRoutine)
            .set({
              name: input.name,
              note: input.note ?? null,
              exercises,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workoutRoutine.id, input.id),
                eq(workoutRoutine.userId, userId),
              ),
            );
          return { id: input.id };
        }

        const id = crypto.randomUUID();
        await context.db.insert(workoutRoutine).values({
          id,
          userId,
          name: input.name,
          note: input.note ?? null,
          exercises,
        });
        return { id };
      }),

    deleteRoutine: protectedProcedure
      .input(z.object({ id: z.string() }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [owned] = await context.db
          .select({ id: workoutRoutine.id })
          .from(workoutRoutine)
          .where(
            and(
              eq(workoutRoutine.id, input.id),
              eq(workoutRoutine.userId, userId),
            ),
          )
          .limit(1);
        if (!owned) {
          throw new ORPCError("NOT_FOUND", {
            message: serverT(
              context.locale,
              "olahraga",
            )("server.workout.routineNotFound"),
          });
        }
        await context.db
          .delete(workoutRoutine)
          .where(
            and(
              eq(workoutRoutine.id, input.id),
              eq(workoutRoutine.userId, userId),
            ),
          );
        return { ok: true };
      }),
  },

  /** Beranda muscle map: this week's volumes, warnings, PRs, trend hint. */
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const today = jakartaToday();
    const weekStart = shiftDate(today, -6);
    const historyStart = shiftDate(today, -364);

    const [plan, sessions] = await Promise.all([
      (async () => {
        const [profileRows, latestRows, weighIns, intake, exercise] =
          await context.db.batch(planQueries(context.db, userId, today));
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

    const warnings: MissedMuscleWarning[] = missedMuscleWarnings(
      asSessions,
      today,
    );
    const prs: ExercisePR[] = personalRecords(asSessions).slice(0, 30);
    // "Slow the cut" has no meaning under a Naikin BB plan (and Hamil / Menyusui have no trend at all).
    const trendHint: StrengthTrendHint | null = strengthTrendHint(asSessions, {
      today,
      weeklyWeightChangeKg: plan?.targets.gain ? null : (plan?.trend?.weeklyRateKg ?? null),
    });

    return {
      weekStart,
      weekly,
      warnings,
      prs,
      trendHint,
      lastSessionDate: sessions[0]?.session.date ?? null,
      sessionCount28d: asSessions.filter((s) => s.date >= shiftDate(today, -27))
        .length,
    };
  }),
};
