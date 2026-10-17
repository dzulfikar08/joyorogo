/**
 * Barcode -> nutrition via Open Food Facts (OFF), shared by the API router and
 * its tests. Pure parsing plus one fetch wrapper; caching lives in the router.
 *
 * OFF reports nutrients per 100 g (per 100 ml for drinks) and, when the label
 * has it, a serving size. Nothing here guesses: a missing nutrient stays null
 * and a product without usable calories is "incomplete", not zero.
 */
import { z } from "zod";

import { portionFromGrams } from "./portion";
import type { PortionValues } from "./portion";

/** OFF asks for "AppName/Version (ContactEmail)" so they can reach heavy users. */
export const OFF_USER_AGENT = "JoyoRogo/1.0 (dzulfikar@joyorogo.com)";

const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_id",
  "generic_name",
  "brands",
  "quantity",
  "serving_size",
  "serving_quantity",
  "serving_quantity_unit",
  "product_quantity_unit",
  "nutriments",
  "image_front_small_url",
].join(",");

const offResponseSchema = z.object({ status: z.number().optional(), product: z.unknown().optional() });
const looseRecord = z.record(z.string(), z.unknown());

/** A found product's data as OFF reports it, per 100 g/ml. Same shape as the cache row. */
export type OffProduct = {
  name: string;
  brand: string | null;
  quantity: string | null;
  servingSize: number | null;
  unit: "g" | "ml";
  kcal100: number | null;
  protein100: number | null;
  carbs100: number | null;
  fat100: number | null;
  fiber100: number | null;
  imageUrl: string | null;
};

export type BarcodeMacro = "protein" | "carbs" | "fat" | "fiber";

export type BarcodeProductInfo = {
  code: string;
  name: string;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  unit: "g" | "ml";
};

export type BarcodeIncompleteReason = "no_kcal" | "implausible";

export type BarcodeLookup =
  | { status: "not_found"; code: string }
  | {
      // OFF knows the product but its label data cannot be logged safely.
      status: "incomplete";
      code: string;
      product: BarcodeProductInfo;
      /** Stable code; clients look the copy up in `barcode:lookup.incomplete.reason.*`. */
      reason: BarcodeIncompleteReason;
    }
  | {
      status: "found";
      code: string;
      product: BarcodeProductInfo;
      /** Baseline for portionFromGrams: 100 g/ml of the product. */
      per100: PortionValues;
      /** One printed serving, when OFF has its size. */
      perServing: PortionValues | null;
      servingSize: number | null;
      /** Nutrients OFF has no value for; they are stored as unknown, not 0. */
      missing: BarcodeMacro[];
    };

/** Thrown when OFF cannot be reached (network, timeout, 429, 5xx); never cached. */
export class OffUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffUnavailableError";
  }
}

/** GTIN check digit: weights 3,1,3,1... from the digit left of the check digit. */
function gtinChecksumOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    const weight = (digits.length - 1 - i) % 2 === 1 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * Canonical cache key for a scanned or typed code, or null when it cannot be a
 * real GTIN (wrong length, non-digits, bad check digit). UPC-A (12) is
 * zero-padded to EAN-13 and a zero-led GTIN-14 is trimmed to 13, because iOS
 * and Android disagree on which form they report; EAN-8 stays 8 digits.
 */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13 && digits.length !== 14) {
    return null;
  }
  if (!gtinChecksumOk(digits)) return null;
  if (digits.length === 12) return `0${digits}`;
  if (digits.length === 14 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : null;
}

type Nutriments = Record<string, unknown>;

/** `<key>_100g` first, then the bare key (OFF stores the 100 g value there too). */
function per100(nutriments: Nutriments, key: string): number | null {
  return num(nutriments[`${key}_100g`]) ?? num(nutriments[key]);
}

const KJ_PER_KCAL = 4.184;

/**
 * Maps an OFF `product` object. Returns null when it has no name at all (there
 * is nothing the user could recognise); nutrient gaps are kept as null.
 */
export function parseOffProduct(raw: unknown): OffProduct | null {
  const record = looseRecord.safeParse(raw);
  if (!record.success) return null;
  const p = record.data;
  const name = str(p.product_name, 200) ?? str(p.product_name_id, 200) ?? str(p.generic_name, 200);
  if (!name) return null;
  const nutriments: Nutriments = looseRecord.safeParse(p.nutriments).data ?? {};
  const kj = per100(nutriments, "energy-kj") ?? per100(nutriments, "energy");
  const kcal = per100(nutriments, "energy-kcal") ?? (kj !== null ? kj / KJ_PER_KCAL : null);
  const serving = str(p.serving_size, 60);
  const quantity = str(p.quantity, 60);
  const unitHint = `${str(p.serving_quantity_unit, 8) ?? ""} ${str(p.product_quantity_unit, 8) ?? ""}`;
  const isMl = /\bml\b/i.test(unitHint) || /\d\s*ml\b/i.test(`${serving ?? ""} ${quantity ?? ""}`);
  const servingSize = num(p.serving_quantity);
  return {
    name,
    brand: str(typeof p.brands === "string" ? p.brands.split(",")[0] : null, 80),
    quantity,
    servingSize: servingSize !== null && servingSize > 0 ? servingSize : null,
    unit: isMl ? "ml" : "g",
    kcal100: kcal,
    protein100: per100(nutriments, "proteins"),
    carbs100: per100(nutriments, "carbohydrates"),
    fat100: per100(nutriments, "fat"),
    fiber100: per100(nutriments, "fiber"),
    imageUrl: str(p.image_front_small_url, 500),
  };
}

/**
 * Decides what the app may do with a parsed product. Incomplete = no calories,
 * or numbers that cannot be true (more than pure fat's 900 kcal, or macros
 * adding up to over 100 g in 100 g): crowd-sourced data has both.
 */
export function classifyProduct(code: string, product: OffProduct): BarcodeLookup {
  const info: BarcodeProductInfo = {
    code,
    name: product.name,
    brand: product.brand,
    quantity: product.quantity,
    imageUrl: product.imageUrl,
    unit: product.unit,
  };
  const { kcal100, protein100, carbs100, fat100, fiber100 } = product;
  if (kcal100 === null) {
    return {
      status: "incomplete",
      code,
      product: info,
      reason: "no_kcal",
    };
  }
  const macroSum = (protein100 ?? 0) + (carbs100 ?? 0) + (fat100 ?? 0);
  if (kcal100 > 950 || macroSum > 105) {
    return {
      status: "incomplete",
      code,
      product: info,
      reason: "implausible",
    };
  }
  const base: PortionValues = {
    grams: 100,
    kcal: kcal100,
    protein: protein100,
    carbs: carbs100,
    fat: fat100,
    fiber: fiber100,
  };
  const missing = (
    [
      ["protein", protein100],
      ["carbs", carbs100],
      ["fat", fat100],
      ["fiber", fiber100],
    ] as const
  )
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  return {
    status: "found",
    code,
    product: info,
    per100: base,
    perServing: product.servingSize ? portionFromGrams(base, product.servingSize) : null,
    servingSize: product.servingSize,
    missing,
  };
}

/**
 * One OFF v2 product request. Null = OFF has no such product (404 or status 0).
 * Network failures, timeouts, 429 and 5xx throw OffUnavailableError so the
 * caller can serve a stale cache row and never caches an outage as a miss.
 */
export async function fetchOffProduct(
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<OffProduct | null> {
  let res: Response;
  try {
    res = await fetchFn(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`,
      { headers: { "User-Agent": OFF_USER_AGENT }, signal: AbortSignal.timeout(8000) },
    );
  } catch {
    throw new OffUnavailableError("Open Food Facts did not respond.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new OffUnavailableError(`Open Food Facts replied ${res.status}.`);
  let body: z.infer<typeof offResponseSchema>;
  try {
    body = offResponseSchema.parse(await res.json());
  } catch {
    throw new OffUnavailableError("Open Food Facts reply was unreadable.");
  }
  if (body.status !== 1) return null;
  return parseOffProduct(body.product);
}
