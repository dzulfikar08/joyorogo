/**
 * Server half of "Berapa gram?" (lib/ask-grams.ts holds the rule and the client helpers): marks the answer's only
 * row with `askGrams` and, when the curated library knows the dish's typical serving, the three size chips
 * (Kecil / Sedang / Besar = that serving x 0.5 / 1 / 1.5, rounded to 5 g). A food only the TKPI 2019 table knows
 * has no portion size there, so it gets the typed box alone. Kept apart from ask-grams.ts so the apps never pull
 * the food library in through it.
 */
import type { Region } from "@joyorogo/i18n";

import { shouldAskGrams, sizeOptionsOf } from "./ask-grams";
import type { SizeOptions } from "./ask-grams";
import { typicalPortionG } from "./tkpi";

/** The rows as the user sees them: the lone row carries `askGrams` (and `sizeOptions`) when the rule holds. */
export function withAskGrams<T extends Parameters<typeof shouldAskGrams>[0][number] & { name: string }>(
  items: T[],
  region?: Region,
): Array<T & { askGrams?: true; sizeOptions?: SizeOptions }> {
  if (!shouldAskGrams(items)) return items;
  const [item] = items;
  const sizeOptions = sizeOptionsOf(typicalPortionG(item!.name, region));
  return [{ ...item!, askGrams: true as const, ...(sizeOptions ? { sizeOptions } : {}) }];
}
