import { and, eq, gte } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { foodLog, profile } from "@joyorogo/db/schema/fitness";
import { pushSubscription } from "@joyorogo/db/schema/plans";

import type { Meal } from "../lib/engine";
import type { DayLog, FastingPattern } from "../lib/fasting";

import { protectedProcedure } from "../index";
import { effectiveRamadan, jakartaToday, shiftDate } from "../lib/engine";
import { dateSchema } from "../lib/schemas";
import { buildPlan, planQueries } from "../lib/plan";
import { budgetKcal } from "../lib/exercise-credit";
import { loadDayCredit } from "../lib/exercise-credit-store";
import { serverT } from "../lib/messages";
import {
  adherenceWeek,
  countKept,
  fastingDay,
  inactiveFastingDay,
  isFastingPattern,
  wibMinutes,
} from "../lib/fasting";

const patternSchema = z.enum(["off", "16:8", "18:6", "20:4", "omad"]);
const windowStartSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Gunakan format HH:MM");

export const fastingRouter = {
  settings: protectedProcedure.handler(async ({ context }) => {
    const [row] = await context.db
      .select({
        pattern: profile.fastingPattern,
        windowStart: profile.fastingWindowStart,
        notify: profile.fastingNotify,
      })
      .from(profile)
      .where(eq(profile.userId, context.session.user.id))
      .limit(1);
    return row ?? { pattern: "off" as const, windowStart: "12:00", notify: false };
  }),

  setSettings: protectedProcedure
    .input(
      z.object({
        pattern: patternSchema,
        windowStart: windowStartSchema,
        notify: z.boolean(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      // Fasting is not part of Hamil / Menyusui.
      if (input.pattern !== "off") {
        const [mode] = await context.db
          .select({ maternalMode: profile.maternalMode })
          .from(profile)
          .where(eq(profile.userId, userId))
          .limit(1);
        if (mode && mode.maternalMode !== "none") {
          throw new ORPCError("BAD_REQUEST", {
            message: serverT(context.locale, "errors")("profile.fastingMaternal"),
          });
        }
      }
      const fields = {
        fastingPattern: input.pattern,
        fastingWindowStart: input.windowStart,
        fastingNotify: input.notify,
      };
      const updated = await context.db
        .update(profile)
        .set(fields)
        .where(eq(profile.userId, userId))
        .returning({ userId: profile.userId });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: "Lengkapi onboarding dulu." });
      }
      return { pattern: input.pattern, windowStart: input.windowStart, notify: input.notify };
    }),

  /** Schedule + state for Beranda; eat budget comes from the same plan as day.summary. */
  today: protectedProcedure
    .input(z.object({ date: dateSchema.optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const date = input.date ?? jakartaToday();
      const now = new Date();
      const [profRows, latest, weighIns, intake, exercise, logRows] = await context.db.batch([
        ...planQueries(context.db, userId, date),
        context.db
          .select({ meal: foodLog.meal, kcal: foodLog.kcal, createdAt: foodLog.createdAt })
          .from(foodLog)
          .where(and(eq(foodLog.userId, userId), eq(foodLog.date, date))),
      ]);
      const prof = profRows[0];
      if (!prof || prof.maternalMode !== "none" || !isFastingPattern(prof.fastingPattern)) {
        const day = inactiveFastingDay(prof ? effectiveRamadan(prof.ramadanMode, now) : false);
        return { date, eatKcal: 0, ...day };
      }

      const plan = buildPlan(
        prof,
        {
          latestWeightKg: latest[0]?.weightKg ?? null,
          weighIns,
          intake,
          exercise,
        },
        date,
      );
      const logs: DayLog[] = logRows.map((row) => ({
        kcal: row.kcal,
        meal: row.meal as Meal,
        min: wibMinutes(row.createdAt),
      }));
      // Same budget as day.summary: the plan plus the counted exercise.
      const credit = await loadDayCredit(context.db, userId, date);
      const eatKcal = budgetKcal(plan.targets.eatKcal, credit);
      const day = fastingDay({
        pattern: prof.fastingPattern,
        windowStart: prof.fastingWindowStart,
        eatKcal,
        logs,
        nowMin: wibMinutes(now),
        ramadan: effectiveRamadan(prof.ramadanMode, now),
      });
      return { date, eatKcal, ...day };
    }),

  /** Last 7 WIB days: did all food fall inside the window? */
  week: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const today = jakartaToday();
    const [prof] = await context.db
      .select({
        pattern: profile.fastingPattern,
        windowStart: profile.fastingWindowStart,
        ramadanMode: profile.ramadanMode,
      })
      .from(profile)
      .where(eq(profile.userId, userId))
      .limit(1);
    if (!prof || !isFastingPattern(prof.pattern)) {
      return { active: false, pattern: "off" as const, days: [], keptDays: 0 };
    }
    const rows = await context.db
      .select({
        date: foodLog.date,
        meal: foodLog.meal,
        kcal: foodLog.kcal,
        createdAt: foodLog.createdAt,
      })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, shiftDate(today, -6))));
    const byDate: Record<string, DayLog[]> = {};
    for (const row of rows) {
      (byDate[row.date] ??= []).push({
        kcal: row.kcal,
        meal: row.meal as Meal,
        min: wibMinutes(row.createdAt),
      });
    }
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(today, -6 + i);
      return { date, logs: byDate[date] ?? [] };
    });
    const adherence = adherenceWeek(days, prof.windowStart, prof.pattern);
    return {
      active: true,
      pattern: prof.pattern satisfies FastingPattern,
      days: adherence,
      keptDays: countKept(adherence),
    };
  }),

  subscribePush: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await context.db
        .insert(pushSubscription)
        .values({
          id: crypto.randomUUID(),
          userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
        })
        .onConflictDoUpdate({
          target: pushSubscription.endpoint,
          set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth },
        });
      return { ok: true };
    }),

  unsubscribePush: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .handler(async ({ context, input }) => {
      await context.db
        .delete(pushSubscription)
        .where(
          and(
            eq(pushSubscription.userId, context.session.user.id),
            eq(pushSubscription.endpoint, input.endpoint),
          ),
        );
      return { ok: true };
    }),

  /** PushManager.applicationServerKey for the browser; null = reminders off. */
  vapidPublicKey: protectedProcedure.handler(({ context }) => ({
    key: context.env.VAPID_PUBLIC_KEY ?? null,
  })),
};
