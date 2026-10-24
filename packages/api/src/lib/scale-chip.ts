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
  /**
   * "Termasuk wadah": grams of the empty bowl or plate the person took off the reading (the scale weighed it with
   * the food). Absent = the reading is all food. The rows then share `grams - tare`.
   */
  tare?: number;
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

/** Food grams of a reading after the container: null when the container is not lighter than the reading. */
export function netScaleGrams(chip: Pick<ScaleReadChip, "grams">, tare: number): number | null {
  if (!Number.isFinite(tare) || tare < 0) return null;
  const net = Math.round(chip.grams - tare);
  return net >= 1 ? net : null;
}

/** Typical empty containers offered beside the remembered ones; the UI labels them as estimates ("±"). */
export const CONTAINER_PRESETS = [
  { key: "bowl", grams: 350 },
  { key: "plate", grams: 400 },
] as const;

/** Container weights kept on a device, newest first. */
export const MAX_REMEMBERED_CONTAINERS = 3;

/** The remembered containers after one is used: newest first, a weight within 5 g of it replaced, at most three. */
export function rememberContainer(list: readonly number[], grams: number): number[] {
  const g = Math.round(grams);
  return [g, ...list.filter((old) => Math.abs(old - g) > 5)].slice(0, MAX_REMEMBERED_CONTAINERS);
}

/** A stored list read back: whole positive grams only, at most three (a corrupt value gives an empty list). */
export function parseContainers(raw: string | null | undefined): number[] {
  try {
    const list: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(list)
      ? list
          .filter((g): g is number => typeof g === "number" && Number.isFinite(g) && g >= 1 && g < 5000)
          .map(Math.round)
          .slice(0, MAX_REMEMBERED_CONTAINERS)
      : [];
  } catch {
    return [];
  }
}

/** The same food at another weight: kcal and macros follow the grams (its kcal per gram stays). */
const scaledBy = (n: PortionNumbers, grams: number): PortionNumbers => {
  const factor = n.grams > 0 ? grams / n.grams : 1;
  const one = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * factor * 10) / 10);
  return numbersOf({
    ...n,
    grams,
    kcal: Math.round(n.kcal * factor),
    protein: one(n.protein),
    carbs: one(n.carbs),
    fat: one(n.fat),
    fiber: one(n.fiber),
  });
};

/**
 * The list after "Termasuk wadah": every row the reading covers gets its share of `reading - tare` (tare 0 puts the
 * whole reading back), in the proportions the rows had, with kcal and macros scaled along (the food's kcal per gram
 * stays). A row showing the photo estimate keeps it and gets the new scale side for its next tap. Null when no row
 * carries a reading or the container would weigh as much as the reading.
 */
export function tareScaleRows<T extends Swappable>(items: readonly T[], tare: number): T[] | null {
  const rows = items.filter((it) => it.scaleRead && it.grams !== undefined);
  const first = rows[0]?.scaleRead;
  if (!first) return null;
  const net = netScaleGrams(first, tare);
  if (net === null) return null;
  const scaleSide = (it: T): PortionNumbers =>
    it.scaleRead!.active === "scale" ? numbersOf({ ...it, grams: it.grams! } as PortionNumbers) : it.scaleRead!.other;
  const sides = new Map(rows.map((it) => [it, scaleSide(it)]));
  const sum = [...sides.values()].reduce((s, n) => s + n.grams, 0);
  if (sum <= 0) return null;
  return items.map((it) => {
    const side = sides.get(it);
    if (!side) return it;
    const share = rows.length === 1 ? net : Math.max(1, Math.round((side.grams / sum) * net));
    const next = scaledBy(side, share);
    const { tare: _old, ...base } = it.scaleRead!;
    const chip: ScaleReadChip = tare > 0 ? { ...base, tare: Math.round(tare) } : base;
    return chip.active === "scale"
      ? ({ ...it, ...next, scaleRead: chip } as T)
      : ({ ...it, scaleRead: { ...chip, other: next } } as T);
  });
}

/** The list as stored in a diary row's items_json: without the chip's second set of numbers. */
export function withoutScaleRead<T extends { scaleRead?: unknown }>(items: readonly T[]): Array<Omit<T, "scaleRead">> {
  return items.map(({ scaleRead: _chip, ...rest }) => rest);
}
