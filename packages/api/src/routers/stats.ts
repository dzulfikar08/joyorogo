import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { serverT } from "../lib/messages";
import { generateWeekReflection, getWeekReflection, ReflectionLockedError } from "../lib/recap-reflection";
import { loadPeriodProgress } from "../lib/period-store";
import { loadWeekRecap } from "../lib/recap-store";
import { dateSchema } from "../lib/schemas";

const weekInput = z.object({ weekStart: dateSchema.optional() });
const periodInput = z
  .object({ from: dateSchema.optional(), to: dateSchema.optional() })
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, "from must not be after to");

export const statsRouter = {
  /**
   * Recap of the WIB week (Monday-Sunday) containing `weekStart`, default the
   * current week. Only days before today are judged, so a running week is
   * never scored on a half-logged today. Future weeks resolve to this week.
   */
  weekRecap: protectedProcedure.input(weekInput).handler(async ({ context, input }) => {
    const loaded = await loadWeekRecap(context.db, context.session.user.id, input.weekStart);
    return loaded?.recap ?? null;
  }),

  /**
   * Progress over a period for the Berat screen's share card: trend start -> end, days logged, the estimated deficit
   * and the series the card draws (lib/period-progress). `from` defaults to the first weigh-in or food log, `to` to
   * today. Null for Hamil / Menyusui and without a profile.
   */
  periodProgress: protectedProcedure.input(periodInput).handler(({ context, input }) =>
    loadPeriodProgress(context.db, context.session.user.id, input),
  ),

  /**
   * "Refleksi minggu ini" for the same week: wins and focus points chosen from the week's numbers, and the text that
   * says them. Everyone gets the fixed template text; Pro accounts get the AI text once it has been written
   * (`ai: "pending"` tells the client to call `generateWeekReflection`). Null when the week has nothing to say yet.
   * Contract: docs/weekly-recap-ai.md.
   */
  weekReflection: protectedProcedure.input(weekInput).handler(({ context, input }) =>
    getWeekReflection(context, context.session.user.id, input.weekStart, context.locale),
  ),

  /**
   * Writes the AI text of the week when it is due (Pro). Safe to call on every open: when the cache is current it
   * returns it without touching the model. Free accounts get FORBIDDEN with `data.paywall`.
   */
  generateWeekReflection: protectedProcedure.input(weekInput).handler(async ({ context, input }) => {
    try {
      return await generateWeekReflection(context, context.session.user.id, input.weekStart, context.locale);
    } catch (error) {
      if (error instanceof ReflectionLockedError) {
        throw new ORPCError("FORBIDDEN", { message: serverT(context.locale, "reflection")("locked"), data: { paywall: true } });
      }
      throw error;
    }
  }),
};
