// The hosted engine reads the person's data through the SAME procedures the phone's own-key engine calls over HTTP, run here
// with `call(procedure, input, { context })` under the caller's own session: the same checks, the same numbers, and a
// person can only ever reach their own rows. `createToolData` (tool-data.ts) then copies named fields only.

import { call } from "@orpc/server";

import type { Context } from "../../context";
import { aiRouter } from "../../routers/ai";
import { dayRouter } from "../../routers/day";
import { fastingRouter } from "../../routers/fasting";
import { foodRouter } from "../../routers/food";
import { profileRouter } from "../../routers/profile";
import { waterRouter } from "../../routers/water";
import { weightRouter } from "../../routers/weight";
import type { RogoRpc } from "./tool-data";

export function rpcFromContext(context: Context): RogoRpc {
  const options = { context };
  return {
    daySummary: (date) => call(dayRouter.summary, { date }, options),
    foodByDate: (date) => call(foodRouter.listByDate, { date }, options),
    kcalSeries: (from, to) => call(dayRouter.kcalSeries, { from, to }, options),
    diaryRange: (from, to) => call(aiRouter.diaryRange, { from, to }, options),
    waterSeries: (from, to) => call(waterRouter.series, { from, to }, options),
    weightHistory: (limit) => call(weightRouter.history, { limit }, options),
    myProfile: () => call(profileRouter.myProfile, undefined, options),
    fastingToday: (date) => call(fastingRouter.today, { date }, options),
    scanAllowance: () => call(profileRouter.scanAllowance, undefined, options),
    recentFoods: () => call(foodRouter.recent, undefined, options),
  };
}
