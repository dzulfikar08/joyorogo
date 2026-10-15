import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { activityRouter } from "./activity";
import { aiRouter } from "./ai";
import { avatarRouter } from "./avatar";
import { barcodeRouter } from "./barcode";
import { dayRouter } from "./day";
import { diaryRouter } from "./diary";
import { exerciseRouter } from "./exercise";
import { fastingRouter } from "./fasting";
import { fitnessRouter } from "./fitness";
import { foodRouter } from "./food";
import { groupRouter } from "./group";
import { plateRouter } from "./plate";
import { placeRouter } from "./place";
import { profileRouter } from "./profile";
import { privacyRouter } from "./privacy";
import { savedFoodRouter } from "./saved-food";
import { sleepRouter } from "./sleep";
import { socialRouter } from "./social";
import { statsRouter } from "./stats";
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
  avatar: avatarRouter,
  weight: weightRouter,
  waist: waistRouter,
  food: foodRouter,
  exercise: exerciseRouter,
  activity: activityRouter,
  sleep: sleepRouter,
  day: dayRouter,
  diary: diaryRouter,
  ai: aiRouter,
  strava: stravaRouter,
  privacy: privacyRouter,
  water: waterRouter,
  workout: workoutRouter,
  fasting: fastingRouter,
  plate: plateRouter,
  place: placeRouter,
  group: groupRouter,
  social: socialRouter,
  stats: statsRouter,
  savedFood: savedFoodRouter,
  barcode: barcodeRouter,
  fitness: fitnessRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
