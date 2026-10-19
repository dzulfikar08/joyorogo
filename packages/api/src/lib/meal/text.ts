// Text helpers of the planner: name normalisation, whole-word matching and the deterministic seeded hash.

import type { Allergen } from "./types";

/** lowercase, accents/punctuation out, single spaces: "Ayam Bakar (Madu)!" -> "ayam bakar madu". */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Is `phrase` in `text` as whole words? Both already normalised. */
export function hasPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

/** FNV-1a, 32 bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable pseudo-random number in [0, 1) for a string key. */
export function unit(s: string): number {
  // one more round of mixing so keys that differ in the last character do not give neighbouring values
  let h = hash32(s);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Words that tell a logged food name carries an allergen. Best effort on free text (history foods have no ingredient
 * list); the catalog itself is filtered exactly by ingredient. Deliberately generous: a false hit only hides a food.
 */
export const ALLERGEN_WORDS: Record<Allergen, string[]> = {
  seafood: ["ikan", "udang", "cumi", "kerang", "kepiting", "rajungan", "seafood", "tuna", "salmon", "sarden", "teri", "terasi", "tongkol", "kembung", "lele", "gurame", "bandeng", "pempek", "otak otak", "siomay", "batagor", "fish", "shrimp", "squid", "crab", "bakso ikan", "rica rica"],
  kacang: ["kacang", "pecel", "gado", "karedok", "lotek", "ketoprak", "sate", "satay", "peanut", "bumbu kacang", "siomay", "batagor", "oncom"],
  telur: ["telur", "telor", "egg", "omelet", "omelette", "dadar", "ceplok", "martabak", "kwetiau", "nasi goreng", "bubur ayam", "ketoprak", "mayones", "mayonnaise"],
  susu: ["susu", "milk", "keju", "cheese", "yoghurt", "yogurt", "latte", "cappuccino", "cappucino", "krim", "cream", "es krim", "ice cream", "mentega", "butter", "martabak"],
  gluten: ["roti", "mie", "mi", "bakmi", "pasta", "spaghetti", "makaroni", "pizza", "burger", "donat", "donut", "kue", "biskuit", "terigu", "bakso", "martabak", "gorengan", "bakwan", "pangsit", "dimsum", "siomay", "batagor", "bread", "noodle", "pancake", "waffle", "croissant", "sandwich"],
  kedelai: ["tahu", "tempe", "tempeh", "tofu", "kedelai", "soy", "kecap", "tauco", "edamame", "susu kedelai", "oncom"],
};

export function nameHitsAllergen(norm: string, allergens: readonly Allergen[]): boolean {
  return allergens.some((a) => ALLERGEN_WORDS[a].some((w) => hasPhrase(norm, normName(w))));
}
