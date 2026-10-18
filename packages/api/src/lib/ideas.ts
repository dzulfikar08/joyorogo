import { getActiveLocale, getT, resources } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import type { Meal } from "./engine";
import { REACHED_MARGIN_KCAL } from "./gain";
import { plateKey } from "./plates";

export type MealIdea = { name: string; kcal: number; proteinG: number };

type IdeaId = keyof typeof resources.id.tips.ideas;

type CatalogIdea = Omit<MealIdea, "name"> & { id: IdeaId; slots: Meal[] };

const MAIN: Meal[] = ["sarapan", "makan_siang", "makan_malam", "sahur", "berbuka"];
const LUNCH_DINNER: Meal[] = ["makan_siang", "makan_malam", "sahur", "berbuka"];
const BREAKFAST: Meal[] = ["sarapan", "sahur"];
const SNACK: Meal[] = ["snack", "berbuka"];

// Home/warung portions, rounded from TKPI 2019 per-100 g values. Half rice
// (≈100 g, 180 kcal) is the default because it's the easiest swap to keep.
const CATALOG: CatalogIdea[] = [
  { id: "ayamBakarLalapan", kcal: 430, proteinG: 34, slots: LUNCH_DINNER },
  { id: "ikanBakarSayurAsem", kcal: 420, proteinG: 32, slots: LUNCH_DINNER },
  { id: "pepesIkan", kcal: 360, proteinG: 28, slots: LUNCH_DINNER },
  {
    id: "pindangTongkol",
    kcal: 400,
    proteinG: 30,
    slots: LUNCH_DINNER,
  },
  { id: "sateAyam", kcal: 380, proteinG: 32, slots: LUNCH_DINNER },
  { id: "ayamGeprek", kcal: 520, proteinG: 35, slots: LUNCH_DINNER },
  { id: "supAyam", kcal: 340, proteinG: 24, slots: LUNCH_DINNER },
  { id: "sotoAyam", kcal: 330, proteinG: 22, slots: MAIN },
  { id: "baksoKuah", kcal: 300, proteinG: 20, slots: LUNCH_DINNER },
  { id: "tahuTempeBacem", kcal: 420, proteinG: 20, slots: MAIN },
  { id: "gadoGado", kcal: 350, proteinG: 15, slots: LUNCH_DINNER },
  { id: "omelet", kcal: 380, proteinG: 18, slots: MAIN },
  { id: "rotiGandumTelur", kcal: 320, proteinG: 18, slots: BREAKFAST },
  { id: "buburAyam", kcal: 300, proteinG: 14, slots: BREAKFAST },
  { id: "oatmeal", kcal: 320, proteinG: 12, slots: BREAKFAST },
  { id: "telurRebus", kcal: 150, proteinG: 13, slots: SNACK },
  { id: "tempeKukus", kcal: 160, proteinG: 14, slots: SNACK },
  { id: "tahuKukus", kcal: 90, proteinG: 9, slots: SNACK },
  { id: "edamame", kcal: 120, proteinG: 11, slots: SNACK },
  { id: "yogurt", kcal: 150, proteinG: 8, slots: SNACK },
  { id: "susuKedelai", kcal: 100, proteinG: 7, slots: SNACK },
  { id: "kacangRebus", kcal: 130, proteinG: 6, slots: SNACK },
  { id: "buahPotong", kcal: 80, proteinG: 1, slots: SNACK },
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
 * ideas fit; it is matched against the Indonesian name, whatever `locale` is.
 * Names follow `locale` (clients: the active language; server: the request's).
 */
export function mealIdeas(
  remainingKcal: number,
  slot: Meal,
  limit = 3,
  valueByName?: Map<string, number>,
  locale: Locale = getActiveLocale(),
): MealIdea[] {
  if (remainingKcal < MIN_REMAINING_KCAL) return [];
  const floor = slot === "snack" ? 0 : Math.min(250, remainingKcal * 0.35);
  const fitting = CATALOG.filter(
    (idea) => idea.slots.includes(slot) && idea.kcal <= remainingKcal && idea.kcal >= floor,
  );
  if (fitting.length === 0 && slot !== "snack") {
    return mealIdeas(remainingKcal, "snack", limit, undefined, locale);
  }
  const byProteinDensity = (a: CatalogIdea, b: CatalogIdea) =>
    b.proteinG / b.kcal - a.proteinG / a.kcal;
  const valueOf = (idea: CatalogIdea) =>
    valueByName?.get(plateKey(resources.id.tips.ideas[idea.id])) ?? -1;
  const ranked =
    valueByName && valueByName.size > 0
      ? // best value first; protein density keeps the order among unpriced ideas
        fitting.toSorted((a, b) => valueOf(b) - valueOf(a) || byProteinDensity(a, b))
      : fitting.toSorted(byProteinDensity);
  const t = getT(locale, "tips");
  return ranked
    .slice(0, limit)
    .map(({ id, kcal, proteinG }) => ({ name: t(`ideas.${id}`), kcal, proteinG }));
}

// Naikin BB ideas: calorie-dense and still ordinary food (nasi, telur, tempe, ayam, susu,
// kacang, alpukat). Home portions from TKPI 2019 per-100 g values: nasi 180 kcal (200 g is
// one plate), telur dadar 251, tempe goreng pasar 336, ayam goreng kalasan paha 275, tahu
// goreng 115, susu sapi 61, kacang tanah goreng 564, pisang ambon 108, ubi jalar kuning
// kukus 100, alpukat 85, roti putih 248.
const GAIN_CATALOG: CatalogIdea[] = [
  { id: "gainNasiTelurTempe", kcal: 780, proteinG: 32, slots: LUNCH_DINNER },
  { id: "gainNasiAyamTahu", kcal: 730, proteinG: 51, slots: LUNCH_DINNER },
  { id: "gainNasiTempeSayur", kcal: 640, proteinG: 22, slots: MAIN },
  { id: "gainRotiTelurSusu", kcal: 590, proteinG: 30, slots: BREAKFAST },
  { id: "gainUbiTelur", kcal: 350, proteinG: 14, slots: SNACK },
  { id: "gainTempeTahuGoreng", kcal: 345, proteinG: 23, slots: SNACK },
  { id: "gainJusAlpukatSusu", kcal: 300, proteinG: 8, slots: SNACK },
  { id: "gainSusuPisang", kcal: 285, proteinG: 9, slots: SNACK },
  { id: "gainKacangPisang", kcal: 235, proteinG: 8, slots: SNACK },
];

/** Under this much still to eat, "Target tercapai" is the answer, not another idea. */
const MIN_GAIN_REMAINING_KCAL = 100;

/**
 * Up to `limit` calorie-dense ideas for `slot` that fill what is still to eat (a little
 * over is fine, up to the same margin as "Target tercapai"), the biggest first. A main
 * meal must cover at least 35% of what is left (capped at 250 kcal); when no meal does,
 * the snacks answer.
 */
export function gainMealIdeas(
  remainingKcal: number,
  slot: Meal,
  limit = 3,
  locale: Locale = getActiveLocale(),
): MealIdea[] {
  if (remainingKcal < MIN_GAIN_REMAINING_KCAL) return [];
  const floor = slot === "snack" ? 0 : Math.min(250, remainingKcal * 0.35);
  const fitting = GAIN_CATALOG.filter(
    (idea) =>
      idea.slots.includes(slot) &&
      idea.kcal <= remainingKcal + REACHED_MARGIN_KCAL &&
      idea.kcal >= floor,
  );
  if (fitting.length === 0 && slot !== "snack") {
    return gainMealIdeas(remainingKcal, "snack", limit, locale);
  }
  const t = getT(locale, "tips");
  return fitting
    .toSorted((a, b) => b.kcal - a.kcal)
    .slice(0, limit)
    .map(({ id, kcal, proteinG }) => ({ name: t(`ideas.${id}`), kcal, proteinG }));
}
