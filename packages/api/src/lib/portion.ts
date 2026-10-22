/**
 * Portion editing math shared by the server (food.update) and both clients'
 * live previews, so what the sheet shows is exactly what gets stored.
 * Everything is linear: a portion is the logged baseline times a ratio.
 */

export type PortionValues = {
  grams: number | null;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
};

export const MAX_GRAMS = 5000;
export const MAX_KCAL = 5000;

/** Multiplier chips for rows that have no weight to type into. */
export const PORTION_MULTIPLIERS = [0.5, 1, 1.5, 2] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
const scaleNullable = (n: number | null, ratio: number) =>
  n === null ? null : round1(Math.min(500, n * ratio));

/** Baseline times ratio: kcal and grams whole numbers, macros one decimal. */
export function scalePortion(base: PortionValues, ratio: number): PortionValues {
  return {
    grams: base.grams === null ? null : Math.min(MAX_GRAMS, Math.max(1, Math.round(base.grams * ratio))),
    kcal: Math.min(MAX_KCAL, Math.round(base.kcal * ratio)),
    protein: scaleNullable(base.protein, ratio),
    carbs: scaleNullable(base.carbs, ratio),
    fat: scaleNullable(base.fat, ratio),
    fiber: scaleNullable(base.fiber, ratio),
  };
}

/** New weight: everything follows by newGrams / baseGrams. Null without a baseline weight. */
export function portionFromGrams(base: PortionValues, grams: number): PortionValues | null {
  if (base.grams === null || base.grams <= 0) return null;
  return { ...scalePortion(base, grams / base.grams), grams: Math.round(grams) };
}

/** Fields a user can type into a portion edit besides the weight itself. */
export type PortionField = "kcal" | "protein" | "carbs" | "fat" | "fiber";

/**
 * A manual weight change: kcal and macros follow by nextGrams / prev.grams so a
 * weighed portion never keeps the energy of the old one. Fields in `edited` were
 * typed by the user in the same edit and keep their `prev` value here (the caller
 * overlays what was typed). kcal rounds to whole numbers, macros to one decimal.
 *
 * Without a usable baseline weight only the grams change (there is no ratio);
 * an invalid new weight (NaN, <= 0) changes nothing.
 */
export function rescaleForGrams(
  prev: PortionValues,
  nextGrams: number,
  edited: ReadonlySet<PortionField> | readonly PortionField[] = [],
): PortionValues {
  if (!Number.isFinite(nextGrams) || nextGrams <= 0) return { ...prev };
  const grams = Math.min(MAX_GRAMS, Math.max(1, Math.round(nextGrams)));
  if (prev.grams === null || !(prev.grams > 0)) return { ...prev, grams };
  const keep = new Set<PortionField>(edited);
  const scaled = scalePortion(prev, nextGrams / prev.grams);
  return {
    grams,
    kcal: keep.has("kcal") ? prev.kcal : scaled.kcal,
    protein: keep.has("protein") ? prev.protein : scaled.protein,
    carbs: keep.has("carbs") ? prev.carbs : scaled.carbs,
    fat: keep.has("fat") ? prev.fat : scaled.fat,
    fiber: keep.has("fiber") ? prev.fiber : scaled.fiber,
  };
}

/** New kcal: weight and macros follow by newKcal / baseKcal. Null when the baseline has 0 kcal. */
export function portionFromKcal(base: PortionValues, kcal: number): PortionValues | null {
  if (base.kcal <= 0) return null;
  return { ...scalePortion(base, kcal / base.kcal), kcal: Math.round(kcal) };
}

export type PortionPatch = {
  grams?: number;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
};

/**
 * Resolves a patch against the stored row. Linked by default:
 * - grams only: kcal and macros scale with the weight (needs a stored weight);
 * - kcal only: macros and weight (when stored) scale with the energy;
 * - grams + kcal: both taken as given, macros scale with kcal (unlinked edit);
 * - any explicit macro always wins over a derived one.
 */
export function resolvePortion(base: PortionValues, patch: PortionPatch): PortionValues {
  let next: PortionValues = { ...base };
  if (patch.grams !== undefined && patch.kcal === undefined) {
    const edited = (["protein", "carbs", "fat", "fiber"] as const).filter((f) => patch[f] !== undefined);
    next = rescaleForGrams(base, patch.grams, edited);
  } else if (patch.kcal !== undefined) {
    next = portionFromKcal(base, patch.kcal) ?? { ...base, kcal: Math.round(patch.kcal) };
    if (patch.grams !== undefined) next.grams = Math.round(patch.grams);
  }
  return {
    grams: next.grams,
    kcal: next.kcal,
    protein: patch.protein ?? next.protein,
    carbs: patch.carbs ?? next.carbs,
    fat: patch.fat ?? next.fat,
    fiber: patch.fiber ?? next.fiber,
  };
}

/** The P/K/L/fibre of a review-list item (photo scan, story): optional, undefined = never estimated. */
export type ItemMacros = { protein?: number; carbs?: number; fat?: number; fiber?: number };

/**
 * A kcal typed over an item's estimate in a review list (photo scan, "Cerita") moves the item's macros with it,
 * the same ratio food.update applies to a kcal-only edit. Without it the row kept the estimate's macros at the
 * old energy: halve 500 kcal to 250 and it still logged the full protein. Weight is left alone (the typed
 * number may fix the model's density, and the stored weight is what the portion prior compares against).
 * An untouched row (typed kcal equals the shown, rounded estimate) keeps its macros exactly; macros the item
 * never had stay undefined, never 0.
 */
export function macrosForTypedKcal(item: ItemMacros & { kcal: number }, typedKcal: number): ItemMacros {
  const { protein, carbs, fat, fiber } = item;
  if (!(item.kcal > 0) || !Number.isFinite(typedKcal) || typedKcal < 0 || Math.round(item.kcal) === Math.round(typedKcal)) {
    return { protein, carbs, fat, fiber };
  }
  const ratio = typedKcal / item.kcal;
  const scale = (n: number | undefined) => (n === undefined ? undefined : round1(Math.min(500, n * ratio)));
  return { protein: scale(protein), carbs: scale(carbs), fat: scale(fat), fiber: scale(fiber) };
}
