import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { activityRouter } from "./activity";
import { aiRouter } from "./ai";
import { dayRouter } from "./day";
import { exerciseRouter } from "./exercise";
import { fastingRouter } from "./fasting";
import { foodRouter } from "./food";
import { groupRouter } from "./group";
import { plateRouter } from "./plate";
import { profileRouter } from "./profile";
import { privacyRouter } from "./privacy";
import { sleepRouter } from "./sleep";
import { socialRouter } from "./social";
import { stravaRouter } from "./strava";
import { waterRouter } from "./water";
import { waistRouter } from "./waist";
import { weightRouter } from "./weight";
import { workoutRouter } from "./workout";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  profile: profileRouter,
  weight: weightRouter,
  waist: waistRouter,
  food: foodRouter,
  exercise: exerciseRouter,
  activity: activityRouter,
  sleep: sleepRouter,
  day: dayRouter,
  ai: aiRouter,
  strava: stravaRouter,
  privacy: privacyRouter,
  water: waterRouter,
  workout: workoutRouter,
  fasting: fastingRouter,
  plate: plateRouter,
  group: groupRouter,
  social: socialRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
