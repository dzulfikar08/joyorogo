import { and, asc, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";

import { foodLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import { daysBetween, jakartaToday } from "../lib/engine";
import { FOOD_KINDS, matchesKind } from "../lib/food-kind";
import { readCalibrationPrefs } from "../lib/calibration-store";
import { buildPlan, planQueries } from "../lib/plan";
import { dateSchema } from "../lib/schemas";
import { userZone } from "../lib/user-zone";

/** One food_log row as the Stiker view returns it (same shape as food.listByDate rows). */
export type StickerRow = typeof foodLog.$inferSelect;

// Reads behind the Makan view switcher (Kalender + Stiker). Every date is a
// day key, so ranges compare as plain strings.
const kindSchema = z.enum(["semua", ...FOOD_KINDS]).default("semua");

export const diaryRouter = {
  // Kalender view: one month, one entry per logged day: kcal total, how
  // many items, and the day's showcase cutout (highest-kcal item that has
  // one). Plus the budget to colour each day against. One round trip over the
  // (user, date) index with narrow columns; days without logs are absent.
  // The budget is the plan as of the latest day shown (today for the current
  // month): one number for the grid, not a per-day recompute.
  monthTotals: protectedProcedure
    .input(
      z.object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM"),
        kind: kindSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const today = jakartaToday(undefined, await userZone(context));
      const first = `${input.month}-01`;
      const last = `${input.month}-31`;
      const planDate = today < first ? first : today > last ? last : today;
      const [profileRows, latestRows, weighIns, intake, exercise, prefRows, rows] = await context.db.batch([
        ...planQueries(context.db, userId, planDate),
        context.db
          .select({
            date: foodLog.date,
            name: foodLog.name,
            kcal: foodLog.kcal,
            scanId: foodLog.scanId,
          })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), gte(foodLog.date, first), lte(foodLog.date, last)))
          .orderBy(asc(foodLog.date), asc(foodLog.createdAt)),
      ]);
      const prof = profileRows[0];
      const targetKcal = prof
        ? buildPlan(
            prof,
            {
              latestWeightKg: latestRows[0]?.weightKg ?? null,
              weighIns,
              intake,
              exercise,
              prefs: readCalibrationPrefs(prefRows),
            },
            planDate,
          ).targets.eatKcal
        : null;

      const byDate: Record<
        string,
        { date: string; kcal: number; count: number; scanId: string | null; name: string | null }
      > = {};
      const bestKcal: Record<string, number> = {};
      for (const row of rows) {
        if (!matchesKind(row.name, input.kind)) continue;
        const day = (byDate[row.date] ??= {
          date: row.date,
          kcal: 0,
          count: 0,
          scanId: null,
          name: null,
        });
        day.kcal += row.kcal;
        day.count += 1;
        if (row.scanId && row.kcal >= (bestKcal[row.date] ?? -1)) {
          bestKcal[row.date] = row.kcal;
          day.scanId = row.scanId;
          day.name = row.name;
        }
      }
      const days = Object.values(byDate).map((day) => ({ ...day, kcal: Math.round(day.kcal) }));
      return { targetKcal, days };
    }),

  // Stiker view: food rows that have a cutout, newest first, for a bounded
  // date range (a week or a month). Full rows so the portion sheet opens on
  // them exactly as it does from the diary.
  stickers: protectedProcedure
    .input(
      z
        .object({ from: dateSchema, to: dateSchema, kind: kindSchema })
        .refine((range) => range.from <= range.to && daysBetween(range.from, range.to) <= 62, {
          message: "Rentang tanggal tidak valid",
        }),
    )
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select()
        .from(foodLog)
        .where(
          and(
            eq(foodLog.userId, context.session.user.id),
            gte(foodLog.date, input.from),
            lte(foodLog.date, input.to),
            isNotNull(foodLog.scanId),
          ),
        )
        .orderBy(desc(foodLog.date), desc(foodLog.createdAt))
        .limit(400);
      return { items: rows.filter((row) => matchesKind(row.name, input.kind)).slice(0, 200) };
    }),
};
