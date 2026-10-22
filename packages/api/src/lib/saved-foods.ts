import { z } from "zod";

import { plateKey } from "./plates";

// Pure helpers for Favorit (saved foods). A favorite is a frozen copy of one
// food row or one plate's rows; re-logging copies the components back into
// the viewed day and slot.

/** One component of a favorite: the food_log fields worth keeping. */
export const savedItemSchema = z.object({
  name: z.string().min(1).max(200),
  grams: z.number().nullable(),
  kcal: z.number(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  fiber: z.number().nullable(),
  // sticker / original photo reference, kept so a re-log looks like the original
  scanId: z.string().nullable(),
  photoId: z.string().nullable(),
});
export type SavedItem = z.infer<typeof savedItemSchema>;

const itemsSchema = z.array(savedItemSchema);

/** Parses stored items_json; a corrupt blob yields no items instead of throwing. */
export function parseSavedItems(json: string): SavedItem[] {
  try {
    const parsed = itemsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Content fingerprint of a single food: same dish and kcal = same favorite. */
export function foodSavedKey(name: string, kcal: number): string {
  return `${plateKey(name)}|${Math.round(kcal)}`;
}

/** Content fingerprint of a plate: name, place, total kcal and component count. */
export function plateSavedKey(
  name: string,
  place: string | null | undefined,
  items: ReadonlyArray<{ kcal: number }>,
): string {
  const total = items.reduce((sum, item) => sum + item.kcal, 0);
  return `plate:${plateKey(name, place)}|${Math.round(total)}|${items.length}`;
}

const known = (item: SavedItem) =>
  [item.grams, item.protein, item.carbs, item.fat, item.fiber].filter((value) => value !== null).length;

/**
 * Starring the same dish again (same key) used to answer the stored favorite untouched, so a favorite saved from a
 * row that had no macros stayed macro-less after the row was filled in. True when `next` carries more known
 * nutrition than `stored` for the same components, so the favorite can take it over; never the other way around.
 */
export function carriesMoreNutrition(next: readonly SavedItem[], stored: readonly SavedItem[]): boolean {
  if (next.length !== stored.length || next.length === 0) return false;
  const total = (items: readonly SavedItem[]) => items.reduce((sum, item) => sum + known(item), 0);
  return next.every((item, i) => known(item) >= known(stored[i]!)) && total(next) > total(stored);
}

/** `ids` with `id` moved one place up (-1) or down (+1); unchanged when it is absent or already at that end. */
export function moveId(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
