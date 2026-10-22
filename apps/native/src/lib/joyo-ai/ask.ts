/**
 * The question a "Tanya Joyo AI" shortcut types into a new chat's composer. Built from the food names and grams on screen and the
 * wording in `joyoAiApp:ask.*`; the person reads it, may change it, and sends it themselves. Nothing here sends anything.
 */

/** A translate function reduced to what these builders need (react-i18next's `t` fits). */
export type AskT = (
  key: "ask.food" | "ask.foodNoGrams" | "ask.scan",
  options?: Record<string, string | number>,
) => string;

export interface AskFood {
  name: string;
  /** Grams eaten or on the plate; unknown (or not a weight, e.g. a cup) = null. */
  grams?: number | null;
}

/** Most foods a scan question names; the rest are "and N more" in the person's head, not in the text. */
export const ASK_LIMITS = { name: 60, items: 6, text: 400 } as const;

/** One line, no control characters, at most `max` characters (a food name can come from a label or a model). */
export function oneLine(text: string, max: number): string {
  const flat = text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}\u2026`;
}

const gramsOf = (grams: AskFood["grams"]): number | null =>
  typeof grams === "number" && Number.isFinite(grams) && grams > 0 ? Math.round(grams) : null;

/** "Nasi putih 150 g" or just the name when there is no weight. */
export function foodLabel(food: AskFood): string {
  const name = oneLine(food.name, ASK_LIMITS.name);
  const grams = gramsOf(food.grams);
  return grams === null ? name : `${name} ${grams} g`;
}

/** The question for one logged food (the portion sheet, a diary row). */
export function foodQuestion(t: AskT, food: AskFood): string {
  const name = oneLine(food.name, ASK_LIMITS.name);
  const grams = gramsOf(food.grams);
  const text = grams === null ? t("ask.foodNoGrams", { name }) : t("ask.food", { name, grams });
  return text.slice(0, ASK_LIMITS.text);
}

/** The question for the foods of a scan result, before eating it; null when there is nothing to ask about. */
export function scanQuestion(t: AskT, foods: readonly AskFood[]): string | null {
  const named = foods
    .filter((f) => oneLine(f.name, ASK_LIMITS.name) !== "")
    .slice(0, ASK_LIMITS.items);
  if (named.length === 0) return null;
  return t("ask.scan", { items: named.map(foodLabel).join(", ") }).slice(0, ASK_LIMITS.text);
}
