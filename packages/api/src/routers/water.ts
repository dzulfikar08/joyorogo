import { and, eq, sql } from "drizzle-orm";

import { waterLog } from "@joyorogo/db/schema/fitness";

import { z } from "zod";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dateSchema } from "../lib/schemas";

const GOAL = 8;
const dateInput = z.object({ date: dateSchema.optional() });

export const waterRouter = {
  today: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const [row] = await context.db
      .select()
      .from(waterLog)
      .where(
        and(
          eq(waterLog.userId, context.session.user.id),
          eq(waterLog.date, input?.date ?? jakartaToday()),
        ),
      )
      .limit(1);
    return { glasses: row?.glasses ?? 0, goal: GOAL };
  }),

  add: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const [row] = await context.db
      .insert(waterLog)
      .values({
        userId: context.session.user.id,
        date: input?.date ?? jakartaToday(),
        glasses: 1,
      })
      .onConflictDoUpdate({
        target: [waterLog.userId, waterLog.date],
        set: { glasses: sql`${waterLog.glasses} + 1` },
      })
      .returning();
    return { glasses: row?.glasses ?? 0, goal: GOAL };
  }),

  remove: protectedProcedure.input(dateInput.optional()).handler(async ({ context, input }) => {
    const [row] = await context.db
      .update(waterLog)
      .set({ glasses: sql`max(${waterLog.glasses} - 1, 0)` })
      .where(
        and(
          eq(waterLog.userId, context.session.user.id),
          eq(waterLog.date, input?.date ?? jakartaToday()),
        ),
      )
      .returning({ glasses: waterLog.glasses });
    return { glasses: row?.glasses ?? 0, goal: GOAL };
  }),
};
