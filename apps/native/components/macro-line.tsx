import { View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { fmtKcal } from "@/utils/format";
import { MACRO_META, MacroIcon } from "@/utils/macro-icons";

/**
 * Macro chips with the shared macro icons (utils/macro-icons). Null and
 * zero grams drop out; nothing renders when all four are empty. `compact`
 * keeps tight rows readable by showing the icon plus value only, with the
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
  const macros = [
    { key: "protein", grams: protein ?? null },
    { key: "carbs", grams: carbs ?? null },
    { key: "fat", grams: fat ?? null },
    { key: "fiber", grams: fiber ?? null },
  ].map((m) => ({ ...m, key: m.key as "protein" | "carbs" | "fat" | "fiber", label: MACRO_META[m.key as "protein"].label })).filter((macro): macro is typeof macro & { grams: number } => (macro.grams ?? 0) > 0);
  if (macros.length === 0) return null;
  return (
    <View
      style={[styles.row, style]}
      accessibilityLabel={macros.map((m) => `${m.label} ${fmtKcal(m.grams)} g`).join(", ")}
    >
      {macros.map((macro) => (
        <View key={macro.key} style={styles.item}>
          <MacroIcon macro={macro.key} size={14} />
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
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
