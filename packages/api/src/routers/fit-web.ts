import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { DayZone } from "@joyorogo/i18n";

import { protectedProcedure } from "../index";
import { FitDataError, resolveRange } from "../lib/fit-data";
import { FIT_WEB_LIMITS, getFitWebRecovery, getFitWebWorkouts } from "../lib/fit-web";
import { serverT } from "../lib/messages";
import { dateSchema } from "../lib/schemas";
import { userZone } from "../lib/user-zone";
import { cloudUnlocked } from "../lib/watch-workout-store";

const rangeInput = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });

/** Pro (or any account on a server without a paywall), the same rule as `fitness.cloudAccess`. */
const proProcedure = protectedProcedure.use(async ({ context, next }) => {
  if (!(await cloudUnlocked(context.db, context.env, context.session.user.id))) {
    throw new ORPCError("FORBIDDEN", {
      message: serverT(context.locale, "errors")("fitWeb.proRequired"),
      data: { paywall: true },
    });
  }
  return next();
});

function rangeOf(
  context: { locale: Parameters<typeof serverT>[0] },
  input: z.infer<typeof rangeInput>,
  defaultDays: number,
  zone: DayZone,
) {
  try {
    return resolveRange(input.from, input.to, { maxDays: FIT_WEB_LIMITS.days, defaultDays, zone });
  } catch (error) {
    if (error instanceof FitDataError) {
      throw new ORPCError("BAD_REQUEST", {
        message: serverT(context.locale, "errors")("fitWeb.badRange"),
      });
    }
    throw error;
  }
}

/**
 * Reads for the JoyoFit web app (apps/fit, docs/fit-web.md). Pro only: the app is a Pro surface, so the data it
 * aggregates is not served to a free account even though the cloud workouts it owns stay readable in `watchWorkout`.
 * One workout in full (map, series, zones, laps) is `watchWorkout.detail`; this router only adds the windowed reads.
 */
export const fitWebRouter = {
  /** One row per day with sleep, scores or activity in the window, oldest first. Default: the last 30 days. */
  recovery: proProcedure.input(rangeInput).handler(async ({ context, input }) => {
    const zone = await userZone(context);
    const range = rangeOf(context, input, 30, zone);
    return getFitWebRecovery(context.db, context.session.user.id, range.from, range.to);
  }),

  /** The cloud workouts that started in the window, newest first. Default: the last 90 days. */
  workouts: proProcedure.input(rangeInput).handler(async ({ context, input }) => {
    const zone = await userZone(context);
    const range = rangeOf(context, input, 90, zone);
    return getFitWebWorkouts(context.db, context.session.user.id, range.from, range.to, zone);
  }),
};
