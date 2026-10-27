import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { exerciseLog } from "@joyorogo/db/schema/fitness";
import { workoutSession } from "@joyorogo/db/schema/plans";

import { protectedProcedure } from "../index";
import { WRITE_BADGE, awardOnWrite } from "../lib/badge-store";
import { userZone } from "../lib/user-zone";
import { jakartaToday, shiftDate } from "../lib/engine";
import {
  EXERCISE_MAX_DURATION,
  EXERCISE_MAX_KCAL,
  EXERCISE_MIN_DURATION,
} from "../lib/exercise-edit";
import { serverT } from "../lib/messages";
import { dateSchema, pastDateSchema } from "../lib/schemas";
import { absorbingRow, isWatchExternalId } from "../lib/import-dedupe";
import { EXERCISE_TYPES } from "../lib/met";

/**
 * The row that already stands for a workout arriving from `from` (see `absorbingRow`), read from the candidate's day. Used so
 * a watch workout that reaches the diary twice, as JoyoFit's own row (`watch:<start>`) and as a Health Connect / Apple Health
 * import, is stored once. The absorbed side is not stored; the caller returns the row that stands for it instead.
 */
async function workoutAbsorbedBy(
  db: Database,
  userId: string,
  from: "watch" | "imported",
  candidate: { date: string; type?: string | undefined; durationMin?: number | undefined },
): Promise<typeof exerciseLog.$inferSelect | null> {
  if (candidate.type === undefined || candidate.durationMin === undefined) return null;
  const rows = await db
    .select()
    .from(exerciseLog)
    .where(
      and(
        eq(exerciseLog.userId, userId),
        eq(exerciseLog.date, candidate.date),
        inArray(exerciseLog.source, ["joyofit", "health_connect", "apple_health"]),
      ),
    );
  const watchRows = rows.filter((row) => row.source === "joyofit" && isWatchExternalId(row.externalId));
  const importedRows = rows.filter((row) => row.source !== "joyofit");
  return absorbingRow(
    { date: candidate.date, type: candidate.type, durationMin: candidate.durationMin },
    from,
    watchRows,
    importedRows,
  );
}

export const exerciseRouter = {
  add: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        type: z.string().max(50).optional(),
        name: z.string().min(1).max(200),
        durationMin: z.number().min(EXERCISE_MIN_DURATION).max(EXERCISE_MAX_DURATION).optional(),
        kcal: z.number().min(0).max(EXERCISE_MAX_KCAL),
        // Import rows (health_connect, apple_health) come from on-device
        // syncs; manual is the default
        source: z.enum(["manual", "health_connect", "apple_health"]).default("manual"),
        externalId: z.string().max(200).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const userId = context.session.user.id;
      const date = input.date ?? jakartaToday(undefined, zone);
      if (input.source !== "manual") {
        const absorber = await workoutAbsorbedBy(context.db, userId, "imported", {
          date,
          type: input.type,
          durationMin: input.durationMin,
        });
        if (absorber) return absorber;
      }
      const [row] = await context.db
        .insert(exerciseLog)
        .values({
          id: crypto.randomUUID(),
          userId,
          date,
          type: input.type,
          name: input.name,
          durationMin: input.durationMin ?? null,
          kcal: input.kcal,
          source: input.source,
          externalId: input.externalId,
        })
        .returning();
      // "Latihan pertama": only a device-written workout counts (a typed-in row is not verified).
      if (input.source !== "manual") context.waitUntil(awardOnWrite(context.db, context.env, userId, WRITE_BADGE.workout));
      return row;
    }),

  // Strength workouts logged in JoyoFit: one row per workout, `strength:<workout id>` as externalId, so a re-sent or
  // edited workout updates its row instead of adding a second one. Not Pro gated (same as Health Connect rows).
  upsertJoyofit: protectedProcedure
    .input(
      z.object({
        externalId: z.string().min(1).max(100),
        date: dateSchema,
        name: z.string().min(1).max(200),
        durationMin: z.number().min(EXERCISE_MIN_DURATION).max(EXERCISE_MAX_DURATION),
        kcal: z.number().min(0).max(EXERCISE_MAX_KCAL),
        type: z.string().max(50).default("angkat_beban"),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (isWatchExternalId(input.externalId)) {
        const [existing] = await context.db
          .select({ id: exerciseLog.id })
          .from(exerciseLog)
          .where(
            and(
              eq(exerciseLog.userId, userId),
              eq(exerciseLog.source, "joyofit"),
              eq(exerciseLog.externalId, input.externalId),
            ),
          )
          .limit(1);
        if (!existing) {
          const absorber = await workoutAbsorbedBy(context.db, userId, "watch", input);
          if (absorber) return absorber;
        }
      }
      const [row] = await context.db
        .insert(exerciseLog)
        .values({
          id: crypto.randomUUID(),
          userId,
          date: input.date,
          type: input.type,
          name: input.name,
          durationMin: input.durationMin,
          kcal: input.kcal,
          source: "joyofit",
          externalId: input.externalId,
        })
        .onConflictDoUpdate({
          target: [exerciseLog.userId, exerciseLog.source, exerciseLog.externalId],
          set: { date: input.date, name: input.name, durationMin: input.durationMin, kcal: input.kcal },
        })
        .returning();
      context.waitUntil(awardOnWrite(context.db, context.env, userId, WRITE_BADGE.workout));
      return row;
    }),

  removeJoyofit: protectedProcedure
    .input(z.object({ externalId: z.string().min(1).max(100) }))
    .handler(async ({ context, input }) => {
      await context.db
        .delete(exerciseLog)
        .where(
          and(
            eq(exerciseLog.userId, context.session.user.id),
            eq(exerciseLog.source, "joyofit"),
            eq(exerciseLog.externalId, input.externalId),
          ),
        );
      return { ok: true };
    }),

  // Edits one logged activity: name, duration, kcal and/or day (WIB key).
  // Every field is optional but at least one must be present; durationMin
  // null clears the duration. The row keeps source and externalId, so an
  // imported row (health_connect, apple_health, strava) stays matched to its
  // external workout: all three syncs dedupe on the (user, source, externalId)
  // unique index and never update an existing row, so a resync neither
  // re-creates nor overwrites an edit.
  update: protectedProcedure
    .input(
      z
        .object({
          id: z.string(),
          date: pastDateSchema.optional(),
          name: z.string().trim().min(1).max(200).optional(),
          // Any positive duration, not just >= 1: Strava can import sub-minute
          // rows and the undo path must be able to restore them exactly. The
          // edit sheets themselves enforce whole minutes from 1.
          durationMin: z.number().positive().max(EXERCISE_MAX_DURATION).nullable().optional(),
          kcal: z.number().min(0).max(EXERCISE_MAX_KCAL).optional(),
        }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { id, date, name, durationMin, kcal } = input;
      const t = serverT(context.locale, "olahraga");
      if (date === undefined && name === undefined && durationMin === undefined && kcal === undefined) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.nothingChanged") });
      }
      // A strength session mirrors itself into one exercise_log row and
      // rewrites it on every save; editing the mirror here would be lost.
      const [session] = await context.db
        .select({ id: workoutSession.id })
        .from(workoutSession)
        .where(and(eq(workoutSession.exerciseLogId, id), eq(workoutSession.userId, userId)))
        .limit(1);
      if (session) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.strengthEditedElsewhere") });
      }
      const [row] = await context.db
        .update(exerciseLog)
        .set({
          ...(date !== undefined ? { date } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(durationMin !== undefined ? { durationMin } : {}),
          ...(kcal !== undefined ? { kcal } : {}),
        })
        .where(and(eq(exerciseLog.id, id), eq(exerciseLog.userId, userId)))
        .returning();
      return row ?? null;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      await context.db
        .delete(exerciseLog)
        .where(and(eq(exerciseLog.id, input.id), eq(exerciseLog.userId, context.session.user.id)));
      return { ok: true };
    }),

  listByDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const items = await context.db
        .select()
        .from(exerciseLog)
        .where(
          and(
            eq(exerciseLog.userId, context.session.user.id),
            eq(exerciseLog.date, input.date ?? jakartaToday(undefined, zone)),
          ),
        )
        .orderBy(asc(exerciseLog.createdAt));
      const totalKcal = items.reduce((total, item) => total + item.kcal, 0);
      return { items, totalKcal };
    }),

  // Health Connect / Apple Health imports land on the workout's own day (zone-cut),
  // which is often not today — screens show this window so imported
  // activities from the last few days stay visible.
  recent: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(7) }))
    .handler(async ({ context, input }) => {
      const zone = await userZone(context);
      const end = jakartaToday(undefined, zone);
      const start = shiftDate(end, -(input.days - 1));
      const items = await context.db
        .select()
        .from(exerciseLog)
        .where(
          and(
            eq(exerciseLog.userId, context.session.user.id),
            gte(exerciseLog.date, start),
            lte(exerciseLog.date, end),
          ),
        )
        .orderBy(desc(exerciseLog.date), asc(exerciseLog.createdAt));
      return { items, startDate: start, endDate: end };
    }),

  types: protectedProcedure.handler(() => EXERCISE_TYPES),
};
