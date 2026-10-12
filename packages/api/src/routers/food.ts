import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { foodLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { dateSchema, mealSchema } from "../lib/schemas";
import { SCAN_ID_RE, stickerKey } from "../lib/sticker";

export const foodRouter = {
  add: protectedProcedure
    .input(
      z.object({
        date: dateSchema.optional(),
        meal: mealSchema,
        name: z.string().min(1).max(200),
        kcal: z.number().min(0).max(5000),
        protein: z.number().min(0).max(500).optional(),
        carbs: z.number().min(0).max(500).optional(),
        fat: z.number().min(0).max(500).optional(),
        fiber: z.number().min(0).max(500).optional(),
        source: z.enum(["manual", "ai"]).default("manual"),
        itemsJson: z.string().max(10_000).optional(),
        // capability id of the dish sticker generated at scan time
        scanId: z.string().regex(SCAN_ID_RE).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(foodLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date: input.date ?? jakartaToday(),
          meal: input.meal,
          name: input.name,
          kcal: input.kcal,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          fiber: input.fiber,
          source: input.source,
          itemsJson: input.itemsJson,
          scanId: input.scanId,
        })
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .delete(foodLog)
        .where(and(eq(foodLog.id, input.id), eq(foodLog.userId, context.session.user.id)))
        .returning({ scanId: foodLog.scanId });
      if (row?.scanId) {
        const stickers = context.env.STICKERS;
        if (stickers) {
          try {
            await stickers.delete(stickerKey(row.scanId));
          } catch {
            // orphaned sticker is harmless; never block the delete
          }
        }
      }
      return { ok: true };
    }),

  listByDate: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const items = await context.db
        .select()
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, context.session.user.id),
            eq(foodLog.date, input.date ?? jakartaToday()),
          ),
        )
        .orderBy(asc(foodLog.createdAt));
      const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      for (const item of items) {
        totals.kcal += item.kcal;
        totals.protein += item.protein ?? 0;
        totals.carbs += item.carbs ?? 0;
        totals.fat += item.fat ?? 0;
        totals.fiber += item.fiber ?? 0;
      }
      return { items, totals };
    }),

  // Quick-add source: last 10 distinct names. SQLite serves bare columns from
  // the max(date) row, so kcal/meal are each name's latest values.
  recent: protectedProcedure.handler(async ({ context }) => {
    const items = await context.db
      .select({
        name: foodLog.name,
        kcal: foodLog.kcal,
        meal: foodLog.meal,
        lastDate: sql<string>`max(${foodLog.date})`,
      })
      .from(foodLog)
      .where(eq(foodLog.userId, context.session.user.id))
      .groupBy(foodLog.name)
      .orderBy(desc(sql`max(${foodLog.date})`))
      .limit(10);
    return { items };
  }),
};
