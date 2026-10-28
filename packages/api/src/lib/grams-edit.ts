/**
 * Where a changed number on a scan row came from, so the accuracy report can tell a person fixing the dish from a
 * one-tap chip moving the weight. Client-safe (no library imports): the chip helpers stamp the row they return, the
 * apps send the stamps with the diary save (food.addScan `gramsFrom`), and lib/scan-outcome.ts reads them.
 *
 *   prior  "Biasanya" / "Porsi kebiasaanmu" chip (lib/portion-chip.ts)
 *   count  "Jumlah" stepper (lib/piece-chip.ts)
 *   bone   "Dengan / Tanpa tulang" (lib/bone-chip.ts)
 *   tare   "Termasuk wadah" container weight, or the rows' share after one is removed (lib/scale-chip.ts)
 *   scale  the scale-readout chip swapped to the other side
 *   half   "Setengah porsi"
 *   cup    the drink / size pick of a cup the photo hides
 *   size   "Kecil / Sedang / Besar" chip of "Berapa gram?" (lib/ask-grams.ts)
 *   alt    "Mungkin juga": an alternate dish name tapped (server side, from the session's altTaps)
 *   typed  anything else: the correction box, spoken, or a kcal typed on the row
 */
export const GRAMS_EDIT_SOURCES = ["prior", "count", "bone", "tare", "scale", "half", "cup", "size", "alt", "typed"] as const;
export type GramsEditSource = (typeof GRAMS_EDIT_SOURCES)[number];

/** Chips a row can carry a stamp of. `alt` and `typed` are decided at save, never stamped by a chip. */
export type StampSource = Exclude<GramsEditSource, "alt">;

/** A scan row that remembers which chips moved its numbers. */
export type GramsEditStamped = { gramsEdits?: StampSource[] };

/** The row with `source` added to its stamps (once). */
export function stampGramsEdit<T extends object>(item: T, source: StampSource): T {
  const stamps = (item as GramsEditStamped).gramsEdits ?? [];
  return stamps.includes(source) ? item : ({ ...item, gramsEdits: [...stamps, source] } as T);
}

/** The rows without their stamps (the AI baseline the save stores must stay what the model answered). */
export function withoutGramsEdits<T extends object>(items: readonly T[]): Array<Omit<T, "gramsEdits">> {
  return items.map((item) => {
    const { gramsEdits: _stamps, ...rest } = item as T & GramsEditStamped;
    return rest;
  });
}

/** What addScan sends for a row: its chip stamps, plus "typed" when the person typed its kcal. */
export function gramsFromOf(item: object, kcalTyped: boolean): StampSource[] | undefined {
  const stamps = (item as GramsEditStamped).gramsEdits ?? [];
  const all = kcalTyped && !stamps.includes("typed") ? [...stamps, "typed" as const] : stamps;
  return all.length > 0 ? all : undefined;
}
