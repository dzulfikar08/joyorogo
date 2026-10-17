/**
 * The external lookup sources, in the order they are asked. docs/barcode-sources.md
 * has the evaluation behind this list (terms, limits, measured coverage on
 * Indonesian 899 codes): Open Food Facts is the only source that is free,
 * key-less and returned Indonesian products. USDA FoodData Central, UPCitemdb,
 * FatSecret, Nutritionix and Edamam were rejected there.
 *
 * Adding a source = one entry here; lookupBarcode caches its misses separately
 * and asks a newly added source alone about misses already on file.
 */
import { OFF_SOURCE } from "./barcode-lookup";
import type { BarcodeSource } from "./barcode-lookup";

const SOURCES: readonly BarcodeSource[] = [OFF_SOURCE];

export function barcodeSources(): readonly BarcodeSource[] {
  return SOURCES;
}
