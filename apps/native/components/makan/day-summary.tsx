import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { eatTone } from "@joyorogo/api/lib/engine";
import { gainEatTone, gainRemaining } from "@joyorogo/api/lib/gain";

import type { ProteinPerKg } from "@joyorogo/api/lib/safety";

import { gainRemainingLabel } from "@/components/gain/gain-today";
import { Card, CountNum, MacroBar, Text } from "@/components/ui";
import { fmtDecimal, fmtInt } from "@/utils/format";

type MacroTotals = { protein: number; carbs: number; fat: number; fiber: number };
type MacroBudgets = {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
};

/**
 * The day at a glance, compact: eaten kcal against the target, a thin progress
 * bar in the tone of the day, and the four macros against their budgets. The
 * ring stays on Beranda. Hamil/Menyusui never read "over"; Naikin BB reads
 * "still to eat" instead.
 */
export function DaySummary({
  eatenKcal,
  targetKcal: targetInput,
  maternal,
  gainPlan,
  totals,
  proteinGuide,
  budgets,
}: {
  eatenKcal: number;
  /** null without a profile target: only the number and the macros show. */
  targetKcal: number | null;
  maternal: boolean;
  gainPlan: boolean;
  totals: MacroTotals;
  /** Eaten protein per kg of the latest weigh-in against the guide range; null when it cannot be said honestly. */
  proteinGuide: ProteinPerKg | null;
  budgets: MacroBudgets;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const targetKcal = targetInput !== null && targetInput > 0 ? targetInput : null;
  const hasTarget = targetKcal !== null;
  const tone = maternal
    ? "ok"
    : gainPlan
      ? gainEatTone(eatenKcal, targetKcal ?? 0)
      : eatTone(eatenKcal, targetKcal ?? 0);
  const barColor = {
    ok: theme.colors.makan,
    near: theme.colors.eatNear,
    over: theme.colors.bakar,
  }[tone];
  const over = hasTarget && !maternal && !gainPlan && eatenKcal > targetKcal;
  const fill = hasTarget ? Math.min(1, Math.max(0, eatenKcal / targetKcal)) : 0;

  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={styles.eaten}>
          <CountNum value={eatenKcal} style={styles.kcal} numberOfLines={1} />
          <Text style={styles.unit}>{t("diary.summary.unit")}</Text>
        </View>
        {hasTarget ? (
          <Text style={[styles.target, over && { color: theme.colors.bakarText }]}>
            {over
              ? t("diary.summary.over", { kcal: fmtInt(eatenKcal - targetKcal) })
              : t("diary.summary.ofTarget", { kcal: fmtInt(targetKcal) })}
          </Text>
        ) : null}
      </View>
      {hasTarget ? (
        <View style={styles.track}>
          <View
            style={[styles.fill, { width: `${fill * 100}%`, backgroundColor: barColor }]}
          />
        </View>
      ) : null}
      {gainPlan && hasTarget ? (
        <Text style={styles.gainLine}>
          {gainRemainingLabel(gainRemaining(targetKcal, eatenKcal))}
        </Text>
      ) : null}
      <View style={styles.macros}>
        <MacroBar
          macro="protein"
          label={t("diary.macro.protein")}
          eaten={totals.protein}
          budget={budgets.proteinG}
          neutral={gainPlan}
        />
        {proteinGuide ? (
          <Text style={styles.proteinGuide}>
            {t("daySummary.proteinPerKg", {
              perKg: fmtDecimal(proteinGuide.gPerKg, 1),
              min: fmtDecimal(proteinGuide.guide.min, 1),
              max: fmtDecimal(proteinGuide.guide.max, 1),
            })}
          </Text>
        ) : null}
        <MacroBar
          macro="carbs"
          label={t("diary.macro.carbs")}
          eaten={totals.carbs}
          budget={budgets.carbsG}
          neutral={gainPlan}
        />
        <MacroBar
          macro="fat"
          label={t("diary.macro.fat")}
          eaten={totals.fat}
          budget={budgets.fatG}
          neutral={gainPlan}
        />
        <MacroBar
          macro="fiber"
          label={t("diary.macro.fiber")}
          eaten={totals.fiber}
          budget={budgets.fiberG}
          neutral={gainPlan}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  top: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  eaten: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.xs,
  },
  kcal: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  unit: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  target: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: theme.colors.makanSoft,
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  gainLine: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  macros: {
    gap: theme.spacing.sm,
  },
  proteinGuide: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
}));
