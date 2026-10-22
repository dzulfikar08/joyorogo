// Counted pieces: the model names how many separate pieces it sees (7 egg halves, 5 satay sticks)
// and the grams must be that count times one piece's weight. Left to itself it weighs a plate of
// 7 egg halves as one egg (tester photo 2026-10-22: "telur rebus 60 g, 78 kcal" for 3.5 eggs).

import { clampCount, itemAtCount } from "./piece-chip";
import type { Pieces } from "./piece-chip";

/** A countable item: name pattern, the weight of one piece in grams, what a piece is called and how to label it. */
type PieceRow = { name: RegExp; unit: RegExp; label: string; grams: number; halves?: boolean };

/**
 * Eggs eaten as eggs; a dish built on egg (martabak, dadar, balado, nasi goreng telur) is not one egg per piece,
 * and a white or a yolk, a duck or salted egg does not weigh a chicken egg.
 */
const PLAIN_EGG = /^(?!.*\b(martabak|nasi|mie|mi|kwetiau|bihun|soto|sup|sayur|gulai|opor|kari|dadar|balado|sambal|bakso|sate|roti|kue|kentang|salad|putih|kuning|bebek|asin)\b).*\btelur\b/;

/** Whole-piece weights as eaten (edible part). Order matters: the first row that matches wins. */
export const PIECE_WEIGHTS: readonly PieceRow[] = [
  { name: /\btelur puyuh\b/, unit: /^(butir|buah|biji|pcs?)$/, label: "butir", grams: 10, halves: true },
  { name: PLAIN_EGG, unit: /^(butir|buah|biji|pcs?)$/, label: "butir", grams: 50, halves: true },
  { name: /\bsate\b/, unit: /^(tusuk|batang|buah|pcs?)$/, label: "tusuk", grams: 30 },
  { name: /\bnugget\b/, unit: /^(potong|buah|biji|pcs?)$/, label: "potong", grams: 20 },
  { name: /\b(siomay|dimsum|dim sum|dumpling|gyoza)\b/, unit: /^(buah|biji|potong|pcs?)$/, label: "buah", grams: 25 },
  { name: /\bpangsit\b/, unit: /^(buah|biji|potong|pcs?)$/, label: "buah", grams: 15 },
  { name: /\bbakso\b/, unit: /^(buah|biji|butir|pcs?)$/, label: "buah", grams: 25 },
  { name: /\broti tawar\b/, unit: /^(lembar|iris|slices?|potong|buah|pcs?)$/, label: "lembar", grams: 30 },
  { name: /\bpisang goreng\b/, unit: /^(buah|biji|potong|pcs?)$/, label: "buah", grams: 60 },
  // Typical household pieces of lib/joyo-ai/typical-portions.ts (curated estimates, edible part).
  { name: /\bbakwan\b/, unit: /^(buah|biji|potong|pcs?)$/, label: "buah", grams: 50 },
  { name: /\bpastel\b/, unit: /^(buah|biji|potong|pcs?)$/, label: "buah", grams: 60 },
  { name: /\bonde onde\b/, unit: /^(buah|biji|pcs?)$/, label: "buah", grams: 40 },
];

const HALF_UNIT = /^(belah(an)?|setengah|half|halves)$/;
/** Units the "Jumlah" stepper can count even for a name outside the weight table (telur balado "4 butir", ayam goreng "2 potong"). */
const COUNT_UNIT = /^(butir|buah|biji|pcs?|tusuk|batang|potong|lembar|iris|slices?|keping|belah(an)?)$/;
/** Half a piece weighs half; two halves are one egg. */
const HALF_FACTOR = 0.5;

/** Units a portion text may carry when the model sent no `count` field. */
const PORTION_COUNT =
  /(\d+(?:[.,]\d+)?)\s*(butir|buah|biji|pcs?|tusuk|batang|potong|lembar|iris|slices?|keping|belah(?:an)?|halves|half)\b/i;

export type PieceCount = { count: number; unit: string };

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The count the model gave, else a count written in the portion text ("7 belahan"); undefined when neither. */
export function readCount(item: { count?: number; unit?: string; portion?: string }): PieceCount | undefined {
  const unit = item.unit?.trim().toLowerCase();
  if (item.count !== undefined && Number.isFinite(item.count) && item.count > 0 && unit) {
    return { count: item.count, unit };
  }
  const match = item.portion ? PORTION_COUNT.exec(item.portion) : null;
  const count = match ? Number(match[1]!.replace(",", ".")) : NaN;
  return match && count > 0 ? { count, unit: match[2]!.toLowerCase() } : undefined;
}

/** Grams that `count` pieces of this item weigh, or undefined when the item or unit is not in the table. */
export function expectedGrams(name: string, found: PieceCount): number | undefined {
  const key = normalize(name);
  const row = PIECE_WEIGHTS.find((r) => r.name.test(key));
  if (!row) return undefined;
  if (row.unit.test(found.unit)) return found.count * row.grams;
  if (row.halves && HALF_UNIT.test(found.unit)) return found.count * row.grams * HALF_FACTOR;
  return undefined;
}

/** The model's grams may be this far from count x unit weight before the count wins. */
export const COUNT_TOLERANCE = 0.2;

type CountedItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  count?: number;
  unit?: string;
};

const scaled = (value: number | undefined, factor: number) =>
  value === undefined ? undefined : Math.round(value * factor);

const writeCount = ({ count, unit }: PieceCount) => `${Number.isInteger(count) ? count : String(count).replace(".", ",")} ${unit}`;

/**
 * The row of a countable name, as the user can fix it with one tap: the count the model gave, or (it gave none, or a unit
 * the row does not use) the count the grams amount to. Undefined for names outside the table. The count is an estimate
 * either way; it only has to be easy to correct.
 */
export function piecesFor(name: string, grams: number | undefined, found?: PieceCount): Pieces | undefined {
  const row = PIECE_WEIGHTS.find((r) => r.name.test(normalize(name)));
  if (!row) return piecesOfCount(grams, found);
  if (found && row.unit.test(found.unit)) return { count: clampCount(found.count), unit: found.unit, unitGrams: row.grams };
  if (found && row.halves && HALF_UNIT.test(found.unit)) {
    return { count: clampCount(found.count), unit: found.unit, unitGrams: row.grams * HALF_FACTOR };
  }
  if (grams === undefined || !(grams > 0)) return undefined;
  return { count: clampCount(grams / row.grams), unit: row.label, unitGrams: row.grams };
}

/**
 * A count the model gave for a name outside the table: the grams stay the model's, so one piece weighs grams / count.
 * Undefined without a count, a weight or a unit that names pieces.
 */
function piecesOfCount(grams: number | undefined, found: PieceCount | undefined): Pieces | undefined {
  if (!found || !COUNT_UNIT.test(found.unit) || grams === undefined || !(grams > 0)) return undefined;
  const count = clampCount(found.count);
  return { count, unit: found.unit, unitGrams: grams / count };
}

/**
 * Makes grams agree with the count. Grams within COUNT_TOLERANCE of count x unit weight stay; any
 * other weight is replaced by it and kcal and macros follow in proportion. Items that are not in the
 * table, or whose unit does not fit, keep their numbers. The model's count fields are dropped from the result:
 * the count lives in the portion text and, for items of the table, in `pieces` (the row's "Jumlah" stepper).
 */
export function reconcileCount<T extends CountedItem>({
  count: _count,
  unit: _unit,
  ...item
}: T): Omit<T, "count" | "unit"> & { pieces?: Pieces } {
  const found = readCount({ count: _count, unit: _unit, portion: item.portion });
  const expected = found ? expectedGrams(item.name, found) : undefined;
  if (!found || expected === undefined) {
    const pieces = piecesFor(item.name, item.grams, found);
    return (pieces ? { ...item, pieces } : item) as Omit<T, "count" | "unit"> & { pieces?: Pieces };
  }
  const portion = item.portion && PORTION_COUNT.test(item.portion) ? item.portion : writeCount(found);
  const grams = item.grams;
  const pieces = piecesFor(item.name, expected, found);
  if (grams !== undefined && Math.abs(grams - expected) <= expected * COUNT_TOLERANCE) {
    return { ...item, portion, ...(pieces ? { pieces } : {}) } as Omit<T, "count" | "unit"> & { pieces?: Pieces };
  }
  const factor = grams !== undefined && grams > 0 ? expected / grams : undefined;
  const next = { ...item, portion, grams: Math.round(expected), ...(pieces ? { pieces } : {}) };
  if (factor === undefined) return next as Omit<T, "count" | "unit"> & { pieces?: Pieces };
  return {
    ...next,
    ...(item.kcal !== undefined ? { kcal: scaled(item.kcal, factor) } : {}),
    ...(item.protein !== undefined ? { protein: scaled(item.protein, factor) } : {}),
    ...(item.carbs !== undefined ? { carbs: scaled(item.carbs, factor) } : {}),
    ...(item.fat !== undefined ? { fat: scaled(item.fat, factor) } : {}),
    ...(item.fiber !== undefined ? { fiber: scaled(item.fiber, factor) } : {}),
  } as Omit<T, "count" | "unit"> & { pieces?: Pieces };
}

/** Words a hint puts between a name and its number ("telur ada 3") or around it; they name nothing. */
const HINT_FILLER = new Set(["ada", "jadi", "cuma", "hanya", "sebanyak", "total", "ini", "itu", "yang", "dan", "sama", "ya", "ku", "aku"]);

const HINT_UNIT = /^(butir|buah|biji|pcs?|tusuk|batang|potong|lembar|iris|keping|belahan?)$/;

/** "telurnya" -> "telur": the possessive suffix a hint puts after a food. */
const stem = (word: string) => word.replace(/nya$/, "");

type HintedItem = { name: string; pieces?: Pieces };

/**
 * Counts the user wrote in their retry hint ("ini bakwan, telurnya 3", "3 butir telur", "telur 3"), put on the
 * one row of pieces they name. The model reads the hint too, but it does not reliably act on a number. A number
 * with no food after it ("3 butir") goes to the only counted row when there is exactly one; a food that names
 * no row, or two rows, changes nothing.
 */
export function applyHintCounts<T extends HintedItem & Parameters<typeof itemAtCount>[0]>(items: T[], hint: string | undefined): T[] {
  if (!hint) return items;
  const words = normalize(hint).split(" ");
  const counted = (word: string) => items.filter((item) => item.pieces && normalize(item.name).split(" ").some((w) => stem(w) === word));
  const wanted = new Map<T, number>();
  const want = (item: T, n: number) => wanted.set(item, n);
  const isNumber = (w: string | undefined) => w !== undefined && /^\d{1,2}$/.test(w) && Number(w) >= 1;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (!isNumber(word)) continue;
    const n = Number(word);
    // "3 butir telur" / "3 telur": the food after the number (and its unit)
    const unitAfter = HINT_UNIT.test(words[i + 1] ?? "");
    const foodAfter = stem(words[i + (unitAfter ? 2 : 1)] ?? "");
    const after = foodAfter.length >= 3 && !HINT_FILLER.has(foodAfter) ? counted(foodAfter) : [];
    if (after.length === 1) {
      want(after[0]!, n);
      continue;
    }
    // "telurnya 3" / "telur ada 3 butir": the food before the number (past filler words)
    let back = i - 1;
    while (back >= 0 && HINT_FILLER.has(words[back]!)) back--;
    const before = back >= 0 ? counted(stem(words[back]!)) : [];
    if (before.length === 1) {
      want(before[0]!, n);
      continue;
    }
    // "ada 3 butir": a bare count of pieces, when only one row has pieces
    const only = items.filter((item) => item.pieces);
    if (unitAfter && only.length === 1) want(only[0]!, n);
  }
  return items.map((item) => (wanted.has(item) ? itemAtCount(item, wanted.get(item)!) : item));
}
