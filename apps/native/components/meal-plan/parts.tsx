import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { Nutrition } from "@joyorogo/api/lib/meal/types";

import { Num, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

type IconName = ComponentProps<typeof Ionicons>["name"];

export type PillTone = "muted" | "makan" | "bakar" | "tidur" | "warning";

const TONES = {
  muted: { bg: "muted", fg: "mutedForeground" },
  makan: { bg: "makanSoft", fg: "makanText" },
  bakar: { bg: "bakarSoft", fg: "bakarText" },
  tidur: { bg: "tidurSoft", fg: "tidurText" },
  warning: { bg: "destructiveSoft", fg: "destructiveText" },
} as const;

/** Small tinted label for a real state or fact (eaten, tag, cost). Always text, the tint only groups. */
export function Pill({ label, tone = "muted", icon }: { label: string; tone?: PillTone; icon?: IconName }) {
  const { theme } = useUnistyles();
  const colors = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: theme.colors[colors.bg] }]}>
      {icon ? <Ionicons name={icon} size={13} color={theme.colors[colors.fg]} /> : null}
      <Text style={[styles.pillLabel, { color: theme.colors[colors.fg] }]}>{label}</Text>
    </View>
  );
}

/** Protein / carbs / fat of one portion as letter chips (P 32 g), same tones as the diary macros. */
export function MacroChips({ nutrition }: { nutrition: Nutrition }) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const chips = [
    { key: "protein", letter: t("item.proteinShort"), name: t("day.protein"), grams: nutrition.proteinG, bg: "makanSoft", fg: "makanText" },
    { key: "carbs", letter: t("item.carbShort"), name: t("day.carbs"), grams: nutrition.carbsG, bg: "bakarSoft", fg: "bakarText" },
    { key: "fat", letter: t("item.fatShort"), name: t("day.fat"), grams: nutrition.fatG, bg: "tidurSoft", fg: "tidurText" },
  ] as const;
  return (
    <View style={styles.chips}>
      {chips.map((chip) => (
        <View
          key={chip.key}
          accessible
          accessibilityLabel={`${chip.name} ${t("day.unitG", { n: fmtInt(chip.grams) })}`}
          style={[styles.chip, { backgroundColor: theme.colors[chip.bg] }]}
        >
          <Text style={[styles.chipLetter, { color: theme.colors[chip.fg] }]} importantForAccessibility="no">
            {chip.letter}
          </Text>
          <Num style={[styles.chipValue, { color: theme.colors[chip.fg] }]} importantForAccessibility="no">
            {t("day.unitG", { n: fmtInt(chip.grams) })}
          </Num>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    flexShrink: 1,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipLetter: {
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
  },
  chipValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
}));
