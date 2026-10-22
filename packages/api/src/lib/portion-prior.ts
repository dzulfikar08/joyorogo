// "Porsi kebiasaanmu": after the model answers, an item gets a second, usual portion
// beside its own number (the model answers ~150 g of rice where a weighed eater
// takes ~100 g, see docs/ai-accuracy-log.md 2026-10-20). A post-hoc default, never a
// prompt change: the model's own number stays on the item, one tap away (portion-chip.ts).
//
// Three tiers, every one a chip:
//   - a food whose user-set weights AGREE (most of the recent ones within PRIOR_AGREE of one
//     value, at least PRIOR_TIGHT_ENTRIES of them): the item STARTS at that usual grams;
//   - a food with a looser but consistent history (PRIOR_MIN_ENTRIES, coefficient of variation up
//     to PRIOR_MAX_CV) starts at the median too, with PRIOR_SUGGEST_ENTRIES of them the model's
//     number stays and their usual grams are one tap away;
//   - plain rice with no history of its own: the model's number stays, the typical
//     eaten portion (TYPICAL_PORTIONS) is one tap away, when the model answered more.
//
// Counted items scale per piece: a user who saves 200 g for "2 butir" and 100 g for "1 butir" has
// one usual of 100 g per piece, and a photo with 3 pieces starts at 300 g.
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
/** User-set entries a food with a loose history needs before the item starts at the usual grams. */
export const PRIOR_MIN_ENTRIES = 3;
/** User-set entries a food needs before the usual grams are offered on the chip. */
export const PRIOR_SUGGEST_ENTRIES = 2;
/** Entries that agree (see PRIOR_AGREE) before the item starts at the usual grams. */
export const PRIOR_TIGHT_ENTRIES = 2;
/** Entries within this share of one value agree on it: the user's usual portion of that food. */
export const PRIOR_AGREE = 0.15;
/** Newest user-set entries of one food that count (older habits age out before the 60 days do). */
export const PRIOR_RECENT_ENTRIES = 12;
/** Largest coefficient of variation (stdev / mean) of a loose history. */
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

/** `grams` is the weight of ONE piece: the saved weight divided by the pieces the row held (see countOf). */
export type PortionSample = { food: string; grams: number };

/** `tight`: the weights agree within PRIOR_AGREE (not just a spread inside PRIOR_MAX_CV). `grams` is per piece. */
export type PortionPrior = { grams: number; n: number; tight?: boolean };

const norm = (s: string) => s.trim().toLowerCase();

/** How a model names the same food: "putih telur (rebus)" and "putih telur" are one food. */
const STATE_WORDS = /\b(rebus|direbus|kukus|dikukus|polos|plain|segar|boiled|steamed)\b/g;

/** The key a food's history is kept under: the canonical food (tkpi.ts) of the name without cooking-state words and brackets. */
export function priorFood(name: string): string {
  const plain = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(STATE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return canonicalFood(plain === "" ? name : plain);
}

const WEIGHT_UNIT = /^(g|gr|gram|grams|kg|ml|l|liter|cc|kkal|kcal|oz|cm)$/;

/**
 * How many pieces an item or a saved AI entry holds: its `pieces` count, else the number a portion text
 * starts with ("2 plastik kecil", "3 butir"), else 1. A weight or volume ("200 ml") is not a count.
 */
export function countOf(item: { pieces?: { count?: unknown }; portion?: unknown }): number {
  const counted = item.pieces?.count;
  if (typeof counted === "number" && counted > 0) return counted;
  if (typeof item.portion !== "string") return 1;
  const read = /^\s*(\d{1,2})\s+(\p{L}+)/u.exec(item.portion.toLowerCase());
  if (!read || WEIGHT_UNIT.test(read[2]!)) return 1;
  return Math.max(1, Number(read[1]));
}

/**
 * The grams the user set on a saved AI row and the pieces the AI counted for that dish: the row's
 * weight when it differs from what the AI answered (items_json keeps the AI's list). A row
 * without that list (a Cerita meal) or whose dish is not in it (renamed) is not
 * known to be edited.
 */
function editedAiGrams(row: HistoryRow): { grams: number; count: number } | null {
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
    (entry): entry is { name: string; grams?: unknown; portion?: unknown; pieces?: { count?: unknown } } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string" &&
      norm((entry as { name: string }).name) === name,
  );
  if (same.length === 0 || same.some((entry) => entry.grams === row.grams)) return null;
  return { grams: row.grams, count: countOf(same[0]!) };
}

/** Hand-typed rows have no AI list; the meal planner's rows carry a `from: "meal-plan"` list and are not typed grams. */
function isTyped(row: HistoryRow): boolean {
  if (row.source !== "manual") return false;
  return row.itemsJson === null || row.itemsJson === "" || !row.itemsJson.includes('"meal-plan"');
}

/** Grams of one piece the user set, per canonical food, newest first when the rows are: manual weights and AI weights the user changed. */
export function userSetSamples(rows: HistoryRow[]): PortionSample[] {
  const samples: PortionSample[] = [];
  for (const row of rows) {
    if (row.grams === null || !(row.grams > 0)) continue;
    const set = row.source === "ai" ? editedAiGrams(row) : isTyped(row) ? { grams: row.grams, count: 1 } : null;
    if (set) samples.push({ food: priorFood(row.name), grams: set.grams / set.count });
  }
  return samples;
}

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The newest-first weights within PRIOR_AGREE of the value most of them sit around (ties go to the newer value). */
function agreeing(grams: number[]): number[] {
  let best: number[] = [];
  for (const centre of grams) {
    const near = grams.filter((g) => Math.abs(g - centre) <= PRIOR_AGREE * centre);
    if (near.length > best.length) best = near;
  }
  return best;
}

/**
 * The usual portion of one food (grams per piece, newest first), or null when there are too few
 * entries or they spread too much. Weights that agree within PRIOR_AGREE and are most of the recent
 * ones make a tight prior: one odd save among the others does not hide the habit. Otherwise a
 * spread inside PRIOR_MAX_CV makes a loose one.
 */
export function priorOf(grams: number[], minEntries: number = PRIOR_SUGGEST_ENTRIES): PortionPrior | null {
  const recent = grams.slice(0, PRIOR_RECENT_ENTRIES);
  if (recent.length < minEntries) return null;
  const near = agreeing(recent);
  if (near.length >= minEntries && near.length * 2 > recent.length) {
    return { grams: Math.round(median(near.sort((a, b) => a - b))), n: near.length, tight: true };
  }
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length);
  if (sd / mean > PRIOR_MAX_CV) return null;
  return { grams: Math.round(median([...recent].sort((a, b) => a - b))), n: recent.length };
}

/** Prior per canonical food, only for the foods that pass the entries and consistency gates. Samples newest first. */
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

type PriorItem = CalibratedItem & { cup?: unknown; kind?: string; portion?: string; pieces?: { count?: unknown } };

export type PriorOptions = {
  /** Keep-the-model's-number ratio; PRIOR_BIG_PLATE when unset. */
  bigPlate?: number;
  /** Entries from which an item starts at the usual grams; PRIOR_TIGHT_ENTRIES (agreeing weights) or PRIOR_MIN_ENTRIES (a looser spread) when unset. */
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
  const food = priorFood(item.name);
  // Usual and typical grams are per piece: a photo with 3 pieces starts at 3 times the usual one.
  const count = countOf(item);
  const prior = priors.get(food);
  if (prior) {
    const usual = Math.round(prior.grams * count);
    if (Math.abs(ai - usual) <= SAME_PORTION * usual) return item;
    const need = options.minEntries ?? (prior.tight ? PRIOR_TIGHT_ENTRIES : PRIOR_MIN_ENTRIES);
    const starts = prior.n >= need && ai <= usual * (options.bigPlate ?? PRIOR_BIG_PLATE);
    return chipped(item, usual, prior.n, "you", starts);
  }
  const typical = options.typical === false ? undefined : TYPICAL_PORTIONS[food];
  if (typical !== undefined && ai >= typical * count * TYPICAL_MIN_RATIO) return chipped(item, typical * count, 0, "typical", false);
  return item;
}
