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
