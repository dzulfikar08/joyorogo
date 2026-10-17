/**
 * The external lookup sources, in the order they are asked. docs/barcode-sources.md
 * has the evaluation behind this list (terms, limits, measured coverage on
 * Indonesian 899 codes): Open Food Facts first (free, key-less, Indonesian
 * products), then USDA FoodData Central branded foods as the US fallback. It
 * needs the Worker secret USDA_FDC_API_KEY and is simply not asked without it.
 *
 * Adding a source = one entry here; lookupBarcode caches its misses separately
 * and asks a newly added source alone about misses already on file.
 */
import { OFF_SOURCE } from "./barcode-lookup";
import type { BarcodeSource } from "./barcode-lookup";
import { usdaSource } from "./barcode-usda";

export type BarcodeSourcesEnv = { USDA_FDC_API_KEY?: string };

export function barcodeSources(env: BarcodeSourcesEnv): BarcodeSource[] {
  const key = env.USDA_FDC_API_KEY?.trim();
  return key ? [OFF_SOURCE, usdaSource(key)] : [OFF_SOURCE];
}
