import { z } from "zod";

import { ACTIVITY_LEVELS, GENDERS, MEALS, type ProfileInput } from "./engine";

export const genderSchema = z.enum(GENDERS);
export const activityLevelSchema = z.enum(ACTIVITY_LEVELS);
export const mealSchema = z.enum(MEALS);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const profileInputSchema = z.object({
  birthYear: z.number().int().min(1930).max(2020),
  gender: genderSchema,
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(25).max(400),
  targetWeightKg: z.number().min(25).max(400),
  targetDate: dateSchema,
  activityLevel: activityLevelSchema,
}) satisfies z.ZodType<ProfileInput>;
