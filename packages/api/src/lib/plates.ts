// Pure logic for the food-price feature: price attaches to a plate (one scan,
// one Cerita meal, or one manual entry), never to its components. Dates are
// WIB calendar days 'YYYY-MM-DD'.

import { shiftDate } from "./engine";
import type { Meal } from "./engine";

export const MEAL_SLOTS: Meal[] = [
  "sarapan",
  "makan_siang",
  "makan_malam",
  "snack",
  "sahur",
  "berbuka",
];

/** Nutrient totals of one plate, aggregated from its food_log components. */
export type PlateNutrients = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
};

export type PlateComponent = {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
};

/** A priced plate as stored: one row of the `plate` table. */
export type PlateRow = {
  date: string;
  meal: string;
  name: string;
  place: string | null;
  priceIdr: number | null;
  createdAt?: number | string | Date | null;
};

/** Autofill/ranking key: case- and whitespace-insensitive. */
export function plateKey(name: string, place?: string | null): string {
  const base = name.toLowerCase().replace(/\s+/g, " ").trim();
  const placeNorm = place?.toLowerCase().replace(/\s+/g, " ").trim();
  return placeNorm ? `${base}|${placeNorm}` : base;
}

export function aggregateNutrients(items: PlateComponent[]): PlateNutrients {
  const totals = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  for (const item of items) {
    totals.kcal += item.kcal;
    totals.proteinG += item.protein ?? 0;
    totals.carbsG += item.carbs ?? 0;
    totals.fatG += item.fat ?? 0;
    totals.fiberG += item.fiber ?? 0;
  }
  return totals;
}

/** g protein per Rp1.000 — the "1,5 g per Rp1.000" number. Null without a real price. */
export function proteinPerRp1000(proteinG: number, priceIdr: number | null): number | null {
  if (priceIdr == null || priceIdr <= 0) return null;
  return proteinG / (priceIdr / 1000);
}

/** kcal per Rp1.000. Null without a real price. */
export function kcalPerRp1000(kcal: number, priceIdr: number | null): number | null {
  if (priceIdr == null || priceIdr <= 0) return null;
  return kcal / (priceIdr / 1000);
}

/** Monday-start WIB week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

/** First day of the WIB month containing `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function sumPriced(plates: PlateRow[]): number {
  return plates.reduce((sum, plate) => sum + (plate.priceIdr ?? 0), 0);
}

/**
 * Spending rollups for `today`: current WIB day, week (Monday-start), and
 * month, plus the average paid per meal slot over the last 30 days (null for
 * slots never priced). Null and zero prices are excluded everywhere.
 */
export function spendingSummary(
  plates: PlateRow[],
  today: string,
): {
  today: number;
  week: number;
  month: number;
  avgPerSlot: Record<Meal, number | null>;
} {
  const weekBoundary = weekStart(today);
  const monthBoundary = monthStart(today);
  const windowStart = shiftDate(today, -29); // 30-day window, today included
  const inWindow = plates.filter((plate) => plate.date >= windowStart && plate.date <= today);

  const slotTotals = new Map<Meal, { total: number; count: number }>();
  for (const plate of inWindow) {
    if (plate.priceIdr == null || plate.priceIdr <= 0) continue;
    const slot = plate.meal as Meal;
    if (!MEAL_SLOTS.includes(slot)) continue;
    const entry = slotTotals.get(slot) ?? { total: 0, count: 0 };
    entry.total += plate.priceIdr;
    entry.count += 1;
    slotTotals.set(slot, entry);
  }
  const avgPerSlot = Object.fromEntries(MEAL_SLOTS.map((slot) => [slot, null])) as Record<
    Meal,
    number | null
  >;
  for (const slot of MEAL_SLOTS) {
    const entry = slotTotals.get(slot);
    if (entry) avgPerSlot[slot] = Math.round(entry.total / entry.count);
  }

  return {
    today: sumPriced(plates.filter((p) => p.date === today)),
    week: sumPriced(plates.filter((p) => p.date >= weekBoundary && p.date <= today)),
    month: sumPriced(plates.filter((p) => p.date >= monthBoundary && p.date <= today)),
    avgPerSlot,
  };
}

/** Money left in the budget; may go negative when the budget is exceeded. */
export function budgetRemaining(spentInPeriod: number, budgetIdr: number | null): number | null {
  if (budgetIdr == null || budgetIdr <= 0) return null;
  return budgetIdr - spentInPeriod;
}

function byNewestFirst(a: PlateRow, b: PlateRow): number {
  const ca = typeof a.createdAt === "number" ? a.createdAt : 0;
  const cb = typeof b.createdAt === "number" ? b.createdAt : 0;
  if (ca !== cb) return cb - ca;
  return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
}

function pricedOnly(plates: PlateRow[]): PlateRow[] {
  return plates
    .filter((plate) => plate.priceIdr != null && plate.priceIdr > 0)
    .toSorted(byNewestFirst);
}

/**
 * Latest known price for a name (+place when given): exact name+place match
 * first, then name-only so "Nasi padang" autofills even when the warung
 * changed. Returns the matched plate's own canonical name and place.
 */
export function matchLastPrice(
  name: string,
  place: string | null | undefined,
  plates: PlateRow[],
): { priceIdr: number; name: string; place: string | null } | null {
  const priced = pricedOnly(plates);
  if (place && place.trim().length > 0) {
    const hit = priced.find((p) => plateKey(p.name, p.place) === plateKey(name, place));
    if (hit) return { priceIdr: hit.priceIdr!, name: hit.name, place: hit.place };
  }
  const hit = priced.find((p) => plateKey(p.name) === plateKey(name));
  return hit ? { priceIdr: hit.priceIdr!, name: hit.name, place: hit.place } : null;
}

export type BestValueEntry = {
  key: string;
  name: string;
  place: string | null;
  priceIdr: number;
  lastDate: string;
  nutrients: PlateNutrients;
  proteinPer1000: number;
  kcalPer1000: number;
};

/**
 * Rank the user's priced plates by protein per Rp1.000 (kcal per Rp1.000 as
 * tiebreak). Plates are deduped by name+place keeping the latest price;
 * entries without a usable price or without components are dropped.
 */
export function rankBestValue(
  plates: Array<PlateRow & { id: string }>,
  nutrientsByPlateId: Record<string, PlateNutrients>,
): BestValueEntry[] {
  const latest = new Map<string, PlateRow & { id: string }>();
  for (const plate of plates) {
    if (plate.priceIdr == null || plate.priceIdr <= 0) continue;
    const key = plateKey(plate.name, plate.place);
    const current = latest.get(key);
    if (!current || byNewestFirst(plate, current) < 0) latest.set(key, plate);
  }
  const entries: BestValueEntry[] = [];
  for (const plate of latest.values()) {
    const nutrients = nutrientsByPlateId[plate.id];
    if (!nutrients) continue;
    entries.push({
      key: plateKey(plate.name, plate.place),
      name: plate.name,
      place: plate.place,
      priceIdr: plate.priceIdr!,
      lastDate: plate.date,
      nutrients,
      proteinPer1000: proteinPerRp1000(nutrients.proteinG, plate.priceIdr)!,
      kcalPer1000: kcalPerRp1000(nutrients.kcal, plate.priceIdr)!,
    });
  }
  return entries.toSorted(
    (a, b) => b.proteinPer1000 - a.proteinPer1000 || b.kcalPer1000 - a.kcalPer1000,
  );
}

/**
 * Value map for meal-idea ranking: plateKey(plate name) → protein per
 * Rp1.000, deduped by name (place-less) with the best-scoring plate winning.
 */
export function ideaValueMap(
  plates: Array<PlateRow & { id: string }>,
  nutrientsByPlateId: Record<string, PlateNutrients>,
): Map<string, number> {
  const best = new Map<string, number>();
  for (const entry of rankBestValue(plates, nutrientsByPlateId)) {
    const key = plateKey(entry.name);
    const current = best.get(key);
    if (current === undefined || entry.proteinPer1000 > current)
      best.set(key, entry.proteinPer1000);
  }
  return best;
}
