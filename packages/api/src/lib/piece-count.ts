// Counted pieces: the model names how many separate pieces it sees (7 egg halves, 5 satay sticks)
// and the grams must be that count times one piece's weight. Left to itself it weighs a plate of
// 7 egg halves as one egg (tester photo 2026-10-22: "telur rebus 60 g, 78 kcal" for 3.5 eggs).

/** A countable item: name pattern, the weight of one piece in grams and what a piece is called. */
type PieceRow = { name: RegExp; unit: RegExp; grams: number; halves?: boolean };

/** Eggs eaten as eggs; a dish built on egg (martabak, dadar, balado, nasi goreng telur) is not one egg per piece. */
const PLAIN_EGG = /^(?!.*\b(martabak|nasi|mie|mi|kwetiau|bihun|soto|sup|sayur|gulai|opor|kari|dadar|balado|sambal|bakso|sate|roti|kue|kentang|salad)\b).*\btelur\b/;

/** Whole-piece weights as eaten (edible part). Order matters: the first row that matches wins. */
export const PIECE_WEIGHTS: readonly PieceRow[] = [
  { name: /\btelur puyuh\b/, unit: /^(butir|buah|biji|pcs?)$/, grams: 10, halves: true },
  { name: PLAIN_EGG, unit: /^(butir|buah|biji|pcs?)$/, grams: 50, halves: true },
  { name: /\bsate\b/, unit: /^(tusuk|batang|buah|pcs?)$/, grams: 30 },
  { name: /\bnugget\b/, unit: /^(potong|buah|biji|pcs?)$/, grams: 20 },
  { name: /\b(siomay|dimsum|dim sum|dumpling|gyoza)\b/, unit: /^(buah|biji|potong|pcs?)$/, grams: 25 },
  { name: /\bpangsit\b/, unit: /^(buah|biji|potong|pcs?)$/, grams: 15 },
  { name: /\bbakso\b/, unit: /^(buah|biji|butir|pcs?)$/, grams: 25 },
  { name: /\broti tawar\b/, unit: /^(lembar|iris|slices?|potong|buah|pcs?)$/, grams: 30 },
  { name: /\bpisang goreng\b/, unit: /^(buah|biji|potong|pcs?)$/, grams: 60 },
];

const HALF_UNIT = /^(belah(an)?|setengah|half|halves)$/;
/** Half a piece weighs half; two halves are one egg. */
const HALF_FACTOR = 0.5;

/** Units a portion text may carry when the model sent no `count` field. */
const PORTION_COUNT =
  /(\d+(?:[.,]\d+)?)\s*(butir|buah|biji|pcs?|tusuk|batang|potong|lembar|iris|slices?|belah(?:an)?|halves|half)\b/i;

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
 * Makes grams agree with the count. Grams within COUNT_TOLERANCE of count x unit weight stay; any
 * other weight is replaced by it and kcal and macros follow in proportion. Items that are not in the
 * table, or whose unit does not fit, are left alone. The count fields are dropped from the result;
 * the count stays visible in the portion text.
 */
export function reconcileCount<T extends CountedItem>({ count: _count, unit: _unit, ...item }: T): Omit<T, "count" | "unit"> {
  const found = readCount({ count: _count, unit: _unit, portion: item.portion });
  const expected = found ? expectedGrams(item.name, found) : undefined;
  if (!found || expected === undefined) return item as Omit<T, "count" | "unit">;
  const portion = item.portion && PORTION_COUNT.test(item.portion) ? item.portion : writeCount(found);
  const grams = item.grams;
  if (grams !== undefined && Math.abs(grams - expected) <= expected * COUNT_TOLERANCE) {
    return { ...item, portion } as Omit<T, "count" | "unit">;
  }
  const factor = grams !== undefined && grams > 0 ? expected / grams : undefined;
  const next = { ...item, portion, grams: Math.round(expected) };
  if (factor === undefined) return next as Omit<T, "count" | "unit">;
  return {
    ...next,
    ...(item.kcal !== undefined ? { kcal: scaled(item.kcal, factor) } : {}),
    ...(item.protein !== undefined ? { protein: scaled(item.protein, factor) } : {}),
    ...(item.carbs !== undefined ? { carbs: scaled(item.carbs, factor) } : {}),
    ...(item.fat !== undefined ? { fat: scaled(item.fat, factor) } : {}),
    ...(item.fiber !== undefined ? { fiber: scaled(item.fiber, factor) } : {}),
  } as Omit<T, "count" | "unit">;
}
