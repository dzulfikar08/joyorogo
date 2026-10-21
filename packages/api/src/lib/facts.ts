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

/** One pack of Indomie Mi Goreng (85 g), the label's 380 kcal: the unit of the Indonesian scan result's "Setara N bungkus Indomie". */
export const INDOMIE_PACK_KCAL = 380;

/**
 * One roti canai (71 g, HPB SG FoodID F05030010 "Plain prata", 347 kcal per 100 g): the unit of the Bahasa Melayu
 * scan result's "Bersamaan N keping roti canai". A single piece, sold everywhere in Malaysia, and in the dish data
 * (lib/myfcd-dishes.ts; facts.test.ts keeps the two equal). Not imported from there: the dish table is 200 rows
 * and this module ships in the app bundles.
 */
export const ROTI_CANAI_PIECE_KCAL = 246;

/** What the scan result compares a total to: a pack of Indomie for Indonesia, a piece of roti canai for Malaysia. */
function equivalentUnit(locale: Locale): { kcal: number; key: "result.indomie" | "result.rotiCanai" } {
  return locale === "ms"
    ? { kcal: ROTI_CANAI_PIECE_KCAL, key: "result.rotiCanai" }
    : { kcal: INDOMIE_PACK_KCAL, key: "result.indomie" };
}

/** How many of the locale's reference unit `kcal` is, to one decimal (0 below 0.05). */
export function equivalentUnits(kcal: number, locale: Locale = getActiveLocale()): number {
  return Math.round((Math.max(0, kcal) / equivalentUnit(locale).kcal) * 10) / 10;
}

/** "Setara 1,5 bungkus Indomie" / "Bersamaan 1.5 keping roti canai" in the requested language; null when it would round to zero. */
export function equivalentLine(kcal: number, locale: Locale = getActiveLocale()): string | null {
  const units = equivalentUnits(kcal, locale);
  if (units <= 0) return null;
  return getT(locale, "scan")(equivalentUnit(locale).key, { count: units, packs: fmtNumber(units, 1, locale) });
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

/**
 * The Bahasa Melayu pool: Malaysian dishes at the weights of the HPB SG FoodID entries behind lib/myfcd-dishes.ts
 * (kcal rounded to 5; facts.test.ts checks each against that table). No pork dish: these show to everyone, and
 * the product never labels food halal or not (docs/marketing/malaysia-plan.md). Effort minutes use the same
 * rough rates as the pool above (about 11 kcal a minute running, 7.5 walking, 10 cycling).
 */
export const FOOD_FACTS_MY = [
  { id: "nasiLemak", kcal: 630, kind: "run", minutes: 55 },
  { id: "rotiCanai", kcal: 245, kind: "walk", minutes: 35 },
  { id: "miloAis", kcal: 290, kind: "walk", minutes: 40 },
  { id: "charKueyTeow", kcal: 975, kind: "run", minutes: 90 },
  { id: "meeGorengMamak", kcal: 830, kind: "bike", minutes: 85 },
  { id: "laksa", kcal: 415, kind: "walk", minutes: 55 },
  { id: "cendol", kcal: 345, kind: "walk", minutes: 45 },
  { id: "karipap", kcal: 290, kind: "run", minutes: 25 },
  { id: "nasiAyam", kcal: 510, kind: "run", minutes: 45 },
  { id: "satay", kcal: 545, kind: "walk", minutes: 70 },
  { id: "pisangGoreng", kcal: 235, kind: "walk", minutes: 30 },
  { id: "kuihLapis", kcal: 120, kind: "walk", minutes: 15 },
  { id: "nasiLemakAyam", kcal: 905, kind: "run", minutes: 80 },
] as const satisfies readonly FactSpec[];

const POOLS = { id: FOOD_FACTS, en: FOOD_FACTS, ms: FOOD_FACTS_MY } as const;

export type FoodFact = {
  /** Dish and portion, in the requested language. */
  text: string;
  kcal: number;
  /** Equivalent effort, e.g. "lari 55 menit" / "55 minutes of running". */
  move: string;
};

function localize(spec: (typeof FOOD_FACTS)[number] | (typeof FOOD_FACTS_MY)[number], locale: Locale): FoodFact {
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
  const pool: ReadonlyArray<(typeof FOOD_FACTS)[number] | (typeof FOOD_FACTS_MY)[number]> = POOLS[locale];
  return localize(pool[hash % pool.length]!, locale);
}

/** Random fact — for loading screens where variety beats determinism. */
export function randomFact(locale: Locale = getActiveLocale()): FoodFact {
  const pool: ReadonlyArray<(typeof FOOD_FACTS)[number] | (typeof FOOD_FACTS_MY)[number]> = POOLS[locale];
  return localize(pool[Math.floor(Math.random() * pool.length)]!, locale);
}
