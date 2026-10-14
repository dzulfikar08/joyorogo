import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { exerciseLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dateSchema, pastDateSchema } from "../lib/schemas";
import { EXERCISE_TYPES } from "../lib/met";

export const exerciseRouter = {
  add: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        type: z.string().max(50).optional(),
        name: z.string().min(1).max(200),
        durationMin: z.number().min(1).max(1440).optional(),
        kcal: z.number().min(0).max(10000),
        // Import rows (health_connect, apple_health) come from on-device
        // syncs; manual is the default
        source: z.enum(["manual", "health_connect", "apple_health"]).default("manual"),
        externalId: z.string().max(200).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(exerciseLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date: input.date ?? jakartaToday(),
          type: input.type,
          name: input.name,
          durationMin: input.durationMin ?? null,
          kcal: input.kcal,
          source: input.source,
          externalId: input.externalId,
        })
        .returning();
      return row;
    }),

  // Moves one logged activity to another day (WIB key).
  update: protectedProcedure
    .input(z.object({ id: z.string(), date: pastDateSchema }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .update(exerciseLog)
        .set({ date: input.date })
        .where(and(eq(exerciseLog.id, input.id), eq(exerciseLog.userId, context.session.user.id)))
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
      const items = await context.db
        .select()
        .from(exerciseLog)
        .where(
          and(
            eq(exerciseLog.userId, context.session.user.id),
            eq(exerciseLog.date, input.date ?? jakartaToday()),
          ),
        )
        .orderBy(asc(exerciseLog.createdAt));
      const totalKcal = items.reduce((total, item) => total + item.kcal, 0);
      return { items, totalKcal };
    }),

  // Health Connect / Apple Health imports land on the workout's own WIB day,
  // which is often not today — screens show this window so imported
  // activities from the last few days stay visible.
  recent: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(7) }))
    .handler(async ({ context, input }) => {
      const end = jakartaToday();
      const start = new Date(
        Date.now() + 7 * 60 * 60 * 1000 - (input.days - 1) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
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
