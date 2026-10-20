/**
 * Kitchen-scale readout on a scan row: the weight came off a scale display in
 * the photo (lib/scale-reading.ts), the model's own photo estimate is one tap
 * away. Client-safe (no library imports): both apps swap the two sides with this.
 */
import { numbersOf } from "./portion-chip";
import type { PortionNumbers } from "./portion-chip";

export type ScaleUnit = "g" | "kg" | "oz" | "lb" | "ml" | "fl oz";

export type ScaleReadChip = {
  /** Which numbers the row shows: the scale's or the photo estimate's. */
  active: "scale" | "ai";
  /** The numbers the other side of the chip would put on the row. */
  other: PortionNumbers;
  /** The digits as the display showed them ("100", "3.5") and their unit. */
  text: string;
  unit: ScaleUnit;
  /** The whole reading in grams (a row shows its share of it when `count` > 1). */
  grams: number;
  /** Rows the reading was spread over (1 = this row alone). */
  count: number;
};

type Swappable = Omit<PortionNumbers, "grams"> & { grams?: number; scaleRead?: ScaleReadChip };

/** The row after one tap on the chip: the other side's numbers set, the current ones kept for the next tap. */
export function swapScaleRead<T extends Swappable>(item: T): T {
  const chip = item.scaleRead;
  if (!chip || item.grams === undefined) return item;
  const { portion: _drop, ...rest } = item;
  return {
    ...rest,
    ...chip.other,
    scaleRead: {
      ...chip,
      active: chip.active === "scale" ? "ai" : "scale",
      other: numbersOf({ ...item, grams: item.grams }),
    },
  } as T;
}

/**
 * What the display read, for "Terbaca dari timbangan: {{value}}": the grams
 * alone when the display was in grams, otherwise the display's own number and
 * unit with the grams beside it. `fmtGrams` is the client's "100 g" formatter.
 */
export function scaleValue(chip: Pick<ScaleReadChip, "text" | "unit" | "grams">, fmtGrams: (grams: number) => string): string {
  return chip.unit === "g" ? fmtGrams(chip.grams) : `${chip.text} ${chip.unit} (${fmtGrams(chip.grams)})`;
}

/** The photo estimate and the scale's weight of this row, whichever side is showing. */
export function scaleGrams(item: { grams?: number; scaleRead?: ScaleReadChip }): { ai: number; scale: number } | null {
  const chip = item.scaleRead;
  if (!chip || item.grams === undefined) return null;
  return chip.active === "scale"
    ? { scale: item.grams, ai: chip.other.grams }
    : { ai: item.grams, scale: chip.other.grams };
}

/** The list as stored in a diary row's items_json: without the chip's second set of numbers. */
export function withoutScaleRead<T extends { scaleRead?: unknown }>(items: readonly T[]): Array<Omit<T, "scaleRead">> {
  return items.map(({ scaleRead: _chip, ...rest }) => rest);
}
