import { View, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { fmtKcal } from "@/utils/format";

/**
 * Macro chips with the app's data colors as dots: protein makan (green),
 * karbo bakar (terracotta), lemak tidur (purple), serat neutral. Null and
 * zero grams drop out; nothing renders when all four are empty. `compact`
 * keeps tight rows readable by showing the dot plus value only, with the
 * full label as the row's accessibility label.
 */
export function MacroLine({
  protein,
  carbs,
  fat,
  fiber,
  compact = false,
  style,
}: {
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  compact?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useUnistyles();
  const macros = [
    { label: "Protein", grams: protein ?? null, color: theme.colors.makan },
    { label: "Karbo", grams: carbs ?? null, color: theme.colors.bakar },
    { label: "Lemak", grams: fat ?? null, color: theme.colors.tidur },
    { label: "Serat", grams: fiber ?? null, color: theme.colors.mutedForeground },
  ].filter((macro): macro is typeof macro & { grams: number } => (macro.grams ?? 0) > 0);
  if (macros.length === 0) return null;
  return (
    <View
      style={[styles.row, style]}
      accessibilityLabel={macros.map((m) => `${m.label} ${fmtKcal(m.grams)} g`).join(", ")}
    >
      {macros.map((macro) => (
        <View key={macro.label} style={styles.item}>
          <View style={[styles.dot, { backgroundColor: macro.color }]} />
          <Text style={styles.label}>
            {compact ? `${fmtKcal(macro.grams)} g` : `${macro.label} ${fmtKcal(macro.grams)} g`}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.sm,
    rowGap: 2,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
