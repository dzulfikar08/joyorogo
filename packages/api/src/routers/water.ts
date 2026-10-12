import { and, eq, sql } from "drizzle-orm";

import { waterLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";

const GOAL = 8;

export const waterRouter = {
  today: protectedProcedure.handler(async ({ context }) => {
    const [row] = await context.db
      .select()
      .from(waterLog)
      .where(and(eq(waterLog.userId, context.session.user.id), eq(waterLog.date, jakartaToday())))
      .limit(1);
    return { glasses: row?.glasses ?? 0, goal: GOAL };
  }),

  add: protectedProcedure.handler(async ({ context }) => {
    const [row] = await context.db
      .insert(waterLog)
      .values({ userId: context.session.user.id, date: jakartaToday(), glasses: 1 })
      .onConflictDoUpdate({
        target: [waterLog.userId, waterLog.date],
        set: { glasses: sql`${waterLog.glasses} + 1` },
      })
      .returning();
    return { glasses: row?.glasses ?? 0, goal: GOAL };
  }),

  remove: protectedProcedure.handler(async ({ context }) => {
    const [row] = await context.db
      .update(waterLog)
      .set({ glasses: sql`max(${waterLog.glasses} - 1, 0)` })
      .where(and(eq(waterLog.userId, context.session.user.id), eq(waterLog.date, jakartaToday())))
      .returning({ glasses: waterLog.glasses });
    return { glasses: row?.glasses ?? 0, goal: GOAL };
  }),
};
