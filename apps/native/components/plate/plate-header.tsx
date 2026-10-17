import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { MacroLine } from "@/components/macro-line";
import { fmtIdr, fmtKcalLabel } from "@/utils/format";

/**
 * Diary plate header: "Piring: Nasi padang · Rp28.000" plus the plate's total
 * kcal (and protein when the rows carry it). Tapping opens the plate edit
 * sheet (PlateEditSheet).
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
  /** Component totals summed by the diary, shown in the bar. */
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
        <Ionicons name="restaurant" size={14} color={theme.colors.makanText} />
        <Text style={styles.label} numberOfLines={1}>
          {t("plate.header.title", { name })}
        </Text>
        {priceIdr !== null ? <Text style={styles.price}>{fmtIdr(priceIdr)}</Text> : null}
        <Ionicons name="pencil" size={12} color={theme.colors.mutedForeground} />
      </View>
      {kcal > 0 ? (
        <View style={styles.totals}>
          <Text style={styles.kcal}>{fmtKcalLabel(kcal)}</Text>
          <MacroLine protein={protein} carbs={carbs} fat={fat} fiber={fiber} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 2,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.tile,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    marginHorizontal: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
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
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  price: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  kcal: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  totals: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.sm,
  },
}));
