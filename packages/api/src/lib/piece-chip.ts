/**
 * "Jumlah": a scan row of separate pieces (eggs, satay sticks, dumplings) carries its count, and one tap on the
 * row's stepper puts another count on it. Weight, kcal and macros follow the count. Client-safe (no library
 * imports): both apps and the server's hint reader use this.
 */
import { stampGramsEdit } from "./grams-edit";
import { scalePortion } from "./portion";

/** Separate pieces of one row: how many, what one is called, and what one weighs as eaten. */
export type Pieces = {
  count: number;
  /** Singular label of one piece as the user reads it ("butir", "tusuk", "belahan"). */
  unit: string;
  /** Grams of one such piece. */
  unitGrams: number;
};

/** The most pieces one row can hold: a plate of 99 eggs is a typo, not a meal. */
export const MAX_PIECES = 99;

type CountedRow = {
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  edibleGrams?: number;
  grossGrams?: number;
  pieces?: Pieces;
  portionPrior?: unknown;
  scaleRead?: unknown;
};

/** A count the row can take: a whole number from 1 to MAX_PIECES. */
export const clampCount = (count: number) => Math.min(MAX_PIECES, Math.max(1, Math.round(count)));

/**
 * The row at another count: grams = count x one piece, and kcal and macros scale by new count / old count from
 * the row's current numbers (a kcal the user typed is theirs, so it scales too). The usual-portion and scale
 * chips are dropped: the count the user just set is the portion. Same row when it has no pieces or the count
 * does not change.
 */
export function itemAtCount<T extends CountedRow>(item: T, next: number): T {
  const { pieces } = item;
  if (!pieces) return item;
  const count = clampCount(next);
  if (count === pieces.count) return item;
  const scaled = scalePortion(
    {
      grams: item.grams ?? null,
      kcal: item.kcal,
      protein: item.protein ?? null,
      carbs: item.carbs ?? null,
      fat: item.fat ?? null,
      fiber: item.fiber ?? null,
    },
    count / pieces.count,
  );
  const { portionPrior: _prior, scaleRead: _scale, ...rest } = item;
  const counted = {
    ...rest,
    portion: `${count} ${pieces.unit}`,
    grams:
      item.grossGrams !== undefined && item.grams !== undefined
        ? Math.round((item.grams * count) / pieces.count)
        : Math.round(count * pieces.unitGrams),
    kcal: scaled.kcal,
    // Bone-in pieces ("2 potong"): the bone and the edible part follow the count too.
    ...(item.edibleGrams !== undefined
      ? { edibleGrams: Math.round((item.edibleGrams * count) / pieces.count) }
      : {}),
    ...(item.grossGrams !== undefined
      ? { grossGrams: Math.round((item.grossGrams * count) / pieces.count) }
      : {}),
    ...(scaled.protein !== null ? { protein: scaled.protein } : {}),
    ...(scaled.carbs !== null ? { carbs: scaled.carbs } : {}),
    ...(scaled.fat !== null ? { fat: scaled.fat } : {}),
    ...(scaled.fiber !== null ? { fiber: scaled.fiber } : {}),
    pieces: { ...pieces, count },
  } as T;
  return stampGramsEdit(counted, "count");
}

/** The unit labels the app has words for (scan namespace `result.items.unit.<key>`). */
export type PieceUnitKey = "butir" | "buah" | "tusuk" | "potong" | "lembar" | "keping" | "belahan";

/** The unit label a model or the table gave, as one of the app's: unknown units read as "buah". */
export function pieceUnitKey(unit: string): PieceUnitKey {
  const u = unit.trim().toLowerCase();
  if (u === "butir") return "butir";
  if (u === "tusuk" || u === "batang") return "tusuk";
  if (u === "potong") return "potong";
  if (u === "lembar" || u === "iris" || u === "slice" || u === "slices") return "lembar";
  if (u === "keping") return "keping";
  if (/^(belah(an)?|half|halves|setengah)$/.test(u)) return "belahan";
  return "buah";
}
