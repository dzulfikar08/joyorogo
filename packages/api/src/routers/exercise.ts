import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { exerciseLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dateSchema } from "../lib/schemas";
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

  types: protectedProcedure.handler(() => EXERCISE_TYPES),
};
