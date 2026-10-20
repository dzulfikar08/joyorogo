// "Porsi kebiasaanmu": after the model answers, an item the user has a consistent
// weighed history for starts at their usual grams instead of the model's guess
// (the model answers ~150 g of rice where a weighed eater takes ~100 g, see
// docs/ai-accuracy-log.md 2026-10-20). A post-hoc default, never a prompt change:
// the model's own number stays on the item, one tap away (portion-chip.ts).
//
// History = grams the user set themselves: typed by hand, or edited after the AI
// answered. Unedited AI answers never count, or the prior would echo the model.
import { itemAtGrams } from "./item-grams";
import type { PortionNumbers, PortionPriorChip } from "./portion-chip";
import { canonicalFood } from "./tkpi";
import type { CalibratedItem } from "./tkpi";

/** Only rows from the last this-many days. */
export const PRIOR_WINDOW_DAYS = 60;
/** User-set entries a food needs before it has a prior. */
export const PRIOR_MIN_ENTRIES = 5;
/** Largest coefficient of variation (stdev / mean) of those entries. */
export const PRIOR_MAX_CV = 0.25;
/** When the model answers more than this times the usual grams, the photo looks bigger: keep the model's number. */
export const PRIOR_BIG_PLATE = 1.4;
/** Model and usual grams within this share of each other are the same portion: no chip. */
const SAME_PORTION = 0.03;

/** The food_log columns that tell whether grams were user-set. */
export type HistoryRow = {
  name: string;
  grams: number | null;
  source: string;
  itemsJson: string | null;
};

export type PortionSample = { food: string; grams: number };

export type PortionPrior = { grams: number; n: number };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The grams the user set on a saved AI row: the row's weight when it differs from
 * what the AI answered for the same dish (items_json keeps the AI's list). A row
 * without that list (a Cerita meal) or whose dish is not in it (renamed) is not
 * known to be edited.
 */
function editedAiGrams(row: HistoryRow): number | null {
  if (row.itemsJson === null || row.itemsJson === "" || row.grams === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.itemsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const name = norm(row.name);
  const same = parsed.filter(
    (entry): entry is { name: string; grams?: unknown } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string" &&
      norm((entry as { name: string }).name) === name,
  );
  if (same.length === 0) return null;
  return same.some((entry) => entry.grams === row.grams) ? null : row.grams;
}

/** Hand-typed rows have no AI list; the meal planner's rows carry a `from: "meal-plan"` list and are not typed grams. */
function isTyped(row: HistoryRow): boolean {
  if (row.source !== "manual") return false;
  return row.itemsJson === null || row.itemsJson === "" || !row.itemsJson.includes('"meal-plan"');
}

/** Grams the user set, per canonical food: manual weights and AI weights the user changed. */
export function userSetSamples(rows: HistoryRow[]): PortionSample[] {
  const samples: PortionSample[] = [];
  for (const row of rows) {
    if (row.grams === null || !(row.grams > 0)) continue;
    const grams = row.source === "ai" ? editedAiGrams(row) : isTyped(row) ? row.grams : null;
    if (grams !== null) samples.push({ food: canonicalFood(row.name), grams });
  }
  return samples;
}

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The usual portion of one food, or null when there are too few entries or they spread too much. */
export function priorOf(grams: number[]): PortionPrior | null {
  if (grams.length < PRIOR_MIN_ENTRIES) return null;
  const mean = grams.reduce((a, b) => a + b, 0) / grams.length;
  const sd = Math.sqrt(grams.reduce((a, b) => a + (b - mean) ** 2, 0) / grams.length);
  if (sd / mean > PRIOR_MAX_CV) return null;
  return { grams: Math.round(median([...grams].sort((a, b) => a - b))), n: grams.length };
}

/** Prior per canonical food, only for the foods that pass the consistency gate. */
export function buildPriors(samples: PortionSample[]): Map<string, PortionPrior> {
  const by = new Map<string, number[]>();
  for (const s of samples) by.set(s.food, [...(by.get(s.food) ?? []), s.grams]);
  const priors = new Map<string, PortionPrior>();
  for (const [food, grams] of by) {
    const prior = priorOf(grams);
    if (prior) priors.set(food, prior);
  }
  return priors;
}

type PriorItem = CalibratedItem & { cup?: unknown; kind?: string };

/**
 * The item at the usual grams, kcal through the calibration path (library or TKPI
 * match, band scaled to the grams, density cap), macros following the model's
 * ratio. Both numbers are on the item: the usual one showing, the model's behind
 * the chip. Items without a weight, hidden cups, and items the gate rejects come
 * back untouched.
 */
export function withPortionPrior<T extends PriorItem>(
  item: T,
  priors: Map<string, PortionPrior>,
  options: { bigPlate?: number } = {},
): T & { portionPrior?: PortionPriorChip } {
  const ai = item.grams;
  if (item.cup !== undefined || ai === undefined || !(ai > 0)) return item;
  const prior = priors.get(canonicalFood(item.name));
  if (!prior) return item;
  if (ai > prior.grams * (options.bigPlate ?? PRIOR_BIG_PLATE)) return item;
  if (Math.abs(ai - prior.grams) <= SAME_PORTION * prior.grams) return item;

  const shown = itemAtGrams(item, prior.grams);
  if (!shown) return item;

  const { portion: aiPortion } = item;
  const other: PortionNumbers = {
    ...(aiPortion !== undefined ? { portion: aiPortion } : {}),
    grams: ai,
    kcal: item.kcal,
    ...(item.protein !== undefined ? { protein: item.protein } : {}),
    ...(item.carbs !== undefined ? { carbs: item.carbs } : {}),
    ...(item.fat !== undefined ? { fat: item.fat } : {}),
    ...(item.fiber !== undefined ? { fiber: item.fiber } : {}),
  };
  return { ...shown, portionPrior: { active: "prior", other, n: prior.n } } as T & { portionPrior: PortionPriorChip };
}
