import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { activityRouter } from "./activity";
import { aiRouter } from "./ai";
import { avatarRouter } from "./avatar";
import { barcodeRouter } from "./barcode";
import { challengeRouter } from "./challenge";
import { coachRouter } from "./coach";
import { dayRouter } from "./day";
import { diaryRouter } from "./diary";
import { dishwareRouter } from "./dishware";
import { exerciseRouter } from "./exercise";
import { fastingRouter } from "./fasting";
import { fitnessRouter } from "./fitness";
import { fitWebRouter } from "./fit-web";
import { foodRouter } from "./food";
import { groupRouter } from "./group";
import { joyoRouter } from "./joyo";
import { mcpConnectionRouter } from "./mcp-connection";
import { mealPlanRouter } from "./meal-plan";
import { plateRouter } from "./plate";
import { placeRouter } from "./place";
import { profileRouter } from "./profile";
import { pushRouter } from "./push";
import { privacyRouter } from "./privacy";
import { savedFoodRouter } from "./saved-food";
import { sleepRouter } from "./sleep";
import { sleepInsightsRouter } from "./sleep-insights";
import { socialRouter } from "./social";
import { statsRouter } from "./stats";
import { corosRouter } from "./coros";
import { stravaRouter } from "./strava";
import { strengthRouter } from "./strength";
import { syncRouter } from "./sync";
import { watchWorkoutRouter } from "./watch-workout";
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
  sleepInsights: sleepInsightsRouter,
  day: dayRouter,
  diary: diaryRouter,
  ai: aiRouter,
  strava: stravaRouter,
  coros: corosRouter,
  privacy: privacyRouter,
  water: waterRouter,
  workout: workoutRouter,
  watchWorkout: watchWorkoutRouter,
  fasting: fastingRouter,
  plate: plateRouter,
  dishware: dishwareRouter,
  place: placeRouter,
  group: groupRouter,
  challenge: challengeRouter,
  social: socialRouter,
  stats: statsRouter,
  savedFood: savedFoodRouter,
  barcode: barcodeRouter,
  fitness: fitnessRouter,
  fitWeb: fitWebRouter,
  joyo: joyoRouter,
  coach: coachRouter,
  strength: strengthRouter,
  sync: syncRouter,
  mcpConnection: mcpConnectionRouter,
  mealPlan: mealPlanRouter,
  push: pushRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
