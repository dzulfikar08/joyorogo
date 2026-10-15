import { Beef, Droplet, Flame, Leaf, Weight, Wheat, type LucideIcon } from "lucide-react";

export type MacroKey = "protein" | "carbs" | "fat" | "fiber" | "kcal" | "grams";

/** The one icon + label + tone per macro. Never pick nutrient icons ad hoc. */
export const MACRO_META: Record<MacroKey, { label: string; Icon: LucideIcon; tone: string }> = {
  protein: { label: "Protein", Icon: Beef, tone: "text-makan" },
  carbs: { label: "Karbo", Icon: Wheat, tone: "text-bakar" },
  fat: { label: "Lemak", Icon: Droplet, tone: "text-tidur" },
  fiber: { label: "Serat", Icon: Leaf, tone: "text-muted-foreground" },
  kcal: { label: "Kalori", Icon: Flame, tone: "text-kcal" },
  grams: { label: "Berat", Icon: Weight, tone: "text-gram" },
};
