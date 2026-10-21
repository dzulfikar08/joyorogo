import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { MacroLine } from "@/components/macro-line";
import { fmtIdr, fmtKcalLabel } from "@/utils/format";

/**
 * Diary plate header: a plain section line, "Piring: Nasi padang · Rp28.000",
 * with the plate's total kcal on the right and its macros underneath. Tapping
 * opens the plate edit sheet (PlateEditSheet).
 */
export function PlateHeader({
  name,
  priceIdr,
  kcal,
  protein,
  carbs,
  fat,
  fiber,
  onEdit,
  disabled,
}: {
  name: string;
  priceIdr: number | null;
  /** Component totals summed by the diary, shown in the header. */
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  onEdit: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("plate.header.editAria", { name })}
      disabled={disabled}
      onPress={onEdit}
      style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
    >
      <View style={styles.barRow}>
        <Text style={styles.label} numberOfLines={1}>
          {t("plate.header.title", { name })}
        </Text>
        {priceIdr !== null ? <Text style={styles.price}>{fmtIdr(priceIdr)}</Text> : null}
        <Ionicons name="pencil" size={12} color={theme.colors.mutedForeground} />
        {kcal > 0 ? <Text style={styles.kcal}>{fmtKcalLabel(kcal)}</Text> : null}
      </View>
      {kcal > 0 ? (
        <MacroLine compact protein={protein} carbs={carbs} fat={fat} fiber={fiber} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    gap: 2,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  price: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  kcal: {
    marginLeft: "auto",
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
}));
