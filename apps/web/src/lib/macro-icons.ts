import { i18n } from "@joyorogo/i18n";
import { Beef, Droplet, Flame, Leaf, Weight, Wheat, type LucideIcon } from "lucide-react";

export type MacroKey = "protein" | "carbs" | "fat" | "fiber" | "kcal" | "grams";

/** The one icon + label + tone per macro. Never pick nutrient icons ad hoc. */
export const MACRO_META: Record<MacroKey, { label: string; Icon: LucideIcon; tone: string }> = {
  protein: { get label() { return i18n.t("makan:diary.macro.protein"); }, Icon: Beef, tone: "text-makan" },
  carbs: { get label() { return i18n.t("makan:diary.macro.carbs"); }, Icon: Wheat, tone: "text-bakar" },
  fat: { get label() { return i18n.t("makan:diary.macro.fat"); }, Icon: Droplet, tone: "text-tidur" },
  fiber: { get label() { return i18n.t("makan:diary.macro.fiber"); }, Icon: Leaf, tone: "text-muted-foreground" },
  kcal: { get label() { return i18n.t("misc:macro.kcal"); }, Icon: Flame, tone: "text-kcal" },
  grams: { get label() { return i18n.t("misc:macro.grams"); }, Icon: Weight, tone: "text-gram" },
};
