// One scan item at another weight: the numbers a weight chip puts on a row
// ("Porsi kebiasaanmu", the kitchen-scale readout). Shared so both agree on how
// kcal and macros follow the grams.
import { scalePortion } from "./portion";
import { calibrateItems } from "./tkpi";
import type { CalibratedItem } from "./tkpi";

type GramsItem = CalibratedItem & { kind?: string };

/**
 * The item at `grams`: kcal and macros scale with grams / the item's grams, then
 * pass through calibration (library or TKPI match, band scaled to the new grams,
 * density cap). The model's portion text no longer describes the weight and is
 * dropped. Null when the item has no weight to scale from or calibration drops it.
 */
export function itemAtGrams<T extends GramsItem>(item: T, grams: number): T | null {
  const from = item.grams;
  if (from === undefined || !(from > 0) || !(grams > 0)) return null;
  const scaled = scalePortion(
    {
      grams: from,
      kcal: item.kcal,
      protein: item.protein ?? null,
      carbs: item.carbs ?? null,
      fat: item.fat ?? null,
      fiber: item.fiber ?? null,
    },
    grams / from,
  );
  const [calibrated] = calibrateItems([
    {
      name: item.name,
      drink: item.kind === "minuman",
      grams,
      kcal: scaled.kcal,
      ...(scaled.protein !== null ? { protein: scaled.protein } : {}),
      ...(scaled.carbs !== null ? { carbs: scaled.carbs } : {}),
      ...(scaled.fat !== null ? { fat: scaled.fat } : {}),
      ...(scaled.fiber !== null ? { fiber: scaled.fiber } : {}),
    },
  ]);
  if (!calibrated) return null;
  // A weight set from outside ends the scan's bone-in estimate: the new grams are taken as eaten.
  const { portion: _portion, edibleGrams: _edible, grossGrams: _gross, withBone: _bone, pieces: _pieces, ...rest } = item;
  return {
    ...rest,
    grams,
    kcal: calibrated.kcal,
    ...(calibrated.edibleGrams !== undefined ? { edibleGrams: calibrated.edibleGrams } : {}),
    ...(calibrated.protein !== undefined ? { protein: calibrated.protein } : {}),
    ...(calibrated.carbs !== undefined ? { carbs: calibrated.carbs } : {}),
    ...(calibrated.fat !== undefined ? { fat: calibrated.fat } : {}),
    ...(calibrated.fiber !== undefined ? { fiber: calibrated.fiber } : {}),
  } as T;
}
