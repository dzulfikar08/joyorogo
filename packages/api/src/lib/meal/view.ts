// Turns the stored plan (references and portion factors) into what the screens show: localized names and text,
// nutrition computed from TKPI, the day's totals against its targets, and the "why this plan" sentences.

import { fmtDecimal, fmtInt, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { mealLabel } from "../engine";
import type { Meal } from "../engine";
import { computePortion, INGREDIENTS, recipeAllergens, recipeById, recipeTags } from "./catalog";
import type { HistoryIndex } from "./history";
import { addNutrition, CARB_RANGE, dayMeets, FAT_RANGE, itemAllowed, mealMode, roundNutrition, zeroNutrition } from "./planner";
import type { MealMode, PlanPrefs } from "./planner";
import type { Allergen, Nutrition, PlannedItem, PlannedSlot, RecipeTag } from "./types";

const pick = (l: { id: string; en: string }, locale: Locale): string => (locale === "en" ? l.en : l.id);

const FRACTIONS: Record<number, string> = { 0.5: "½", 0.75: "¾", 1: "1", 1.25: "1¼", 1.5: "1½" };
const fraction = (n: number): string => FRACTIONS[n] ?? fmtDecimal(n, 2);

export type DayTargets = {
  kcal: number;
  proteinG: number;
  carbsG: [number, number];
  fatG: [number, number];
  /** 'live' = today's budget with workout calories, 'base' = the plan's base target (future days) */
  source: "live" | "base";
};

export function dayTargets(kcal: number, proteinG: number, source: "live" | "base"): DayTargets {
  return {
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    carbsG: [Math.round((kcal * CARB_RANGE[0]) / 4), Math.round((kcal * CARB_RANGE[1]) / 4)],
    fatG: [Math.round((kcal * FAT_RANGE[0]) / 9), Math.round((kcal * FAT_RANGE[1]) / 9)],
    source,
  };
}

export type ItemView = {
  slot: Meal;
  slotLabel: string;
  ref: string;
  kind: "recipe" | "habit";
  recipeId: string | null;
  name: string;
  /** cook it (recipe) or buy it ready-made: follows the person's cook/buy choice for dishes that are both */
  mode: MealMode;
  /** what to type in a map or food-app search: the Indonesian dish name, whatever the app language is */
  buyQuery: string;
  /** "Nasi, dada ayam, bayam" */
  summary: string;
  /** "1 porsi", "¾ porsi", "Nasi ½ porsi" */
  portion: string;
  scale: number;
  carbScale: number;
  grams: number | null;
  nutrition: Nutrition;
  tags: RecipeTag[];
  allergens: Allergen[];
  minutes: number | null;
  cost: 1 | 2 | 3 | null;
  /** logged through this plan (the food_log row still exists) */
  eaten: boolean;
  logId: string | null;
  /** the person logged something else for this meal: the plan item no longer counts */
  covered: boolean;
  pinned: boolean;
  /** how often the person logged this dish or food lately, when they did */
  habitTimes: number | null;
  /** the habit food this is a lighter version of, with the kcal it saves against the person's own average */
  lighterThan: { name: string; savedKcal: number } | null;
  /** has an ingredient the person now avoids (allergy or dislike): they should swap it */
  avoid: boolean;
};

function portionLabel(item: PlannedItem, carbName: string | null, locale: Locale): string {
  const t = getT(locale, "mealPlan");
  const parts: string[] = [];
  if (item.scale !== 1) parts.push(t("portion.of", { n: fraction(item.scale) }));
  if (item.carbScale !== 1 && carbName) parts.push(t("portion.carb", { carb: carbName, n: fraction(item.carbScale) }));
  return parts.length > 0 ? parts.join(", ") : t("portion.one");
}

export function itemNumbers(item: PlannedItem): { nutrition: Nutrition; grams: number | null } {
  if (item.habit) {
    const s = item.scale;
    return {
      nutrition: {
        kcal: Math.round(item.habit.kcal * s),
        proteinG: Math.round(item.habit.proteinG * s * 10) / 10,
        carbsG: Math.round(item.habit.carbsG * s * 10) / 10,
        fatG: Math.round(item.habit.fatG * s * 10) / 10,
        fiberG: 0,
      },
      grams: item.habit.grams === null ? null : Math.round(item.habit.grams * s),
    };
  }
  const recipe = recipeById(item.ref.slice(2));
  if (!recipe) return { nutrition: zeroNutrition(), grams: null };
  const portion = computePortion(recipe, item.scale, item.carbScale);
  return { nutrition: portion.nutrition, grams: portion.grams };
}

export type ItemState = { eaten: boolean; covered: boolean };

export function itemView(slot: Meal, item: PlannedItem, state: ItemState, index: HistoryIndex, prefs: PlanPrefs, locale: Locale): ItemView {
  const { nutrition, grams } = itemNumbers(item);
  const base = { slot, slotLabel: mealLabel(slot, locale), ref: item.ref, scale: item.scale, carbScale: item.carbScale, nutrition, grams, eaten: state.eaten, covered: state.covered, logId: item.logId ?? null, pinned: item.pinned === true };
  if (item.habit) {
    return {
      ...base,
      kind: "habit",
      recipeId: null,
      name: item.habit.name,
      mode: mealMode(null, prefs.cookPref),
      buyQuery: item.habit.name,
      summary: "",
      portion: portionLabel(item, null, locale),
      tags: [],
      allergens: [],
      minutes: null,
      cost: null,
      habitTimes: item.habit.times,
      lighterThan: null,
      avoid: !itemAllowed(item, prefs),
    };
  }
  const recipe = recipeById(item.ref.slice(2));
  if (!recipe) {
    return { ...base, kind: "recipe", recipeId: null, name: item.ref, mode: mealMode(null, prefs.cookPref), buyQuery: item.ref, summary: "", portion: portionLabel(item, null, locale), tags: [], allergens: [], minutes: null, cost: null, habitTimes: null, lighterThan: null, avoid: false };
  }
  const carbKey = recipe.ing.find(([k]) => INGREDIENTS[k]?.role === "carb")?.[0];
  const carbDef = carbKey ? INGREDIENTS[carbKey] : undefined;
  const summary = recipe.ing
    .filter(([k]) => INGREDIENTS[k]?.role !== "flavor" && INGREDIENTS[k]?.role !== "fat")
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => pick(INGREDIENTS[k]?.name ?? { id: k, en: k }, locale).toLowerCase())
    .join(", ");
  const eaten = index.affinity.get(recipe.id);
  const lighter = index.better.get(recipe.id);
  return {
    ...base,
    kind: "recipe",
    recipeId: recipe.id,
    name: pick(recipe.name, locale),
    mode: mealMode(recipe, prefs.cookPref),
    buyQuery: recipe.name.id,
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
    portion: portionLabel(item, carbDef ? pick(carbDef.name, locale) : null, locale),
    tags: recipeTags(recipe),
    allergens: recipeAllergens(recipe),
    minutes: recipe.minutes,
    cost: recipe.cost,
    habitTimes: eaten?.times ?? null,
    lighterThan: lighter ? { name: lighter.name, savedKcal: Math.max(0, Math.round(lighter.kcal - nutrition.kcal)) } : null,
    avoid: !itemAllowed(item, prefs),
  };
}

export type DayView = {
  date: string;
  isToday: boolean;
  isPast: boolean;
  items: ItemView[];
  targets: DayTargets;
  eaten: Nutrition;
  planned: Nutrition;
  total: Nutrition;
  met: { kcal: boolean; protein: boolean };
  /** total kcal - target, rounded; negative = under */
  kcalDelta: number;
  /** protein still missing, g (0 when met) */
  proteinShort: number;
  reasons: string[];
};

export type DayViewInput = {
  date: string;
  today: string;
  slots: PlannedSlot[];
  /** all food_log of the day, by meal slot */
  eatenByMeal: Partial<Record<Meal, Nutrition>>;
  /** ids of the food_log rows that still exist */
  existingLogIds: Set<string>;
  targets: DayTargets;
  index: HistoryIndex;
  prefs: PlanPrefs;
  locale: Locale;
};

export function buildDayView(input: DayViewInput): DayView {
  const { date, today, targets, locale } = input;
  const isToday = date === today;
  const isPast = date < today;
  let eatenTotal = zeroNutrition();
  for (const n of Object.values(input.eatenByMeal)) if (n) eatenTotal = addNutrition(eatenTotal, n);
  let planned = zeroNutrition();
  const items = input.slots.map(({ slot, item }) => {
    const eaten = item.logId != null && input.existingLogIds.has(item.logId);
    const covered = !eaten && (input.eatenByMeal[slot]?.kcal ?? 0) > 0;
    const view = itemView(slot, item, { eaten, covered }, input.index, input.prefs, locale);
    if (!eaten && !covered && !isPast) planned = addNutrition(planned, view.nutrition);
    return view;
  });
  const total = addNutrition(eatenTotal, planned);
  const met = dayMeets(total, targets.kcal, targets.proteinG);
  const kcalDelta = Math.round(total.kcal - targets.kcal);
  const proteinShort = Math.max(0, Math.ceil(targets.proteinG - total.proteinG));
  return {
    date,
    isToday,
    isPast,
    items,
    targets,
    eaten: roundNutrition(eatenTotal),
    planned: roundNutrition(planned),
    total: roundNutrition(total),
    met,
    kcalDelta,
    proteinShort,
    reasons: isPast ? [] : dayReasons({ items, total, targets, locale, met, proteinShort, kcalDelta }),
  };
}

function dayReasons(args: {
  items: ItemView[];
  total: Nutrition;
  targets: DayTargets;
  locale: Locale;
  met: { kcal: boolean; protein: boolean };
  proteinShort: number;
  kcalDelta: number;
}): string[] {
  const { items, targets, locale } = args;
  const t = getT(locale, "mealPlan");
  const out: string[] = [];
  const pct = targets.kcal > 0 ? Math.abs(Math.round((args.kcalDelta / targets.kcal) * 100)) : 0;
  out.push(t("why.budget", { kcal: fmtInt(args.total.kcal, locale), pct: fmtInt(pct, locale), budget: fmtInt(targets.kcal, locale) }));
  out.push(
    t(args.proteinShort === 0 ? "why.protein" : "why.proteinShort", {
      planned: fmtInt(Math.round(args.total.proteinG), locale),
      target: fmtInt(targets.proteinG, locale),
    }),
  );
  const fromHistory = items.filter((i) => i.habitTimes !== null && !i.lighterThan);
  if (fromHistory.length > 0) {
    out.push(t("why.history", { n: fromHistory.length, names: fromHistory.slice(0, 2).map((i) => i.name).join(", ") }));
  }
  for (const i of items.filter((x) => x.lighterThan && x.lighterThan.savedKcal > 0).slice(0, 2)) {
    out.push(t("why.better", { name: i.name, from: i.lighterThan?.name ?? "", kcal: fmtInt(Math.round((i.lighterThan?.savedKcal ?? 0) / 5) * 5, locale) }));
  }
  const halved = items.find((i) => i.carbScale < 1 && i.kind === "recipe");
  if (halved) {
    const recipe = recipeById(halved.recipeId ?? "");
    const carbKey = recipe?.ing.find(([k]) => INGREDIENTS[k]?.role === "carb")?.[0];
    const carbName = carbKey ? pick(INGREDIENTS[carbKey]?.name ?? { id: "", en: "" }, locale) : "";
    out.push(t("why.portion", { carb: carbName, amount: t("portion.of", { n: fraction(halved.carbScale) }) }));
  }
  out.push(t("why.variety"));
  out.push(t(targets.source === "live" ? "why.live" : "why.base"));
  return out;
}
