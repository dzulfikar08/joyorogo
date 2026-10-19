import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { fmtInt } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { foodLog } from "@joyorogo/db/schema/fitness";

import { protectedProcedure } from "../index";
import type { Context } from "../context";
import type { Meal } from "../lib/engine";
import { serverT } from "../lib/messages";
import { dateSchema, mealSchema } from "../lib/schemas";
import { cloudUnlocked } from "../lib/watch-workout-store";
import { computePortion, ingredientSource, INGREDIENTS, recipeAllergens, recipeById, recipeTags } from "../lib/meal/catalog";
import { planWeek } from "../lib/meal/week";
import type { DaySpec } from "../lib/meal/week";
import {
  applySwap,
  daySpec,
  generatePlan,
  loadEaten,
  loadPlanContext,
  MAX_DISLIKES,
  readChecks,
  readPlan,
  readPrefs,
  replanDay,
  setCheck,
  setLogId,
  swapAlternatives,
  targetsOfDate,
  writePrefs,
} from "../lib/meal/store";
import type { PlanContext, StoredPlan } from "../lib/meal/store";
import { aggregateShopping, groupShopping } from "../lib/meal/shopping";
import { ALLERGENS } from "../lib/meal/types";
import type { PlannedItem } from "../lib/meal/types";
import { buildDayView, itemNumbers, itemView } from "../lib/meal/view";
import type { DayView, ItemView } from "../lib/meal/view";

/** The diary row a planned meal logs into: deterministic, so logging is idempotent. */
function mealPlanLogId(userId: string, date: string, slot: Meal): string {
  return `meal-plan:${userId}:${date}:${slot}`;
}

const refSchema = z.string().regex(/^[rh]:[a-z0-9 -]{1,80}$/);

const prefsSchema = z.object({
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
  dislikes: z.array(z.string().trim().min(1).max(30)).max(MAX_DISLIKES),
  budgetFriendly: z.boolean(),
  cookPref: z.enum(["any", "cook", "warung"]),
});

const portionSchema = z.object({ scale: z.number().min(0.5).max(1.5).default(1), carbScale: z.number().min(0.5).max(1.5).default(1) });

function pick(l: { id: string; en: string }, locale: Locale): string {
  return locale === "en" ? l.en : l.id;
}

async function requirePro(context: Context, userId: string): Promise<void> {
  if (await cloudUnlocked(context.db, context.env, userId)) return;
  throw new ORPCError("FORBIDDEN", { message: serverT(context.locale, "mealPlan")("errors.locked"), data: { paywall: true } });
}

async function requireContext(context: Context, userId: string): Promise<PlanContext> {
  await requirePro(context, userId);
  const ctx = await loadPlanContext(context.db, userId);
  if (!ctx) throw new ORPCError("PRECONDITION_FAILED", { message: serverT(context.locale, "mealPlan")("errors.noProfile") });
  return ctx;
}

/** A meal already logged cannot be swapped: its diary row would no longer match the plan. */
async function requireNotEaten(context: Context, ctx: PlanContext, plan: StoredPlan, date: string, slot: Meal): Promise<void> {
  const logId = plan.days.find((d) => d.date === date)?.slots.find((s) => s.slot === slot)?.item.logId;
  if (!logId) return;
  const [row] = await ctx.db.select({ id: foodLog.id }).from(foodLog).where(and(eq(foodLog.id, logId), eq(foodLog.userId, ctx.userId))).limit(1);
  if (row) throw new ORPCError("CONFLICT", { message: serverT(context.locale, "mealPlan")("errors.alreadyEaten") });
}

async function requirePlan(context: Context, ctx: PlanContext): Promise<StoredPlan> {
  const plan = await readPlan(ctx.db, ctx.userId, ctx.today);
  if (!plan) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "mealPlan")("errors.noPlan") });
  return plan;
}

export type WeekView = {
  startDate: string;
  generation: number;
  days: DayView[];
  /** days that meet both their kcal range and protein target */
  daysMet: number;
};

async function weekView(ctx: PlanContext, plan: StoredPlan, locale: Locale): Promise<WeekView> {
  const logIds = plan.days.flatMap((d) => d.slots.map((s) => s.item.logId).filter((id): id is string => id != null));
  const eaten = await loadEaten(ctx.db, ctx.userId, plan.startDate, plan.days.at(-1)?.date ?? plan.startDate, logIds);
  const days = plan.days.map((day) =>
    buildDayView({
      date: day.date,
      today: ctx.today,
      slots: day.slots,
      eatenByMeal: eaten.byDate.get(day.date) ?? {},
      existingLogIds: eaten.existingLogIds,
      targets: targetsOfDate(ctx.targets, day.date, ctx.today),
      index: ctx.index,
      prefs: ctx.prefs,
      locale,
    }),
  );
  return {
    startDate: plan.startDate,
    generation: plan.generation,
    days,
    daysMet: days.filter((d) => !d.isPast && d.met.kcal && d.met.protein).length,
  };
}

/** The free account's teaser: today's first meal in full, the rest only counted. Not saved. */
async function previewView(ctx: PlanContext, locale: Locale): Promise<{ item: ItemView | null; hidden: number; targets: DayView["targets"] }> {
  const eaten = await loadEaten(ctx.db, ctx.userId, ctx.today, ctx.today, []);
  const spec: DaySpec = daySpec(ctx, ctx.today, undefined, eaten, new Set());
  const outcome = planWeek({ seed: `preview|${ctx.userId}|${ctx.today}`, days: [spec], prefs: ctx.prefs, candidates: ctx.candidates })[0];
  const slots = outcome?.day.slots ?? [];
  const first = slots[0];
  return {
    item: first ? itemView(first.slot, first.item, { eaten: false, covered: false }, ctx.index, ctx.prefs, locale) : null,
    hidden: Math.max(0, slots.length - 1),
    targets: targetsOfDate(ctx.targets, ctx.today, ctx.today),
  };
}

export type RecipeView = {
  ref: string;
  id: string;
  name: string;
  portion: string;
  nutrition: ItemView["nutrition"];
  grams: number;
  tags: ItemView["tags"];
  allergens: ItemView["allergens"];
  minutes: number;
  cost: 1 | 2 | 3;
  ingredients: { key: string; name: string; grams: number; amount: string; source: "tkpi" | "usda" }[];
  /** "Sumber gizi": where the numbers of the ingredients come from, grouped by source */
  sources: { kind: "tkpi" | "usda"; label: string; items: string[] }[];
  steps: string[];
  tip: string | null;
};

function recipeView(id: string, scale: number, carbScale: number, locale: Locale): RecipeView | null {
  const recipe = recipeById(id);
  if (!recipe) return null;
  const t = serverT(locale, "mealPlan");
  const portion = computePortion(recipe, scale, carbScale);
  const item: PlannedItem = { ref: `r:${id}`, scale, carbScale };
  const view = itemView("makan_siang", item, { eaten: false, covered: false }, { habits: [], affinity: new Map(), better: new Map(), unmatched: [] }, { allergens: [], dislikes: [], budgetFriendly: false, cookPref: "any" }, locale);
  return {
    ref: item.ref,
    id,
    name: pick(recipe.name, locale),
    portion: view.portion,
    nutrition: portion.nutrition,
    grams: portion.grams,
    tags: recipeTags(recipe),
    allergens: recipeAllergens(recipe),
    minutes: recipe.minutes,
    cost: recipe.cost,
    ingredients: portion.lines.map((line) => {
      const def = INGREDIENTS[line.key];
      const piece = def?.unit;
      const amount = piece
        ? t("amount.units", { n: fmtInt(Math.round((line.grams / piece.grams) * 2) / 2, locale).replace(/\.5$/, "½"), unit: pick(piece.name, locale), g: fmtInt(line.grams, locale) })
        : t("amount.grams", { g: fmtInt(line.grams, locale) });
      return { key: line.key, name: pick(def?.name ?? { id: line.key, en: line.key }, locale), grams: line.grams, amount, source: ingredientSource(line.key).kind };
    }),
    sources: (["tkpi", "usda"] as const)
      .map((kind) => ({
        kind,
        label: t(kind === "tkpi" ? "recipe.sourceTkpi" : "recipe.sourceUsda"),
        items: portion.lines
          .filter((line) => ingredientSource(line.key).kind === kind)
          .map((line) => {
            const name = pick(INGREDIENTS[line.key]?.name ?? { id: line.key, en: line.key }, locale);
            return kind === "usda" ? `${name} (${ingredientSource(line.key).ref})` : name;
          }),
      }))
      .filter((group) => group.items.length > 0),
    steps: recipe.steps.map((s) => pick(s, locale)),
    tip: recipe.tip ? pick(recipe.tip, locale) : null,
  };
}

export const mealPlanRouter = {
  /**
   * Everything the "Rencana makan" screen opens with. A free account only ever gets `locked` with a one-meal teaser;
   * the plan, recipes and shopping list are Pro on the server (`premiumUnlocked`, so a server without a paywall
   * unlocks them for everyone).
   */
  overview: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const pro = await cloudUnlocked(context.db, context.env, userId);
    const ctx = await loadPlanContext(context.db, userId);
    if (!ctx) return { status: "noProfile" as const };
    if (!pro) return { status: "locked" as const, preview: await previewView(ctx, context.locale) };
    const plan = await readPlan(ctx.db, userId, ctx.today);
    return {
      status: "ready" as const,
      today: ctx.today,
      prefs: ctx.prefs,
      plan: plan ? await weekView(ctx, plan, context.locale) : null,
    };
  }),

  /** Builds the 7-day plan from today when there is none; `regenerate` plans the open meals again with a new seed. */
  generate: protectedProcedure.input(z.object({ regenerate: z.boolean().default(false) })).handler(async ({ context, input }) => {
    const ctx = await requireContext(context, context.session.user.id);
    const plan = await generatePlan(ctx, { regenerate: input.regenerate });
    return weekView(ctx, plan, context.locale);
  }),

  /** Plans one day again (today: what is still open). Eaten and swapped-in meals stay. */
  replanDay: protectedProcedure.input(z.object({ date: dateSchema })).handler(async ({ context, input }) => {
    const ctx = await requireContext(context, context.session.user.id);
    const plan = await requirePlan(context, ctx);
    if (input.date < ctx.today || !plan.days.some((d) => d.date === input.date)) {
      throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "mealPlan")("errors.notFound") });
    }
    const next = await replanDay(ctx, plan, input.date);
    return weekView(ctx, next, context.locale);
  }),

  /** Similar meals for one slot (kcal within 20%, protein within 80%), closest first. */
  swapOptions: protectedProcedure.input(z.object({ date: dateSchema, slot: mealSchema })).handler(async ({ context, input }) => {
    const ctx = await requireContext(context, context.session.user.id);
    const plan = await requirePlan(context, ctx);
    await requireNotEaten(context, ctx, plan, input.date, input.slot);
    const options = await swapAlternatives(ctx, plan, input.date, input.slot, 8);
    if (!options) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "mealPlan")("errors.notFound") });
    const current = itemView(input.slot, options.current, { eaten: false, covered: false }, ctx.index, ctx.prefs, context.locale);
    return {
      current,
      alternatives: options.alternatives.map((a) => itemView(input.slot, a.item, { eaten: false, covered: false }, ctx.index, ctx.prefs, context.locale)),
    };
  }),

  /** Takes one of `swapOptions`; the rest of the day is adjusted when it no longer fits. */
  swap: protectedProcedure
    .input(z.object({ date: dateSchema, slot: mealSchema, ref: refSchema, scale: z.number().min(0.5).max(1.5), carbScale: z.number().min(0.5).max(1.5) }))
    .handler(async ({ context, input }) => {
      const ctx = await requireContext(context, context.session.user.id);
      const plan = await requirePlan(context, ctx);
      await requireNotEaten(context, ctx, plan, input.date, input.slot);
      const options = await swapAlternatives(ctx, plan, input.date, input.slot, 200);
      if (!options) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "mealPlan")("errors.notFound") });
      const chosen = options.alternatives.find((a) => a.item.ref === input.ref && a.item.scale === input.scale && a.item.carbScale === input.carbScale);
      if (!chosen) throw new ORPCError("BAD_REQUEST", { message: serverT(context.locale, "mealPlan")("errors.badAlternative") });
      const result = await applySwap(ctx, plan, input.date, input.slot, chosen.item);
      return { replanned: result.replanned, plan: await weekView(ctx, result.plan, context.locale) };
    }),

  /** "Sudah makan": logs the planned meal into food_log with its TKPI-computed nutrition. */
  eat: protectedProcedure.input(z.object({ date: dateSchema, slot: mealSchema })).handler(async ({ context, input }) => {
    const ctx = await requireContext(context, context.session.user.id);
    const plan = await requirePlan(context, ctx);
    const t = serverT(context.locale, "mealPlan");
    if (input.date > ctx.today) throw new ORPCError("BAD_REQUEST", { message: t("errors.futureEat") });
    const item = plan.days.find((d) => d.date === input.date)?.slots.find((s) => s.slot === input.slot)?.item;
    if (!item) throw new ORPCError("NOT_FOUND", { message: t("errors.notFound") });
    if (item.logId) {
      const [existing] = await ctx.db.select({ id: foodLog.id }).from(foodLog).where(and(eq(foodLog.id, item.logId), eq(foodLog.userId, ctx.userId))).limit(1);
      if (existing) throw new ORPCError("CONFLICT", { message: t("errors.alreadyEaten") });
    }
    const view = itemView(input.slot, item, { eaten: false, covered: false }, ctx.index, ctx.prefs, context.locale);
    const { nutrition, grams } = itemNumbers(item);
    // One diary row per person, day and slot: the id is the claim, so two taps (or two devices) at once log it once.
    const logId = mealPlanLogId(ctx.userId, input.date, input.slot);
    const recipe = item.ref.startsWith("r:") ? recipeById(item.ref.slice(2)) : undefined;
    const inserted = await ctx.db
      .insert(foodLog)
      .values({
        id: logId,
        userId: ctx.userId,
        date: input.date,
        meal: input.slot,
        name: view.name,
        kcal: nutrition.kcal,
        protein: nutrition.proteinG,
        carbs: nutrition.carbsG,
        fat: nutrition.fatG,
        fiber: nutrition.fiberG,
        grams,
        source: "manual",
        itemsJson: JSON.stringify({
          from: "meal-plan",
          ref: item.ref,
          scale: item.scale,
          carbScale: item.carbScale,
          lines: recipe ? computePortion(recipe, item.scale, item.carbScale).lines : undefined,
        }),
      })
      .onConflictDoNothing()
      .returning({ id: foodLog.id });
    if (inserted.length === 0) {
      // already logged (another tap, another device): make sure the plan item points at that row, then say so
      if (item.logId !== logId) await setLogId(ctx, plan, input.date, input.slot, logId);
      throw new ORPCError("CONFLICT", { message: t("errors.alreadyEaten") });
    }
    const next = await setLogId(ctx, plan, input.date, input.slot, logId);
    return { logId, plan: await weekView(ctx, next, context.locale) };
  }),

  /** Takes a "Sudah makan" back: removes the diary row it created. */
  undoEat: protectedProcedure.input(z.object({ date: dateSchema, slot: mealSchema })).handler(async ({ context, input }) => {
    const ctx = await requireContext(context, context.session.user.id);
    const plan = await requirePlan(context, ctx);
    const t = serverT(context.locale, "mealPlan");
    const item = plan.days.find((d) => d.date === input.date)?.slots.find((s) => s.slot === input.slot)?.item;
    if (!item) throw new ORPCError("NOT_FOUND", { message: t("errors.notFound") });
    if (!item.logId) throw new ORPCError("CONFLICT", { message: t("errors.notEaten") });
    await ctx.db.delete(foodLog).where(and(eq(foodLog.id, item.logId), eq(foodLog.userId, ctx.userId)));
    const next = await setLogId(ctx, plan, input.date, input.slot, null);
    return weekView(ctx, next, context.locale);
  }),

  /** One recipe at a portion size: ingredients in grams, steps, nutrition per portion (TKPI). */
  recipe: protectedProcedure
    .input(z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/) }).extend(portionSchema.shape))
    .handler(async ({ context, input }) => {
      await requirePro(context, context.session.user.id);
      const view = recipeView(input.id, input.scale, input.carbScale, context.locale);
      if (!view) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "mealPlan")("errors.notFound") });
      return view;
    }),

  /** The plan's shopping list: ingredients of the meals not eaten yet, grouped, with the ticked rows. */
  shopping: protectedProcedure.handler(async ({ context }) => {
    const ctx = await requireContext(context, context.session.user.id);
    const plan = await readPlan(ctx.db, ctx.userId, ctx.today);
    if (!plan) return { startDate: null, groups: [], total: 0, checked: 0 };
    const logIds = plan.days.flatMap((d) => d.slots.map((s) => s.item.logId).filter((id): id is string => id != null));
    const eaten = await loadEaten(ctx.db, ctx.userId, plan.startDate, plan.days.at(-1)?.date ?? plan.startDate, logIds);
    const items = plan.days
      .filter((d) => d.date >= ctx.today)
      .flatMap((d) => d.slots.filter((s) => !(s.item.logId != null && eaten.existingLogIds.has(s.item.logId)) && (eaten.byDate.get(d.date)?.[s.slot]?.kcal ?? 0) === 0).map((s) => s.item));
    const entries = aggregateShopping(items, context.locale);
    const checks = await readChecks(ctx.db, ctx.userId, plan.startDate);
    const groups = groupShopping(entries, checks, context.locale);
    return {
      startDate: plan.startDate,
      groups,
      total: entries.length,
      checked: entries.filter((e) => checks.has(e.key)).length,
    };
  }),

  checkItem: protectedProcedure
    .input(z.object({ key: z.string().regex(/^[a-z0-9-]{1,60}$/), checked: z.boolean() }))
    .handler(async ({ context, input }) => {
      const ctx = await requireContext(context, context.session.user.id);
      const plan = await requirePlan(context, ctx);
      if (!INGREDIENTS[input.key]) throw new ORPCError("NOT_FOUND", { message: serverT(context.locale, "mealPlan")("errors.notFound") });
      await setCheck(ctx.db, ctx.userId, plan.startDate, input.key, input.checked);
      return { key: input.key, checked: input.checked };
    }),

  prefs: protectedProcedure.handler(async ({ context }) => {
    await requirePro(context, context.session.user.id);
    return readPrefs(context.db, context.session.user.id);
  }),

  setPrefs: protectedProcedure.input(prefsSchema).handler(async ({ context, input }) => {
    await requirePro(context, context.session.user.id);
    return writePrefs(context.db, context.session.user.id, input);
  }),
};

