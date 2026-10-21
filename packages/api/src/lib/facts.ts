/**
 * Curated geprek-style calorie facts (Indonesian portions, rough averages).
 * Shared by web and native loading screens + the daily dashboard card.
 * Text lives in the `scan` namespace (`fact.food.<id>`); a fact is built in
 * the requested language by `pickFact` / `randomFact`.
 */

import { fmtNumber, getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

type FactSpec = {
  id: string;
  kcal: number;
  kind: "run" | "walk" | "bike";
  minutes: number;
};

/** One pack of Indomie Mi Goreng (85 g), the label's 380 kcal: the unit of the scan result's "Setara N bungkus Indomie". */
export const INDOMIE_PACK_KCAL = 380;

/** How many Indomie packs `kcal` is, to one decimal (0 below 0.05). */
export function indomiePacks(kcal: number): number {
  return Math.round((Math.max(0, kcal) / INDOMIE_PACK_KCAL) * 10) / 10;
}

/** "Setara 1,5 bungkus Indomie" in the requested language; null when it would round to zero. */
export function indomieLine(kcal: number, locale: Locale = getActiveLocale()): string | null {
  const packs = indomiePacks(kcal);
  if (packs <= 0) return null;
  return getT(locale, "scan")("result.indomie", { count: packs, packs: fmtNumber(packs, 1, locale) });
}

export const FOOD_FACTS = [
  { id: "gepreK", kcal: 600, kind: "run", minutes: 55 },
  { id: "nasiGoreng", kcal: 640, kind: "walk", minutes: 90 },
  { id: "martabak", kcal: 510, kind: "bike", minutes: 50 },
  { id: "indomie", kcal: INDOMIE_PACK_KCAL, kind: "run", minutes: 35 },
  { id: "sate", kcal: 480, kind: "walk", minutes: 60 },
  { id: "kopiSusu", kcal: 300, kind: "walk", minutes: 45 },
  { id: "bakso", kcal: 550, kind: "run", minutes: 50 },
  { id: "soto", kcal: 350, kind: "walk", minutes: 50 },
  { id: "mieAyam", kcal: 430, kind: "bike", minutes: 40 },
  { id: "rotiBakar", kcal: 320, kind: "walk", minutes: 40 },
  { id: "nasiPadang", kcal: 720, kind: "run", minutes: 60 },
  { id: "gorengan", kcal: 150, kind: "walk", minutes: 20 },
  { id: "mcdChicken", kcal: 470, kind: "run", minutes: 45 },
  { id: "tehTarik", kcal: 320, kind: "walk", minutes: 40 },
  { id: "kwetiau", kcal: 520, kind: "run", minutes: 45 },
  { id: "risoles", kcal: 420, kind: "bike", minutes: 40 },
  { id: "pempek", kcal: 350, kind: "walk", minutes: 40 },
  { id: "cincau", kcal: 260, kind: "walk", minutes: 30 },
  { id: "pecelLele", kcal: 610, kind: "run", minutes: 55 },
  { id: "bubur", kcal: 300, kind: "walk", minutes: 35 },
  { id: "ketoprak", kcal: 490, kind: "bike", minutes: 45 },
  { id: "pisangGoreng", kcal: 230, kind: "walk", minutes: 25 },
  { id: "seblak", kcal: 400, kind: "run", minutes: 35 },
  { id: "cireng", kcal: 380, kind: "walk", minutes: 45 },
] as const satisfies readonly FactSpec[];

export type FoodFact = {
  /** Dish and portion, in the requested language. */
  text: string;
  kcal: number;
  /** Equivalent effort, e.g. "lari 55 menit" / "55 minutes of running". */
  move: string;
};

function localize(spec: (typeof FOOD_FACTS)[number], locale: Locale): FoodFact {
  const t = getT(locale, "scan");
  const duration =
    spec.minutes < 60
      ? t("fact.duration.minutes", { count: spec.minutes })
      : t("fact.duration.hours", {
          count: spec.minutes / 60,
          value: fmtNumber(spec.minutes / 60, 1, locale),
        });
  return {
    text: t(`fact.food.${spec.id}`),
    kcal: spec.kcal,
    move: t(`fact.move.${spec.kind}`, { duration }),
  };
}

/** Stable pick by 'YYYY-MM-DD' — same fact all day, changes daily. */
export function pickFact(date: string, locale: Locale = getActiveLocale()): FoodFact {
  let hash = 0;
  for (const ch of date) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  return localize(FOOD_FACTS[hash % FOOD_FACTS.length]!, locale);
}

/** Random fact — for loading screens where variety beats determinism. */
export function randomFact(locale: Locale = getActiveLocale()): FoodFact {
  return localize(FOOD_FACTS[Math.floor(Math.random() * FOOD_FACTS.length)]!, locale);
}
