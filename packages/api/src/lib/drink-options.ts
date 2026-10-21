import { DEFAULT_LOCALE } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

/**
 * A cup whose contents cannot be seen (a branded paper cup with a lid: McD,
 * KFC, Chatime...). The photo says "a drink in a cup", not which one, so the
 * scan answers with the most likely drink and the result screen offers the
 * usual options and the cup sizes instead of failing or guessing silently.
 * Shared by the scan parser and both clients: an item carries only the pick
 * (`CupChoice`); the numbers always come from here.
 *
 * Per 100 ml, rounded label/TKPI-style values. Sizes are the liquid in a
 * fountain cup with ice (S ~12 oz, M ~16 oz, L ~21 oz cups), estimates: the
 * app has no per-chain menu data.
 */

export const CUP_SIZES = [
  { id: "S", ml: 250 },
  { id: "M", ml: 350 },
  { id: "L", ml: 450 },
] as const;
export type CupSizeId = (typeof CUP_SIZES)[number]["id"];

type Per100 = { kcal: number; protein: number; carbs: number; fat: number };

export const CUP_DRINKS = [
  { id: "coke", names: { id: "Coca-Cola", en: "Coca-Cola", ms: "Coca-Cola" }, per100: { kcal: 42, protein: 0, carbs: 10.6, fat: 0 } },
  { id: "coke_zero", names: { id: "Coke Zero", en: "Coke Zero", ms: "Coke Zero" }, per100: { kcal: 0.3, protein: 0, carbs: 0, fat: 0 } },
  { id: "sprite", names: { id: "Sprite", en: "Sprite", ms: "Sprite" }, per100: { kcal: 40, protein: 0, carbs: 10, fat: 0 } },
  { id: "iced_tea", names: { id: "Es teh manis", en: "Iced sweet tea", ms: "Teh ais manis" }, per100: { kcal: 30, protein: 0, carbs: 7.5, fat: 0 } },
  { id: "coffee", names: { id: "Es kopi susu", en: "Iced milk coffee", ms: "Kopi susu ais" }, per100: { kcal: 55, protein: 1.5, carbs: 7.5, fat: 2 } },
  { id: "water", names: { id: "Air mineral", en: "Mineral water", ms: "Air mineral" }, per100: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
] as const satisfies ReadonlyArray<{
  id: string;
  names: Record<Locale, string>;
  per100: Per100;
}>;
export type CupDrinkId = (typeof CUP_DRINKS)[number]["id"];

/** What a cup item carries: which drink and which size it currently stands for. */
export type CupChoice = { drink: CupDrinkId; size: CupSizeId };

/** The first drink offered, and the one a branded cup is assumed to hold. */
const DEFAULT_DRINK: CupDrinkId = "coke";
const DEFAULT_SIZE: CupSizeId = "M";
/** A cup item is a guess until the user picks; shown as "35% sure". */
export const CUP_CONFIDENCE = 0.35;

const DRINK_PATTERNS: ReadonlyArray<[RegExp, CupDrinkId]> = [
  [/\b(zero|diet|light|sugar ?free)\b/i, "coke_zero"],
  [/\b(coca|coke|cola|pepsi)\b/i, "coke"],
  [/\bsprite\b|\blemon[- ]?lime\b/i, "sprite"],
  [/\b(teh|tea)\b/i, "iced_tea"],
  [/\b(kopi|coffee|latte|cappuccino|mocha|americano)\b/i, "coffee"],
  [/\b(air|water|mineral|aqua)\b/i, "water"],
];

function drinkOf(id: CupDrinkId) {
  return CUP_DRINKS.find((drink) => drink.id === id)!;
}

function sizeOf(id: CupSizeId) {
  return CUP_SIZES.find((size) => size.id === id)!;
}

/** The model's best guess ("Coca-Cola", "Minuman bersoda") and cup size ("M") as a valid pick. */
export function guessCupChoice(name: string | undefined, size: string | undefined): CupChoice {
  const label = name ?? "";
  const drink = DRINK_PATTERNS.find(([pattern]) => pattern.test(label))?.[1] ?? DEFAULT_DRINK;
  const sized = CUP_SIZES.find((candidate) => candidate.id === size?.trim().toUpperCase());
  return { drink, size: sized?.id ?? DEFAULT_SIZE };
}

/** Chip label of one drink in the user's language. */
export function cupDrinkName(id: CupDrinkId, locale: Locale = DEFAULT_LOCALE): string {
  return drinkOf(id).names[locale];
}

/** Chip label of one size: "S · 250 ml". */
export function cupSizeLabel(id: CupSizeId): string {
  return `${id} · ${sizeOf(id).ml} ml`;
}

/** The scan item for a pick: name, ml (as grams), kcal and macros for that cup. */
export function cupItem(choice: CupChoice, locale: Locale = DEFAULT_LOCALE) {
  const drink = drinkOf(choice.drink);
  const size = sizeOf(choice.size);
  const scale = size.ml / 100;
  const round1 = (value: number) => Math.round(value * 10) / 10;
  return {
    name: drink.names[DEFAULT_LOCALE],
    localName: drink.names[locale],
    portion: cupSizeLabel(choice.size),
    grams: size.ml,
    kcal: Math.round(drink.per100.kcal * scale),
    protein: round1(drink.per100.protein * scale),
    carbs: round1(drink.per100.carbs * scale),
    fat: round1(drink.per100.fat * scale),
    fiber: 0,
  };
}

/**
 * The row a pick turns into on the result screen: the cup's numbers with the
 * name in the user's language. The pick is the user's own choice, so the row
 * stops carrying the model's confidence.
 */
export function cupPick(choice: CupChoice, locale: Locale = DEFAULT_LOCALE) {
  const { localName, ...item } = cupItem(choice, locale);
  return { ...item, name: localName, kind: "minuman" as const, cup: choice, confidence: undefined };
}
