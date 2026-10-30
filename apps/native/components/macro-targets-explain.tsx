import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";
import { MacroIcon, type MacroKey } from "@/utils/macro-icons";

export type MacroTargetValues = {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
};

/**
 * How each macro target is set, with today's numbers. Shown in Beranda's "Cara baca angka ini" sheet and behind the (i)
 * on Makan's day summary, so both read the same text. The rules mirror `macroGoals` in packages/api/src/lib/plan.ts.
 */
export function MacroTargetsExplain({
  targets,
  gain,
}: {
  targets: MacroTargetValues;
  gain: boolean;
}) {
  const { t } = useTranslation("home");
  const rows: Array<{
    macro: MacroKey;
    g: number | null;
    text:
      | "explain.macros.protein"
      | "explain.macros.proteinGain"
      | "explain.macros.fat"
      | "explain.macros.carbs"
      | "explain.macros.fiber";
  }> = [
    {
      macro: "protein",
      g: targets.proteinG,
      text: gain ? "explain.macros.proteinGain" : "explain.macros.protein",
    },
    { macro: "fat", g: targets.fatG, text: "explain.macros.fat" },
    { macro: "carbs", g: targets.carbsG, text: "explain.macros.carbs" },
    { macro: "fiber", g: targets.fiberG, text: "explain.macros.fiber" },
  ];
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t("explain.macros.title")}</Text>
      <Text style={styles.note}>{t("explain.macros.intro")}</Text>
      {rows.map((row) =>
        row.g === null ? null : (
          <View key={row.macro} style={styles.row}>
            <MacroIcon macro={row.macro} size={14} />
            <Text style={styles.note}>{t(row.text, { g: fmtInt(row.g) })}</Text>
          </View>
        ),
      )}
      <Text style={styles.note}>
        {gain ? t("explain.macros.overGain") : t("explain.macros.over")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.xs,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.md,
  },
  note: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
}));
