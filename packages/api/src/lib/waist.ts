import type { Gender } from "./engine";

/**
 * Lingkar perut (waist circumference) reference values.
 *
 * - Central obesity cut-off for Asian adults: men >= 90 cm, women >= 80 cm
 *   (WHO Western Pacific 2000 / IDF; the same numbers Kemenkes RI uses for
 *   "obesitas sentral").
 * - Waist-to-height ratio: keep the waist under half the height (NICE 2022).
 *   0.5 to < 0.6 is raised risk, >= 0.6 is high risk.
 */
export const WAIST_CUTOFF_CM: Record<Gender, number> = { male: 90, female: 80 };

export const WHTR_RAISED = 0.5;
export const WHTR_HIGH = 0.6;

export type WaistBand = "ok" | "raised" | "high";

export type WaistAssessment = {
  /** Sex-specific central-obesity cut-off, cm. */
  cutoffCm: number;
  /** waistCm >= cutoffCm. */
  overCutoff: boolean;
  /** Waist-to-height ratio, 2 decimals; null without a height. */
  ratio: number | null;
  /** Ratio band; null without a height. */
  band: WaistBand | null;
  /** Half the height, cm (1 decimal): the waist to stay under. Null without a height. */
  halfHeightCm: number | null;
};

export function assessWaist(
  waistCm: number,
  gender: Gender,
  heightCm: number | null,
): WaistAssessment {
  const cutoffCm = WAIST_CUTOFF_CM[gender];
  const base = { cutoffCm, overCutoff: waistCm >= cutoffCm };
  if (!heightCm || heightCm <= 0) {
    return { ...base, ratio: null, band: null, halfHeightCm: null };
  }
  const exact = waistCm / heightCm;
  const band: WaistBand = exact >= WHTR_HIGH ? "high" : exact >= WHTR_RAISED ? "raised" : "ok";
  return {
    ...base,
    ratio: Math.round(exact * 100) / 100,
    band,
    halfHeightCm: Math.round(heightCm * 5) / 10,
  };
}
