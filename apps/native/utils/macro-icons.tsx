import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useUnistyles } from "react-native-unistyles";

export type MacroKey = "protein" | "carbs" | "fat" | "fiber" | "kcal" | "grams";

type McIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];
type ThemeColors = ReturnType<typeof useUnistyles>["theme"]["colors"];

/**
 * The one icon + label + tone per macro. Ionicons has no meat or grain glyph,
 * so every macro uses MaterialCommunityIcons for a consistent set. Never pick
 * nutrient icons ad hoc.
 */
export const MACRO_META: Record<
  MacroKey,
  { label: string; icon: McIconName; color: keyof ThemeColors }
> = {
  protein: { label: "Protein", icon: "food-drumstick", color: "makanText" },
  carbs: { label: "Karbo", icon: "barley", color: "bakarText" },
  fat: { label: "Lemak", icon: "water", color: "tidurText" },
  fiber: { label: "Serat", icon: "leaf", color: "mutedForeground" },
  kcal: { label: "Kalori", icon: "fire", color: "kcalText" },
  grams: { label: "Berat", icon: "scale", color: "gramText" },
};

export function MacroIcon({ macro, size = 14 }: { macro: MacroKey; size?: number }) {
  const { theme } = useUnistyles();
  const meta = MACRO_META[macro];
  return <MaterialCommunityIcons name={meta.icon} size={size} color={theme.colors[meta.color]} />;
}
