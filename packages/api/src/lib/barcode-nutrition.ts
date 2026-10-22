/**
 * Label numbers as the clients and the server share them: the draft shape, the
 * per-100 conversion and the plausibility rules. Pure and free of the model and
 * TKPI code in vision.ts, so the web and native bundles can import it for the
 * live "setara ... per 100 g" preview.
 */
import { isImplausible } from "./barcode";

export const KJ_PER_KCAL = 4.184;
const round1 = (n: number) => Math.round(n * 10) / 10;

export type LabelUnit = "g" | "ml";

/** What the numbers on the form mean: per printed serving, or per 100 g/ml. */
export type LabelBasis = "serving" | "per100";

/** Nutrients exactly as printed, one basis. Null = not printed or unreadable. */
export type LabelNutrients = {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
};

export const EMPTY_NUTRIENTS: LabelNutrients = {
  kcal: null,
  protein: null,
  carbs: null,
  fat: null,
  fiber: null,
  sugar: null,
};

/** Draft shown on the confirm form. Everything is editable. */
export type LabelDraft = {
  name: string | null;
  brand: string | null;
  quantity: string | null;
  /** Takaran saji in `unit`; null when the panel gives only per-100 numbers or it was unreadable. */
  servingSize: number | null;
  unit: LabelUnit;
  /** The basis `nutrients` is in: serving when the panel has a per-serving column and a serving size. */
  basis: LabelBasis;
  nutrients: LabelNutrients;
  /** Stable codes the clients localize: barcode:label.warning.*. */
  warnings: LabelWarning[];
};

export type LabelWarning =
  | "no_serving_size"
  | "no_energy"
  | "columns_disagree"
  | "energy_mismatch"
  | "energy_adjusted"
  | "implausible";

/** Why a draft or submission is refused; clients localize barcode:label.reject.*. */
export type LabelRejection = "implausible" | "energy_mismatch";


// ---------------------------------------------------------------------------
// Per-100 conversion and plausibility
// ---------------------------------------------------------------------------

export type Per100Values = {
  kcal100: number;
  protein100: number | null;
  carbs100: number | null;
  fat100: number | null;
  fiber100: number | null;
  sugar100: number | null;
};

/**
 * Values as printed -> per 100 g/ml. Per 100 passes through; per serving is
 * scaled by 100 / serving size. Null when the energy is missing or a per-serving
 * basis has no usable serving size.
 */
export function toPer100(
  basis: LabelBasis,
  servingSize: number | null,
  nutrients: LabelNutrients,
): Per100Values | null {
  if (nutrients.kcal === null) return null;
  let factor = 1;
  if (basis === "serving") {
    if (servingSize === null || !(servingSize > 0)) return null;
    factor = 100 / servingSize;
  }
  const scale = (n: number | null) => (n === null ? null : round1(n * factor));
  return {
    kcal100: round1(nutrients.kcal * factor),
    protein100: scale(nutrients.protein),
    carbs100: scale(nutrients.carbs),
    fat100: scale(nutrients.fat),
    fiber100: scale(nutrients.fiber),
    sugar100: scale(nutrients.sugar),
  };
}

/**
 * Energy implied by the macros (4/4/9 kcal per g). A real label may differ by
 * rounding, polyols and fibre, so only gross disagreement counts: it means kJ
 * typed as kcal, a per-serving energy beside per-100 macros, or a misread digit.
 */
export function energyMismatch(values: Per100Values): boolean {
  const { kcal100, protein100, carbs100, fat100 } = values;
  if (protein100 === null || carbs100 === null || fat100 === null) return false;
  const implied = 4 * protein100 + 4 * carbs100 + 9 * fat100;
  const larger = Math.max(kcal100, implied);
  return Math.abs(kcal100 - implied) > 0.4 * larger + 20;
}

/** The hard rules a label's numbers must pass. Null = acceptable. */
export function checkPer100(values: Per100Values): LabelRejection | null {
  if (isImplausible(values)) return "implausible";
  if (energyMismatch(values)) return "energy_mismatch";
  return null;
}

/** Rejection for numbers as printed on a label (any basis); null when they pass or cannot be converted yet. */
export function checkLabelNutrients(
  basis: LabelBasis,
  servingSize: number | null,
  nutrients: LabelNutrients,
): LabelRejection | null {
  const per100 = toPer100(basis, servingSize, nutrients);
  return per100 ? checkPer100(per100) : null;
}

