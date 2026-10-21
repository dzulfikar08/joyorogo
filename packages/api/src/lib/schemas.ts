import { z } from "zod";

import { ACTIVITY_LEVELS, GENDERS, MEALS, SLEEP_TARGET_HOURS, jakartaToday, shiftDate, type ProfileInput } from "./engine";
import {
  FEEDING_TYPES,
  MATERNAL_CONDITIONS,
  MAX_BABY_MONTHS,
  PREGNANCY_DATE_KINDS,
  type MaternalInput,
} from "./maternal";
import { MANUAL_TDEE_MAX_KCAL, MANUAL_TDEE_MIN_KCAL } from "./manual-tdee";

export const genderSchema = z.enum(GENDERS);
export const activityLevelSchema = z.enum(ACTIVITY_LEVELS);

/**
 * COMPAT, old clients (native builds up to 1932, web tabs opened before the TDEE deploy): their onboarding still sends the
 * three old levels. They are mapped to what migration 0048 made of them before anything is stored. Only the profile
 * input takes this; the new `profile.setActivityLevel` is strict.
 */
const LEGACY_ACTIVITY_LEVELS = { low: "sedentary", mid: "light", high: "moderate" } as const;
export const activityLevelInputSchema = z.union([
  activityLevelSchema,
  z.enum(["low", "mid", "high"]).transform((level) => LEGACY_ACTIVITY_LEVELS[level]),
]);
export const mealSchema = z.enum(MEALS);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// How far back a log date may be moved or chosen: a bounded recent window.
export const LOG_DATE_WINDOW_DAYS = 30;

/**
 * A day key from today down to LOG_DATE_WINDOW_DAYS ago. The schema has no request, so "today" is the most advanced
 * supported zone (Kuala Lumpur, UTC+8): a Malaysian user just past midnight is not rejected for a date that is
 * still tomorrow in Jakarta; the window is an hour looser for the others.
 */
export const pastDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine((date) => {
    const today = jakartaToday(undefined, "Asia/Kuala_Lumpur");
    return date <= today && date >= shiftDate(today, -LOG_DATE_WINDOW_DAYS);
  }, `Tanggal harus antara ${LOG_DATE_WINDOW_DAYS} hari lalu dan hari ini`);

export const sleepTargetHoursSchema = z
  .number()
  .refine((hours) => (SLEEP_TARGET_HOURS as readonly number[]).includes(hours), "Target tidur harus 6 sampai 9 jam, per setengah jam");

export const manualTdeeKcalSchema = z
  .number()
  .int()
  .min(MANUAL_TDEE_MIN_KCAL)
  .max(MANUAL_TDEE_MAX_KCAL);

export const profileInputSchema = z.object({
  birthYear: z.number().int().min(1930).max(2020),
  gender: genderSchema,
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(25).max(400),
  targetWeightKg: z.number().min(25).max(400),
  targetDate: dateSchema,
  activityLevel: activityLevelInputSchema,
  sleepTargetHours: sleepTargetHoursSchema.nullish(),
}) satisfies z.ZodType<ProfileInput>;

const prePregnancyWeightSchema = z.number().min(25).max(250);
const conditionsSchema = z.array(z.enum(MATERNAL_CONDITIONS)).max(MATERNAL_CONDITIONS.length);

/** Hamil / Menyusui answers. HPHT or HPL goes in `date`; the server derives week and trimester. */
export const maternalInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("pregnant"),
    dateKind: z.enum(PREGNANCY_DATE_KINDS),
    date: dateSchema,
    prePregnancyWeightKg: prePregnancyWeightSchema,
    twins: z.boolean(),
    conditions: conditionsSchema.optional(),
  }),
  z.object({
    mode: z.literal("breastfeeding"),
    feeding: z.enum(FEEDING_TYPES),
    babyAgeMonths: z.number().int().min(0).max(MAX_BABY_MONTHS),
    prePregnancyWeightKg: prePregnancyWeightSchema.nullish(),
    conditions: conditionsSchema.optional(),
  }),
]) satisfies z.ZodType<MaternalInput>;
