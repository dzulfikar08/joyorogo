import type { Region } from "@joyorogo/i18n";

import { calibrateItems, libraryKcal } from "./tkpi";

/** The food_log columns a recalculation reads. */
export type RecalcRow = {
  id: string;
  name: string;
  grams: number | null;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  source: string;
  itemsJson: string | null;
};

export type RecalcValues = {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
};

/** Why a row was left alone: not an AI estimate, edited since, no weight to work from, or already right. */
export type RecalcSkip = "source" | "edited" | "no_grams" | "unchanged";

/**
 * Only AI estimates are recalculated. `items_json` keeps what the AI answered at
 * save time, so a row whose name, weight or kcal no longer matches one of its
 * entries was changed by the user (food.update has no edited flag). Rows saved
 * without items_json (a Cerita meal) cannot be compared and count as untouched.
 */
export function userEdited(row: Pick<RecalcRow, "name" | "grams" | "kcal" | "itemsJson">): boolean {
  if (row.itemsJson === null || row.itemsJson === "") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.itemsJson);
  } catch {
    return true;
  }
  if (!Array.isArray(parsed)) return true;
  const name = row.name.trim().toLowerCase();
  return !parsed.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as { name?: unknown; grams?: unknown; kcal?: unknown };
    return (
      typeof e.name === "string" &&
      e.name.trim().toLowerCase() === name &&
      e.kcal === row.kcal &&
      (e.grams ?? null) === row.grams
    );
  });
}

/**
 * Re-derives one row's kcal from its name and weight through the calibration
 * path of a fresh scan (library or TKPI 2019 match, band scaled to the weight,
 * 9 kcal/g cap). A kcal the calibration moved is replaced by the library's
 * per-100 g value for the weight when the dish is in the library, so a clamped
 * 300 kcal for 50 g becomes 125 rather than the band's edge. Macros follow the
 * energy only when they no longer fit it. A skip reason when the row stays as is.
 */
export function recalcRow(row: RecalcRow, region?: Region): RecalcValues | RecalcSkip {
  if (row.source !== "ai") return "source";
  if (userEdited(row)) return "edited";
  const grams = row.grams;
  if (grams === null || !(grams > 0)) return "no_grams";

  const [calibrated] = calibrateItems(
    [{ name: row.name, grams, kcal: row.kcal }],
    region ? { region } : undefined,
  );
  let kcal = calibrated?.kcal ?? row.kcal;
  if (kcal !== row.kcal) kcal = libraryKcal(row.name, grams, region) ?? kcal;
  kcal = Math.round(kcal);
  if (kcal === Math.round(row.kcal)) return "unchanged";

  const { protein, carbs, fat, fiber } = row;
  const macroKcal =
    protein === null || carbs === null || fat === null ? null : 4 * (protein + carbs) + 9 * fat;
  const fits = macroKcal === null || Math.abs(macroKcal - kcal) <= 0.35 * kcal;
  if (fits || row.kcal <= 0) return { kcal, protein, carbs, fat, fiber };
  const ratio = kcal / row.kcal;
  const scale = (n: number | null) =>
    n === null ? null : Math.round(Math.min(500, n * ratio) * 10) / 10;
  return {
    kcal,
    protein: scale(protein),
    carbs: scale(carbs),
    fat: scale(fat),
    fiber: scale(fiber),
  };
}
