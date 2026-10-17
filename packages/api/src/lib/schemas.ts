import { z } from "zod";

import { ACTIVITY_LEVELS, GENDERS, MEALS, jakartaToday, shiftDate, type ProfileInput } from "./engine";
import {
  FEEDING_TYPES,
  MATERNAL_CONDITIONS,
  MAX_BABY_MONTHS,
  PREGNANCY_DATE_KINDS,
  type MaternalInput,
} from "./maternal";

export const genderSchema = z.enum(GENDERS);
export const activityLevelSchema = z.enum(ACTIVITY_LEVELS);
export const mealSchema = z.enum(MEALS);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// How far back a log date may be moved or chosen: a bounded recent window.
export const LOG_DATE_WINDOW_DAYS = 30;

/** A WIB day key from today down to LOG_DATE_WINDOW_DAYS ago. */
export const pastDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine((date) => {
    const today = jakartaToday();
    return date <= today && date >= shiftDate(today, -LOG_DATE_WINDOW_DAYS);
  }, `Tanggal harus antara ${LOG_DATE_WINDOW_DAYS} hari lalu dan hari ini`);

export const profileInputSchema = z.object({
  birthYear: z.number().int().min(1930).max(2020),
  gender: genderSchema,
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(25).max(400),
  targetWeightKg: z.number().min(25).max(400),
  targetDate: dateSchema,
  activityLevel: activityLevelSchema,
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
