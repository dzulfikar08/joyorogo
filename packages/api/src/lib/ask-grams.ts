/**
 * "Berapa gram? Timbang biar akurat": a scan row whose weight the photo cannot give and the model usually gets
 * wrong carries `askGrams`, and the result screens put a small prompt on it that takes the weighed grams.
 *
 * The rule comes from the weighed external set (docs/ai-accuracy-log.md, 2026-10-28, "Ask for the grams"): when
 * the answer is ONE item of 200 g or more, the model falls back to a generic bowl, plate or glass weight, and on
 * weighed photos that weight was more than 50% off in 8 of 10 runs (spaghetti 300-350 g against 120, bubur 300
 * against 120, watermelon 240-250 against 100, battered mushrooms 250 against 100). Drinks are left out (cups
 * carry their volume and the S / M / L choice), and so is any row whose weight already has another source.
 *
 * Client-safe (no library imports beyond the two pure helpers): the server decides with `withAskGrams`, both
 * apps apply the typed weight with `itemAtTypedGrams`.
 */
import { stampGramsEdit } from "./grams-edit";
import type { GramsEditStamped } from "./grams-edit";
import { MAX_GRAMS, rescaleForGrams } from "./portion";

/** A lone item at or above this weight is asked about (a bowl or plate default is 200-350 g; below it the guess is usually close). */
export const ASK_GRAMS_MIN = 200;

/** The fields the rule reads. */
type AskRow = {
  grams?: number;
  kind?: string;
  scaleRead?: unknown;
  portionPrior?: unknown;
  cup?: unknown;
};

/**
 * Whether the answer's only row should ask for its weight. False for answers of 2+ rows (a plate of several
 * dishes is shared out of one total, the case the model does not get this badly wrong), for drinks, for a row
 * read off a kitchen scale, for a row with a usual / typical portion chip (the weight already has a second
 * opinion on it) and for a cup whose contents are hidden.
 */
export function shouldAskGrams<T extends AskRow>(items: readonly T[]): boolean {
  if (items.length !== 1) return false;
  const [item] = items;
  return (
    item!.grams !== undefined &&
    item!.grams >= ASK_GRAMS_MIN &&
    item!.kind !== "minuman" &&
    item!.scaleRead === undefined &&
    item!.portionPrior === undefined &&
    item!.cup === undefined
  );
}

/** Kecil / Sedang / Besar: the matched dish's typical serving times these. */
export const SIZE_FACTORS = [0.5, 1, 1.5] as const;

/** Grams of the three size chips, small to large (`sizeOptions` on a row). */
export type SizeOptions = [small: number, medium: number, large: number];

/**
 * The three sizes of a typical serving: x0.5, x1 and x1.5 rounded to 5 g (never under 5 g). Undefined when there is
 * no usable typical serving, or when rounding would make two sizes the same weight (a 5 g serving).
 */
export function sizeOptionsOf(typicalGrams: number | undefined): SizeOptions | undefined {
  if (typicalGrams === undefined || !Number.isFinite(typicalGrams) || !(typicalGrams > 0)) return undefined;
  const [s, m, l] = SIZE_FACTORS.map((f) => Math.min(MAX_GRAMS, Math.max(5, Math.round((typicalGrams * f) / 5) * 5)));
  return s! < m! && m! < l! ? [s!, m!, l!] : undefined;
}

/** The prompt shows while the row's weight is the model's: any chip or typed weight (a stamp) ends it. */
export const asksGrams = (item: { askGrams?: boolean } & GramsEditStamped): boolean =>
  item.askGrams === true && (item.gramsEdits?.length ?? 0) === 0;

type WeighedRow = {
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  askGrams?: boolean;
  sizeOptions?: unknown;
  pieces?: unknown;
  edibleGrams?: number;
  grossGrams?: number;
  withBone?: boolean;
  portionPrior?: unknown;
  usualDensity?: unknown;
};

/**
 * The row at the weight the user typed or tapped (rounded, 1 to 5000 g): kcal and macros follow by grams / old
 * grams, the model's portion text, piece count, bone-in estimate and usual-density note no longer describe it and
 * go, the prompt and its size chips end, and the row is stamped `typed` (or `size` for a size chip). Same row when
 * the weight is not a usable number or the row has no weight to scale from.
 */
export function itemAtTypedGrams<T extends WeighedRow>(item: T, typed: number, source: "typed" | "size" = "typed"): T {
  if (!Number.isFinite(typed) || typed < 1 || item.grams === undefined || !(item.grams > 0)) return item;
  const grams = Math.min(MAX_GRAMS, Math.round(typed));
  const next = rescaleForGrams(
    {
      grams: item.grams,
      kcal: item.kcal,
      protein: item.protein ?? null,
      carbs: item.carbs ?? null,
      fat: item.fat ?? null,
      fiber: item.fiber ?? null,
    },
    grams,
  );
  const {
    portion: _portion,
    pieces: _pieces,
    edibleGrams: _edible,
    grossGrams: _gross,
    withBone: _bone,
    portionPrior: _prior,
    usualDensity: _usual,
    askGrams: _ask,
    sizeOptions: _sizes,
    ...rest
  } = item;
  return stampGramsEdit(
    {
      ...rest,
      grams,
      kcal: next.kcal,
      ...(next.protein !== null ? { protein: next.protein } : {}),
      ...(next.carbs !== null ? { carbs: next.carbs } : {}),
      ...(next.fat !== null ? { fat: next.fat } : {}),
      ...(next.fiber !== null ? { fiber: next.fiber } : {}),
    } as unknown as T,
    source,
  );
}
