// "Porsi kebiasaanmu": after the model answers, an item gets a second, usual portion
// beside its own number (the model answers ~150 g of rice where a weighed eater
// takes ~100 g, see docs/ai-accuracy-log.md 2026-10-20). A post-hoc default, never a
// prompt change: the model's own number stays on the item, one tap away (portion-chip.ts).
//
// Three tiers, every one a chip:
//   - a food the user has a solid weighed history for (PRIOR_MIN_ENTRIES, consistent):
//     the item STARTS at their usual grams;
//   - a food with a thinner but consistent history (PRIOR_SUGGEST_ENTRIES): the model's
//     number stays, their usual grams are one tap away;
//   - plain rice with no history of its own: the model's number stays, the typical
//     eaten portion (TYPICAL_PORTIONS) is one tap away, when the model answered more.
//
// History = grams the user set themselves: typed by hand, or edited after the AI
// answered. Unedited AI answers never count, or the prior would echo the model.
import { itemAtGrams } from "./item-grams";
import { numbersOf } from "./portion-chip";
import type { PortionPriorChip } from "./portion-chip";
import { canonicalFood } from "./tkpi";
import type { CalibratedItem } from "./tkpi";

/** Only rows from the last this-many days. */
export const PRIOR_WINDOW_DAYS = 60;
/** User-set entries a food needs before the item starts at the usual grams. */
export const PRIOR_MIN_ENTRIES = 3;
/** User-set entries a food needs before the usual grams are offered on the chip. */
export const PRIOR_SUGGEST_ENTRIES = 2;
/** Largest coefficient of variation (stdev / mean) of those entries. */
export const PRIOR_MAX_CV = 0.25;
/** When the model answers more than this times the usual grams, the photo looks bigger: keep the model's number (the usual one stays on the chip). */
export const PRIOR_BIG_PLATE = 1.4;
/** Model and usual grams within this share of each other are the same portion: no chip. */
const SAME_PORTION = 0.03;
/**
 * Grams of one typical eaten portion, by canonical food (tkpi.ts canonicalFood). Plain rice only:
 * the one food the model answers a near-fixed number for (150 g in 27 of 64 saved AI rice rows, the
 * median, and in 9 of 10 external runs) and where the one weighed contributor's plates say otherwise
 * (median 100 g, docs/ai-accuracy-log.md 2026-10-21). Evidence is thin, so it is a chip, never a default.
 */
export const TYPICAL_PORTIONS: Readonly<Record<string, number>> = { nasi: 100 };
/** The typical portion is offered when the model answered at least this times as much. */
export const TYPICAL_MIN_RATIO = 1.2;

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
export function priorOf(grams: number[], minEntries: number = PRIOR_SUGGEST_ENTRIES): PortionPrior | null {
  if (grams.length < minEntries) return null;
  const mean = grams.reduce((a, b) => a + b, 0) / grams.length;
  const sd = Math.sqrt(grams.reduce((a, b) => a + (b - mean) ** 2, 0) / grams.length);
  if (sd / mean > PRIOR_MAX_CV) return null;
  return { grams: Math.round(median([...grams].sort((a, b) => a - b))), n: grams.length };
}

/** Prior per canonical food, only for the foods that pass the entries and consistency gates. */
export function buildPriors(
  samples: PortionSample[],
  minEntries: number = PRIOR_SUGGEST_ENTRIES,
): Map<string, PortionPrior> {
  const by = new Map<string, number[]>();
  for (const s of samples) by.set(s.food, [...(by.get(s.food) ?? []), s.grams]);
  const priors = new Map<string, PortionPrior>();
  for (const [food, grams] of by) {
    const prior = priorOf(grams, minEntries);
    if (prior) priors.set(food, prior);
  }
  return priors;
}

type PriorItem = CalibratedItem & { cup?: unknown; kind?: string };

export type PriorOptions = {
  /** Keep-the-model's-number ratio; PRIOR_BIG_PLATE when unset. */
  bigPlate?: number;
  /** Entries from which an item starts at the usual grams; PRIOR_MIN_ENTRIES when unset. */
  minEntries?: number;
  /** Offer the typical portion of plain rice to everyone without a history; default true. */
  typical?: boolean;
};

/**
 * The item with a second portion on its chip. `usual` = the grams of that second portion
 * (kcal through the calibration path: library or TKPI match, band scaled to the grams,
 * density cap; macros following the model's ratio). `starts` = the item shows it
 * (the model's numbers behind the chip) instead of the other way round.
 */
function chipped<T extends PriorItem>(
  item: T,
  usual: number,
  n: number,
  source: "you" | "typical",
  starts: boolean,
): T & { portionPrior?: PortionPriorChip } {
  const shown = itemAtGrams(item, usual);
  if (!shown) return item;
  if (!starts) {
    return { ...item, portionPrior: { active: "ai", other: numbersOf({ ...shown, grams: usual }), n, source } } as T & {
      portionPrior: PortionPriorChip;
    };
  }
  const other = numbersOf({ ...item, grams: item.grams! });
  return { ...shown, portionPrior: { active: "prior", other, n, source } } as T & { portionPrior: PortionPriorChip };
}

/**
 * The item with its usual or typical portion (see the tiers above): starting at it, or offering it
 * on the chip with the model's number kept. Items without a weight, hidden cups, and items no tier
 * covers come back untouched.
 */
export function withPortionPrior<T extends PriorItem>(
  item: T,
  priors: Map<string, PortionPrior>,
  options: PriorOptions = {},
): T & { portionPrior?: PortionPriorChip } {
  const ai = item.grams;
  if (item.cup !== undefined || ai === undefined || !(ai > 0)) return item;
  const food = canonicalFood(item.name);
  const prior = priors.get(food);
  if (prior) {
    if (Math.abs(ai - prior.grams) <= SAME_PORTION * prior.grams) return item;
    const starts = prior.n >= (options.minEntries ?? PRIOR_MIN_ENTRIES) && ai <= prior.grams * (options.bigPlate ?? PRIOR_BIG_PLATE);
    return chipped(item, prior.grams, prior.n, "you", starts);
  }
  const typical = options.typical === false ? undefined : TYPICAL_PORTIONS[food];
  if (typical !== undefined && ai >= typical * TYPICAL_MIN_RATIO) return chipped(item, typical, 0, "typical", false);
  return item;
}
