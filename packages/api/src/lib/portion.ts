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
    next = portionFromGrams(base, patch.grams) ?? { ...base, grams: Math.round(patch.grams) };
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
