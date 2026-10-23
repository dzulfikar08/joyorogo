import type { ImageRef } from "../core/resolve";

/**
 * "Makan sehari": a whole day of food on one story, or as a carousel. The host (packages/api `lib/day-share`) turns the
 * diary rows into this plain shape; nothing here reads the diary and nothing here knows about layout.
 *
 * Honesty rules the builder keeps: a macro nobody logged stays unknown (absent, never 0); a target that is not set
 * draws no bar; there is no "over" state at all (a full bar is a full bar, never a warning colour or a word like
 * "kelebihan"), only targets that were reached are called out; and no weight is ever part of it.
 */

export type DayFoodItem = {
  name: string;
  grams?: number | null;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
};

export type DayFoodMeal = {
  /** Slot name in the app's language, e.g. "Sarapan". */
  label: string;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  /** One line naming what was eaten: a plate's own name, else the foods. */
  names: string;
  /** Every food of the slot, in the order it was logged. */
  items: DayFoodItem[];
  /**
   * Cutout URIs for the slot, most important first: the whole-plate sticker of a scan when it has one, else that scan's
   * component cutouts by kcal. Empty when the slot has no sticker at all (the card is then text only).
   */
  stickers: string[];
};

export type DayFoodSlide = { role: "cover" | "meal" | "total"; meal?: number };

export type DayFoodStory = {
  kind: "dayfood";
  /** The day shown, as a local-time Date at midnight (the story's `{date}`). */
  date?: Date;
  kcal: number;
  /** null when the plan has no kcal target (pregnancy mode): no bar, no "of". */
  targetKcal?: number | null;
  /** Totals over the day; null = nobody logged that macro. */
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  proteinTargetG?: number | null;
  carbsTargetG?: number | null;
  fatTargetG?: number | null;
  fiberTargetG?: number | null;
  /** Naikin BB: the target is a floor to reach, so sitting under it is the only thing that is not "on target". */
  gain?: boolean;
  /** Only the meals that have food, in slot order. */
  meals: DayFoodMeal[];
  /** Which carousel slide to draw; absent = the whole-day story. */
  slide?: DayFoodSlide;
};

/** Meals the story card has room for; further ones only count in the totals and a "+N" line. */
export const DAYFOOD_STORY_MEALS = 4;
/** Cutouts drawn per meal card: two side by side, the plate (or the biggest food) first. */
export const DAYFOOD_STICKERS = 2;
/** Cutouts drawn on a meal slide. */
export const DAYFOOD_SLIDE_STICKERS = 4;
/** Rows a meal slide lists; a longer meal ends with one "+N more" row that carries the rest's numbers. */
export const DAYFOOD_SLIDE_ITEMS = 8;

/** A day within this share above the target still counts as on target, matching the day card's "on track". */
const ON_TARGET_MAX = 1.05;
const ON_TARGET_MIN = 0.9;

const num = (n: number | null | undefined): number | undefined => (n == null || !Number.isFinite(n) ? undefined : n);

const ratio = (value: number | undefined, target: number | undefined): number | undefined =>
  value !== undefined && target !== undefined && target > 0 ? value / target : undefined;

/** The slides of a carousel, in order: the cover, one per meal, the closing totals. */
export function dayFoodSlides(spec: DayFoodStory): DayFoodSlide[] {
  return [
    { role: "cover" },
    ...spec.meals.map((_, meal): DayFoodSlide => ({ role: "meal", meal })),
    { role: "total" },
  ];
}

/** The carousel template id that draws a slide role. */
export const DAYFOOD_SLIDE_TEMPLATE = {
  cover: "dayfood.cover.carousel",
  meal: "dayfood.meal.carousel",
  total: "dayfood.total.carousel",
} as const satisfies Record<DayFoodSlide["role"], string>;

function mealData(meal: DayFoodMeal, dayKcal: number): Record<string, unknown> {
  return {
    label: meal.label,
    kcal: meal.kcal,
    share: dayKcal > 0 ? meal.kcal / dayKcal : undefined,
    protein: num(meal.protein),
    carbs: num(meal.carbs),
    fat: num(meal.fat),
    names: meal.names || undefined,
    itemCount: meal.items.length,
  };
}

function itemData(item: DayFoodItem | undefined): Record<string, unknown> | undefined {
  if (!item) return undefined;
  return {
    name: item.name,
    grams: item.grams != null && item.grams > 0 ? item.grams : undefined,
    kcal: item.kcal,
    protein: num(item.protein),
    carbs: num(item.carbs),
    fat: num(item.fat),
  };
}

/** A meal's rows for a slide: all of them up to the cap, else the first cap-1 and one summary row. */
export function slideItems(items: DayFoodItem[]): Array<Record<string, unknown> | undefined> {
  if (items.length <= DAYFOOD_SLIDE_ITEMS) return items.map(itemData);
  const shown = items.slice(0, DAYFOOD_SLIDE_ITEMS - 1);
  const rest = items.slice(DAYFOOD_SLIDE_ITEMS - 1);
  const sum = (pick: (item: DayFoodItem) => number | null | undefined): number | undefined => {
    let total: number | undefined;
    for (const item of rest) {
      const value = pick(item);
      if (value != null) total = (total ?? 0) + value;
    }
    return total;
  };
  return [
    ...shown.map(itemData),
    {
      more: rest.length,
      grams: sum((item) => item.grams),
      kcal: rest.reduce((total, item) => total + item.kcal, 0),
      protein: sum((item) => item.protein),
      carbs: sum((item) => item.carbs),
      fat: sum((item) => item.fat),
    },
  ];
}

/** `dayfood.*` (the whole day), `slide.*` (the carousel slide) and the cutout assets the layouts bind. */
export function dayFoodData(spec: DayFoodStory): {
  day: Record<string, unknown>;
  slide: Record<string, unknown> | undefined;
  assets: Record<string, ImageRef>;
} {
  const target = spec.targetKcal != null && spec.targetKcal > 0 ? spec.targetKcal : undefined;
  const kcalRatio = ratio(spec.kcal, target);
  const onTarget =
    kcalRatio !== undefined &&
    kcalRatio >= ON_TARGET_MIN &&
    (spec.gain === true || kcalRatio <= ON_TARGET_MAX);

  const macro = (value: number | null | undefined, goal: number | null | undefined) => {
    const v = num(value);
    const g = num(goal) !== undefined && goal! > 0 ? goal! : undefined;
    return { value: v, target: g, ratio: ratio(v, g) };
  };
  const protein = macro(spec.protein, spec.proteinTargetG);
  const carbs = macro(spec.carbs, spec.carbsTargetG);
  const fat = macro(spec.fat, spec.fatTargetG);
  const fiber = macro(spec.fiber, spec.fiberTargetG);
  // Protein and fibre are things to reach; carbs and fat are budgets, so only the first two earn a "reached".
  const proteinHit = protein.ratio !== undefined && protein.ratio >= 1;
  const fiberHit = fiber.ratio !== undefined && fiber.ratio >= 1;

  const foodCount = spec.meals.reduce((total, meal) => total + meal.items.length, 0);
  const meals = spec.meals.map((meal) => mealData(meal, spec.kcal));
  const day: Record<string, unknown> = {
    kcal: spec.kcal,
    target,
    ratio: kcalRatio,
    onTarget: onTarget || undefined,
    protein: protein.value,
    proteinTarget: protein.target,
    proteinRatio: protein.ratio,
    proteinHit: proteinHit || undefined,
    carbs: carbs.value,
    carbsTarget: carbs.target,
    carbsRatio: carbs.ratio,
    fat: fat.value,
    fatTarget: fat.target,
    fatRatio: fat.ratio,
    fiber: fiber.value,
    fiberTarget: fiber.target,
    fiberRatio: fiber.ratio,
    fiberHit: fiberHit || undefined,
    anyHit: onTarget || proteinHit || fiberHit || undefined,
    mealCount: spec.meals.length,
    moreMeals: spec.meals.length > DAYFOOD_STORY_MEALS ? spec.meals.length - DAYFOOD_STORY_MEALS : undefined,
    foodCount,
    meals,
  };

  const assets: Record<string, ImageRef> = {};
  // Story: every card's cutouts as m<card>s<n>, and how many there are (the layout picks a composition by count).
  spec.meals.slice(0, DAYFOOD_STORY_MEALS).forEach((meal, i) => {
    const uris = meal.stickers.slice(0, DAYFOOD_STICKERS);
    meals[i]!.stickers = uris.length || undefined;
    uris.forEach((uri, j) => {
      assets[`m${i}s${j}`] = { uri };
    });
  });
  // Cover collage: the first cutout of every meal, as c<n>.
  let collage = 0;
  for (const meal of spec.meals) {
    const first = meal.stickers[0];
    if (first && collage < DAYFOOD_STORY_MEALS) assets[`c${collage++}`] = { uri: first };
  }
  day.collage = collage || undefined;

  let slideData: Record<string, unknown> | undefined;
  const slide = spec.slide;
  if (slide?.role === "meal" && slide.meal !== undefined && spec.meals[slide.meal]) {
    const meal = spec.meals[slide.meal]!;
    const uris = meal.stickers.slice(0, DAYFOOD_SLIDE_STICKERS);
    uris.forEach((uri, j) => {
      assets[`p${j}`] = { uri };
    });
    slideData = {
      ...mealData(meal, spec.kcal),
      position: slide.meal + 2,
      of: spec.meals.length + 2,
      stickers: uris.length || undefined,
      items: slideItems(meal.items),
    };
  } else if (slide) {
    slideData = { position: slide.role === "cover" ? 1 : spec.meals.length + 2, of: spec.meals.length + 2 };
  }
  return { day, slide: slideData, assets };
}
