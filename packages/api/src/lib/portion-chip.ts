/**
 * "Porsi kebiasaanmu": the scan answer for an item can carry a second portion with
 * the model's own number one tap away. The second portion is the user's usual one
 * (their weighed history; the item then starts at it when the history is solid) or,
 * for plain rice, the typical eaten portion (a suggestion: the model's number stays).
 * Client-safe (no library imports): both apps swap the two numbers with this.
 */

/** The numbers that change when a portion changes. */
export type PortionNumbers = {
  portion?: string;
  grams: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
};

export type PortionPriorChip = {
  /** Which number the item currently shows: the usual / typical portion ("prior") or the model's ("ai"). */
  active: "prior" | "ai";
  /** The numbers the other side of the chip would put on the item. */
  other: PortionNumbers;
  /** User-set entries behind the usual portion; 0 for the typical portion. */
  n: number;
  /**
   * Whose portion "prior" is: the user's own history ("you"), or what people typically eat ("typical",
   * plain rice only, n = 0). Missing = "you" (answers from before the typical portion existed).
   */
  source?: "you" | "typical";
};

/** i18n key (scan namespace) for the label of the usual / typical side of the chip. */
export const priorLabelKey = (chip: Pick<PortionPriorChip, "source">): "result.items.priorUsual" | "result.items.priorTypical" =>
  chip.source === "typical" ? "result.items.priorTypical" : "result.items.priorUsual";

type Swappable = PortionNumbers & { portionPrior?: PortionPriorChip };

export const numbersOf = (item: PortionNumbers): PortionNumbers => ({
  ...(item.portion !== undefined ? { portion: item.portion } : {}),
  grams: item.grams,
  kcal: item.kcal,
  ...(item.protein !== undefined ? { protein: item.protein } : {}),
  ...(item.carbs !== undefined ? { carbs: item.carbs } : {}),
  ...(item.fat !== undefined ? { fat: item.fat } : {}),
  ...(item.fiber !== undefined ? { fiber: item.fiber } : {}),
});

/** The item after one tap on the chip: the other number set, the current one kept for the next tap. */
export function swapPortionPrior<T extends Omit<Swappable, "grams"> & { grams?: number }>(item: T): T {
  const chip = item.portionPrior;
  if (!chip || item.grams === undefined) return item;
  // A swapped weight no longer matches the "usual density" note's model kcal: the note goes with the swap.
  const { portion: _drop, usualDensity: _note, ...rest } = item as T & { usualDensity?: unknown };
  return {
    ...rest,
    ...chip.other,
    portionPrior: {
      ...chip,
      active: chip.active === "prior" ? "ai" : "prior",
      other: numbersOf({ ...item, grams: item.grams }),
    },
  } as T;
}

/** The usual and the model's weight of a chipped item, whichever is showing. */
export function chipGrams(item: { grams?: number; portionPrior?: PortionPriorChip }): {
  ai: number;
  usual: number;
} | null {
  const chip = item.portionPrior;
  if (!chip || item.grams === undefined) return null;
  return chip.active === "prior"
    ? { usual: item.grams, ai: chip.other.grams }
    : { ai: item.grams, usual: chip.other.grams };
}

/** What the model itself answered for the item (grams, kcal), whichever side of the chip is showing. */
export function modelNumbers(item: {
  grams?: number;
  kcal: number;
  portionPrior?: PortionPriorChip;
}): { grams?: number; kcal: number } {
  const chip = item.portionPrior;
  return chip && chip.active === "prior"
    ? { grams: chip.other.grams, kcal: chip.other.kcal }
    : { grams: item.grams, kcal: item.kcal };
}

/** The list as stored in a diary row's items_json: without the chip's second set of numbers and the "seperti biasanya" note. */
export function withoutPortionPrior<T extends { portionPrior?: unknown; usualDensity?: unknown }>(
  items: readonly T[],
): Array<Omit<T, "portionPrior" | "usualDensity">> {
  return items.map(({ portionPrior: _chip, usualDensity: _note, ...rest }) => rest);
}
