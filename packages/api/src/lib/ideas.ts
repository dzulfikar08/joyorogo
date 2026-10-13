import type { Meal } from "./engine";
import { plateKey } from "./plates";

export type MealIdea = { name: string; kcal: number; proteinG: number };

type CatalogIdea = MealIdea & { slots: Meal[] };

const MAIN: Meal[] = ["sarapan", "makan_siang", "makan_malam", "sahur", "berbuka"];
const LUNCH_DINNER: Meal[] = ["makan_siang", "makan_malam", "sahur", "berbuka"];
const BREAKFAST: Meal[] = ["sarapan", "sahur"];
const SNACK: Meal[] = ["snack", "berbuka"];

// Home/warung portions, rounded from TKPI 2019 per-100 g values. Half rice
// (≈100 g, 180 kcal) is the default because it's the easiest swap to keep.
const CATALOG: CatalogIdea[] = [
  { name: "Ayam bakar + nasi ½ + lalapan", kcal: 430, proteinG: 34, slots: LUNCH_DINNER },
  { name: "Ikan bakar + nasi ½ + sayur asem", kcal: 420, proteinG: 32, slots: LUNCH_DINNER },
  { name: "Pepes ikan + nasi ½ + lalapan", kcal: 360, proteinG: 28, slots: LUNCH_DINNER },
  {
    name: "Pindang tongkol + nasi ½ + tumis kangkung",
    kcal: 400,
    proteinG: 30,
    slots: LUNCH_DINNER,
  },
  { name: "Sate ayam 10 tusuk, bumbu sedikit", kcal: 380, proteinG: 32, slots: LUNCH_DINNER },
  { name: "Ayam geprek tanpa kulit + nasi ½", kcal: 520, proteinG: 35, slots: LUNCH_DINNER },
  { name: "Sup ayam + nasi ½", kcal: 340, proteinG: 24, slots: LUNCH_DINNER },
  { name: "Soto ayam bening + nasi ½", kcal: 330, proteinG: 22, slots: MAIN },
  { name: "Bakso kuah tanpa mi", kcal: 300, proteinG: 20, slots: LUNCH_DINNER },
  { name: "Tahu + tempe bacem + sayur bening + nasi ½", kcal: 420, proteinG: 20, slots: MAIN },
  { name: "Gado-gado, bumbu setengah", kcal: 350, proteinG: 15, slots: LUNCH_DINNER },
  { name: "Omelet 2 telur + sayur + nasi ½", kcal: 380, proteinG: 18, slots: MAIN },
  { name: "Roti gandum 2 lembar + 2 telur rebus", kcal: 320, proteinG: 18, slots: BREAKFAST },
  { name: "Bubur ayam tanpa kerupuk", kcal: 300, proteinG: 14, slots: BREAKFAST },
  { name: "Oatmeal + susu + pisang", kcal: 320, proteinG: 12, slots: BREAKFAST },
  { name: "2 telur rebus", kcal: 150, proteinG: 13, slots: SNACK },
  { name: "Tempe kukus 2 potong", kcal: 160, proteinG: 14, slots: SNACK },
  { name: "Tahu kukus 2 potong", kcal: 90, proteinG: 9, slots: SNACK },
  { name: "Edamame 1 mangkuk kecil", kcal: 120, proteinG: 11, slots: SNACK },
  { name: "Yogurt plain + buah", kcal: 150, proteinG: 8, slots: SNACK },
  { name: "Susu kedelai tawar 1 gelas", kcal: 100, proteinG: 7, slots: SNACK },
  { name: "Kacang rebus 1 genggam", kcal: 130, proteinG: 6, slots: SNACK },
  { name: "Buah potong 1 mangkuk", kcal: 80, proteinG: 1, slots: SNACK },
];

/** Below this the honest answer is "air putih", not a meal idea. */
const MIN_REMAINING_KCAL = 80;

/**
 * Up to `limit` ideas for `slot` that fit `remainingKcal`, protein per kcal
 * first — protein is what keeps a deficit bearable. Main-meal ideas must be a
 * real meal (≥ 35% of what's left, capped at 250 kcal) so a big remaining
 * budget doesn't get answered with a single egg; when no meal fits, snacks do.
 * `valueByName` (plateKey(name) → protein per Rp1.000, from the user's priced
 * plates) re-sorts the best-value plates to the front without changing which
 * ideas fit.
 */
export function mealIdeas(
  remainingKcal: number,
  slot: Meal,
  limit = 3,
  valueByName?: Map<string, number>,
): MealIdea[] {
  if (remainingKcal < MIN_REMAINING_KCAL) return [];
  const floor = slot === "snack" ? 0 : Math.min(250, remainingKcal * 0.35);
  const fitting = CATALOG.filter(
    (idea) => idea.slots.includes(slot) && idea.kcal <= remainingKcal && idea.kcal >= floor,
  );
  if (fitting.length === 0 && slot !== "snack") return mealIdeas(remainingKcal, "snack", limit);
  const byProteinDensity = (a: CatalogIdea, b: CatalogIdea) =>
    b.proteinG / b.kcal - a.proteinG / a.kcal;
  const valueOf = (idea: CatalogIdea) => valueByName?.get(plateKey(idea.name)) ?? -1;
  const ranked =
    valueByName && valueByName.size > 0
      ? // best value first; protein density keeps the order among unpriced ideas
        fitting.toSorted((a, b) => valueOf(b) - valueOf(a) || byProteinDensity(a, b))
      : fitting.toSorted(byProteinDensity);
  return ranked.slice(0, limit).map(({ name, kcal, proteinG }) => ({ name, kcal, proteinG }));
}
