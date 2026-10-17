import { TKPI_2019, type Tkpi2019Row } from "./tkpi2019-data";

export type Tkpi2019Item = {
  code: string;
  name: string;
  airPct: number | null;
  kcalPer100g: number;
  proteinPer100g: number | null;
  fatPer100g: number | null;
  carbPer100g: number | null;
  fiberPer100g: number | null;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Longest normalized name wins so "telur ayam kampung" beats "telur ayam".
const INDEX = TKPI_2019.map((row: Tkpi2019Row) => {
  const [code, name, air, kcal, protein, fat, carb, fiber] = row;
  return {
    key: normalize(name),
    item: {
      code,
      name,
      airPct: air,
      kcalPer100g: kcal ?? 0,
      proteinPer100g: protein,
      fatPer100g: fat,
      carbPer100g: carb,
      fiberPer100g: fiber,
    } satisfies Tkpi2019Item,
  };
}).sort((a, b) => b.key.length - a.key.length);

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Second-stage lookup into the full TKPI 2019 table (~1.1k bahan/pangan).
 * Conservative: exact normalized match, the query containing a row name, or a
 * row that STARTS with a long enough query ("sayur asem" -> "sayur asem
 * betawi"). A row that merely contains the query elsewhere does not count:
 * "kacang tanah" is not "Oncom kacang tanah pepes".
 */
export function lookupTkpi2019(name: string): Tkpi2019Item | undefined {
  const q = normalize(name);
  if (q.length < 3) return undefined;
  for (const { key, item } of INDEX) {
    if (q === key) return item;
    if (q.includes(key) && key.length >= 5) return item;
    if (key.startsWith(q) && q.length >= 8 && q.length >= key.length / 2) return item;
  }
  return undefined;
}

/** Per-portion numbers straight from the official per-100 g table. */
export function portionFromTkpi2019(
  item: Tkpi2019Item,
  grams: number,
): {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
} {
  const k = grams / 100;
  return {
    kcal: Math.round(item.kcalPer100g * k),
    protein: item.proteinPer100g === null ? null : round1(item.proteinPer100g * k),
    carbs: item.carbPer100g === null ? null : round1(item.carbPer100g * k),
    fat: item.fatPer100g === null ? null : round1(item.fatPer100g * k),
    fiber: item.fiberPer100g === null ? null : round1(item.fiberPer100g * k),
  };
}
