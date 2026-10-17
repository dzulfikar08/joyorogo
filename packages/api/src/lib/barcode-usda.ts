/**
 * USDA FoodData Central, branded foods, as a barcode source. A fallback for
 * US-labelled products (imports, and the planned expansion beyond Indonesia);
 * GS1 899 products are not expected in it (docs/barcode-sources.md).
 *
 * Licence: FDC data is public domain (CC0 1.0), no permission needed, the
 * source is named in the UI. Key: Worker secret USDA_FDC_API_KEY (api.data.gov),
 * 1,000 requests per hour per key; without the secret the source is not asked.
 *
 * Branded `foodNutrients` in search results are per 100 g, or per 100 ml when
 * `servingSizeUnit` is ml, which is the same convention as ProductData.
 */
import { z } from "zod";

import { SourceUnavailableError } from "./barcode";
import type { ProductData } from "./barcode";
import type { BarcodeSource } from "./barcode-lookup";

export const USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
/** Misses are the common case (the chain only reaches USDA after OFF failed), so a slow USDA must cost little. */
export const USDA_TIMEOUT_MS = 4000;

const KJ_PER_KCAL = 4.184;

const nutrientSchema = z.object({
  nutrientNumber: z.union([z.string(), z.number()]).optional(),
  unitName: z.string().optional(),
  value: z.number().optional(),
});

const foodSchema = z.object({
  description: z.string().optional(),
  brandName: z.string().nullish(),
  brandOwner: z.string().nullish(),
  gtinUpc: z.string().nullish(),
  servingSize: z.number().nullish(),
  servingSizeUnit: z.string().nullish(),
  packageWeight: z.string().nullish(),
  foodNutrients: z.array(nutrientSchema).optional(),
});

const searchSchema = z.object({ foods: z.array(z.unknown()).optional() });

/** Leading zeros are not significant: UPC-A 12, EAN-13 and GTIN-14 spellings of one code compare equal. */
function stripZeros(digits: string): string {
  return digits.replace(/^0+/, "");
}

/**
 * The text FDC is searched with. FDC stores the GTIN as printed (UPC-A as 12
 * digits, EANs as 13), while our cache key is the zero-padded EAN-13, so a
 * zero-led code goes back to its UPC-A form.
 */
export function usdaQuery(code: string): string {
  return code.length === 13 && code.startsWith("0") ? code.slice(1) : code;
}

/** "CHEERIOS CEREAL" -> "Cheerios Cereal"; mixed-case names are left alone. */
function readableName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** nutrientNumber -> value per 100 g/ml, first listed wins. */
function amounts(nutrients: z.infer<typeof nutrientSchema>[]): Map<string, { value: number; unit: string }> {
  const byNumber = new Map<string, { value: number; unit: string }>();
  for (const n of nutrients) {
    if (n.nutrientNumber === undefined || n.value === undefined || !Number.isFinite(n.value) || n.value < 0) continue;
    const key = String(n.nutrientNumber);
    if (!byNumber.has(key)) byNumber.set(key, { value: n.value, unit: (n.unitName ?? "").toUpperCase() });
  }
  return byNumber;
}

/**
 * One FDC `foods` entry -> ProductData, or null when it is not this code or
 * has no name. Nutrient gaps stay null (FDC omits what the label omits).
 * Energy: 208 (kcal), else 957/958 (Atwater, kcal), else 268 (kJ) / 4.184.
 */
export function parseUsdaFood(raw: unknown, code: string): ProductData | null {
  const parsed = foodSchema.safeParse(raw);
  if (!parsed.success) return null;
  const food = parsed.data;
  if (!food.gtinUpc || stripZeros(food.gtinUpc) !== stripZeros(code)) return null;
  const name = food.description ? readableName(food.description).slice(0, 200) : "";
  if (!name) return null;
  const got = amounts(food.foodNutrients ?? []);
  const kcalOf = (key: string) => {
    const n = got.get(key);
    return n && (n.unit === "KCAL" || n.unit === "") ? n.value : null;
  };
  const kj = got.get("268");
  const kcal =
    kcalOf("208") ?? kcalOf("957") ?? kcalOf("958") ?? (kj && kj.unit === "KJ" ? kj.value / KJ_PER_KCAL : null);
  const grams = (key: string) => {
    const n = got.get(key);
    return n && n.unit === "G" ? n.value : null;
  };
  const unit = /^(ml|mlt)$/i.test(food.servingSizeUnit ?? "") ? "ml" : "g";
  const servingIsMeasured = /^(g|grm|ml|mlt)$/i.test(food.servingSizeUnit ?? "");
  const serving = servingIsMeasured && food.servingSize && food.servingSize > 0 ? food.servingSize : null;
  const brand = (food.brandName ?? food.brandOwner ?? "").trim();
  return {
    name,
    brand: brand ? readableName(brand).slice(0, 80) : null,
    quantity: food.packageWeight?.trim() ? food.packageWeight.trim().slice(0, 60) : null,
    servingSize: serving,
    unit,
    kcal100: kcal,
    protein100: grams("203"),
    carbs100: grams("205"),
    fat100: grams("204"),
    fiber100: grams("291"),
    sugar100: grams("269") ?? grams("269.3"),
    imageUrl: null,
  };
}

/**
 * One FDC search for a barcode. Null = no branded food with this GTIN.
 * Network failures, timeouts, 429 (rate limit), 5xx and a rejected key throw
 * SourceUnavailableError: never cached as a miss.
 */
export async function fetchUsdaProduct(
  code: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProductData | null> {
  const url = `${USDA_SEARCH_URL}?${new URLSearchParams({
    query: usdaQuery(code),
    dataType: "Branded",
    pageSize: "10",
  })}`;
  let res: Response;
  try {
    // The key travels in a header, never in a URL that could end up in a log.
    res = await fetchFn(url, { headers: { "X-Api-Key": apiKey }, signal: AbortSignal.timeout(USDA_TIMEOUT_MS) });
  } catch {
    throw new SourceUnavailableError("USDA FoodData Central did not respond.");
  }
  if (!res.ok) throw new SourceUnavailableError(`USDA FoodData Central replied ${res.status}.`);
  let foods: unknown[];
  try {
    foods = searchSchema.parse(await res.json()).foods ?? [];
  } catch {
    throw new SourceUnavailableError("USDA FoodData Central reply was unreadable.");
  }
  // A text search can match other fields; only an exact GTIN counts, preferring the entry that has calories.
  const matches = foods.map((food) => parseUsdaFood(food, code)).filter((p): p is ProductData => p !== null);
  return matches.find((p) => p.kcal100 !== null) ?? matches[0] ?? null;
}

export function usdaSource(apiKey: string): BarcodeSource {
  return { id: "usda", critical: false, fetch: (code) => fetchUsdaProduct(code, apiKey) };
}
