/**
 * Kitchen-scale readout on a scan row: the weight came off a scale display in
 * the photo (lib/scale-reading.ts), the model's own photo estimate is one tap
 * away. Client-safe (no library imports): both apps swap the two sides with this.
 */
import { stampGramsEdit } from "./grams-edit";
import { numbersOf } from "./portion-chip";
import type { PortionNumbers } from "./portion-chip";

export type ScaleUnit = "g" | "kg" | "oz" | "lb" | "ml" | "fl oz";

/** What the model saw standing on the scale beside the food (lib/scale-reading.ts takes its weight off the reading). */
export const CONTAINER_KINDS = ["bowl", "plate", "box", "cup", "bag", "wrapper"] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

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
  /**
   * The container the scan itself saw on the scale and took off (lib/scale-reading.ts): `tare` is then an estimate for
   * that kind of container, not a weighed one. Gone once the person sets a weight themselves (tareScaleRows).
   */
  tareKind?: ContainerKind;
};

type Swappable = Omit<PortionNumbers, "grams"> & { grams?: number; scaleRead?: ScaleReadChip };

/** The row after one tap on the chip: the other side's numbers set, the current ones kept for the next tap. */
export function swapScaleRead<T extends Swappable>(item: T): T {
  const chip = item.scaleRead;
  if (!chip || item.grams === undefined) return item;
  const { portion: _drop, ...rest } = item;
  return stampGramsEdit(
    {
      ...rest,
      ...chip.other,
      scaleRead: {
        ...chip,
        active: chip.active === "scale" ? "ai" : "scale",
        other: numbersOf({ ...item, grams: item.grams }),
      },
    } as T,
    "scale",
  );
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
    const { tare: _old, tareKind: _kind, ...base } = it.scaleRead!;
    const chip: ScaleReadChip = tare > 0 ? { ...base, tare: Math.round(tare) } : base;
    return chip.active === "scale"
      ? stampGramsEdit({ ...it, ...next, scaleRead: chip } as T, "tare")
      : ({ ...it, scaleRead: { ...chip, other: next } } as T);
  });
}

/** `total` in whole grams split in the proportions of `weights`; the parts always add up to it. */
export function splitGrams(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.max(1, Math.round((total * w) / sum)));
  const drift = total - parts.reduce((a, b) => a + b, 0);
  const biggest = parts.indexOf(Math.max(...parts));
  parts[biggest] = Math.max(1, parts[biggest]! + drift);
  return parts;
}

/**
 * A row left out of the meal (the checkmark on a scan row): the reading weighed everything that was on the scale, so
 * the rows that stay share all of it (minus the container), in the proportions of the photo estimates the reading was
 * first spread by. Worked out from scratch on every toggle, so leaving a row out and putting it back restores the
 * first split. Null when there is nothing to do: no covered row, a covered row showing the photo estimate (the person
 * chose that side), or every covered row left out. A row whose object differs from `items[i]` was re-split.
 */
export function resplitScaleRows<T extends Swappable>(items: readonly T[], included: readonly boolean[]): T[] | null {
  const rows = items.flatMap((it, i) => (it.scaleRead && it.grams !== undefined ? [i] : []));
  const first = items[rows[0] ?? -1]?.scaleRead;
  if (!first || rows.some((i) => items[i]!.scaleRead!.active !== "scale")) return null;
  const net = netScaleGrams(first, first.tare ?? 0);
  const pool = rows.filter((i) => included[i] !== false);
  const weights = pool.map((i) => Math.max(0, items[i]!.scaleRead!.other.grams));
  if (net === null || pool.length === 0 || weights.reduce((a, b) => a + b, 0) <= 0) return null;
  const shares = pool.length === 1 ? [net] : splitGrams(net, weights);
  const next = [...items];
  pool.forEach((index, n) => {
    const row = items[index]!;
    if (row.grams === shares[n] && row.scaleRead!.count === pool.length) return;
    const { portion: _stale, ...rest } = row;
    next[index] = stampGramsEdit(
      {
        ...rest,
        ...scaledBy(numbersOf({ ...rest, grams: row.grams! }), shares[n]!),
        scaleRead: { ...row.scaleRead!, count: pool.length },
      } as T,
      "scale",
    );
  });
  return next;
}

type CorrectionRow = Omit<PortionNumbers, "grams"> & { grams?: number; kind?: string };

/**
 * The list after a typed or spoken correction (ai.correctScan) that removed rows the scale reading covered: the reading
 * is the weight of everything that was on the scale, so the removed rows hand their share back to the rows that stay,
 * in the proportions those rows had. What the person fixed themselves keeps its weight and comes off the pool first
 * (a "portion" change, and an added row with grams; an added drink was never on the scale). A renamed row stays in the
 * pool: its new name, not its place on the plate, changed. Every row that shares the reading gets its chip back (the
 * server's answer carries none) with the container still taken off.
 *
 * Returns the correction's own items untouched when no covered row was removed, when a covered row shows the photo
 * estimate (the person chose that side), or when the pool would be left empty or under a tenth of the reading. A row
 * whose object differs from `patch.items[i]` is one that was re-split (its kcal draft needs the new number).
 */
export function resplitScaleAfterCorrection<B extends CorrectionRow & { scaleRead?: ScaleReadChip }, P extends CorrectionRow>(
  base: readonly B[],
  patch: {
    items: readonly P[];
    origins: ReadonlyArray<number | null>;
    changes: ReadonlyArray<{ index: number; kind: string }>;
  },
): Array<P & { scaleRead?: ScaleReadChip }> {
  const unchanged = (): Array<P & { scaleRead?: ScaleReadChip }> => [...patch.items];
  const covered = new Set(base.flatMap((it, i) => (it.scaleRead && it.grams !== undefined ? [i] : [])));
  const first = base.find((_it, i) => covered.has(i))?.scaleRead;
  if (!first) return unchanged();
  const kept = new Set(patch.origins.filter((o): o is number => o !== null));
  if ([...covered].every((i) => kept.has(i))) return unchanged();
  if ([...covered].some((i) => kept.has(i) && base[i]!.scaleRead!.active !== "scale")) return unchanged();
  const net = netScaleGrams(first, first.tare ?? 0);
  if (net === null) return unchanged();

  const how = new Map(patch.changes.map((change) => [change.index, change.kind]));
  const pool: number[] = [];
  let fixed = 0;
  patch.items.forEach((row, index) => {
    const origin = patch.origins[index] ?? null;
    const kind = how.get(index);
    if (origin !== null && covered.has(origin)) {
      if (kind === undefined || kind === "renamed") pool.push(index);
      else fixed += row.grams ?? 0;
    } else if (origin === null && kind === "added" && row.kind !== "minuman") {
      fixed += row.grams ?? 0;
    }
  });
  const poolNet = Math.round(net - fixed);
  const weights = pool.map((i) => patch.items[i]!.grams ?? 0);
  if (pool.length === 0 || poolNet < Math.max(pool.length, net * 0.1) || weights.reduce((a, b) => a + b, 0) <= 0) {
    return unchanged();
  }
  const shares = pool.length === 1 ? [poolNet] : splitGrams(poolNet, weights);
  const out = unchanged();
  pool.forEach((index, n) => {
    const row = patch.items[index]!;
    const origin = patch.origins[index]!;
    const { portion: _stale, ...rest } = row;
    const own = numbersOf({ ...rest, grams: row.grams ?? 0 });
    const other = how.get(index) === "renamed" ? numbersOf({ ...row, grams: row.grams ?? 0 }) : base[origin]!.scaleRead!.other;
    out[index] = { ...rest, ...scaledBy(own, shares[n]!), scaleRead: { ...first, active: "scale", count: pool.length, other } } as P & {
      scaleRead?: ScaleReadChip;
    };
  });
  return out;
}

/** The list as stored in a diary row's items_json: without the chip's second set of numbers. */
export function withoutScaleRead<T extends { scaleRead?: unknown }>(items: readonly T[]): Array<Omit<T, "scaleRead">> {
  return items.map(({ scaleRead: _chip, ...rest }) => rest);
}
