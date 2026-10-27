/**
 * "Dengan tulang": a bone-in scan row (fried chicken, ribs, a whole fish) is weighed with the bone and eaten
 * without it. The row carries both weights (lib/bone-in.ts estimates the edible one) and a switch moves `grams`
 * between them. kcal and macros do not change: they are already those of the meat that is eaten. Client-safe
 * (no library imports).
 */
import { stampGramsEdit } from "./grams-edit";

type BoneRow = {
  portion?: string;
  grams?: number;
  edibleGrams?: number;
  grossGrams?: number;
  withBone?: boolean;
};

/** A row the switch applies to: both weights are known. */
export const hasBone = (item: BoneRow) =>
  item.grams !== undefined && item.edibleGrams !== undefined && item.grossGrams !== undefined;

/** The trailing "dengan tulang" / "with bone" the server puts in the portion text of a bone-in row. */
const BONE_LABEL = /,?\s*(dengan tulang|with bone)\s*$/i;

/** A portion text without its bone label: the row says on its own whether the weight includes the bone. */
export const stripBoneLabel = (portion: string | undefined) =>
  portion?.replace(BONE_LABEL, "").trim() || undefined;

/**
 * The row with `grams` on the chosen side. `label` is the localized "dengan tulang": the portion text names the
 * bone only while the weight includes it. Same row when it already is on that side or is not a bone-in row.
 */
export function setWithBone<T extends BoneRow>(item: T, withBone: boolean, label: string): T {
  if (!hasBone(item) || (item.withBone ?? true) === withBone) return item;
  const base = stripBoneLabel(item.portion);
  const portion = withBone && base ? `${base}, ${label}` : base;
  return stampGramsEdit(
    {
      ...item,
      grams: withBone ? item.grossGrams : item.edibleGrams,
      withBone,
      portion,
    } as T,
    "bone",
  );
}
