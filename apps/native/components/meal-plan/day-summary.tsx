import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { DayView } from "@joyorogo/api/lib/meal/view";

import { MetaLine } from "@/components/meta-line";
import { Card, Num, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** kcal and protein: a fill up to the target. */
export function TargetBar({
  label,
  value,
  target,
  unit,
  over,
  big,
}: {
  label: string;
  value: number;
  target: number;
  unit: "kcal" | "g";
  over: boolean;
  big?: boolean;
}) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const fmt = (n: number) => t(unit === "kcal" ? "day.unitKcal" : "day.unitG", { n: fmtInt(n) });
  const pct = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;
  const of = t("day.of", { target: fmt(target) });
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${fmt(value)}, ${of}`}
      accessibilityValue={{ min: 0, max: Math.round(target), now: Math.round(Math.min(value, target)) }}
      style={styles.bar}
    >
      <View style={styles.barHead}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValues}>
          <Num style={[styles.barValue, big && styles.barValueBig]}>{fmt(value)}</Num>
          <Text style={styles.barOf}> {of}</Text>
        </Text>
      </View>
      <View style={[styles.track, big && styles.trackBig]}>
        <View
          style={[
            styles.fill,
            { width: `${pct}%`, backgroundColor: over ? theme.colors.bakar : theme.colors.makan },
          ]}
        />
      </View>
    </View>
  );
}

/** carbs and fat: a target range, drawn as a band, with the day's total as a marker. */
function RangeBar({ label, value, range }: { label: string; value: number; range: [number, number] }) {
  const { t } = useTranslation("mealPlan");
  const scale = Math.max(range[1] * 1.25, value * 1.05, 1);
  const at = (n: number) => `${Math.min(100, Math.max(0, (n / scale) * 100))}%` as const;
  const rangeText = t("day.range", { min: fmtInt(range[0]), max: fmtInt(range[1]) });
  const valueText = t("day.unitG", { n: fmtInt(value) });
  return (
    <View accessible accessibilityLabel={`${label}: ${valueText}, ${rangeText}`} style={styles.bar}>
      <View style={styles.barHead}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValues}>
          <Num style={styles.barValue}>{valueText}</Num>
          <Text style={styles.barOf}> {rangeText}</Text>
        </Text>
      </View>
      <View style={styles.rangeWrap}>
        <View style={styles.track} />
        <View style={[styles.band, { left: at(range[0]), width: `${((range[1] - range[0]) / scale) * 100}%` }]} />
        <View style={[styles.marker, { left: at(value) }]} />
      </View>
    </View>
  );
}

function Status({ icon, tone, text }: { icon: IconName; tone: "ok" | "warn"; text: string }) {
  const { theme } = useUnistyles();
  const color = tone === "ok" ? theme.colors.makanText : theme.colors.bakarText;
  return (
    <View style={styles.status}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.statusText, { color }]}>{text}</Text>
    </View>
  );
}

/** Whether the day's kcal went past the budget (not just missed the range). */
export function kcalIsOver(day: DayView): boolean {
  return !day.met.kcal && day.kcalDelta > 0;
}

/** Two lines saying how the day's kcal and protein land against the targets (icon plus text, never color alone). */
export function DayStatuses({ day }: { day: DayView }) {
  const { t } = useTranslation("mealPlan");
  const proteinOk = day.met.protein || day.proteinShort === 0;
  const kcalText = day.met.kcal
    ? t("day.kcalOk")
    : kcalIsOver(day)
      ? t("day.kcalOver", { kcal: fmtInt(day.kcalDelta) })
      : t("day.kcalUnder", { kcal: fmtInt(Math.abs(day.kcalDelta)) });
  return (
    <View style={styles.statuses}>
      <Status icon={day.met.kcal ? "checkmark-circle" : "alert-circle"} tone={day.met.kcal ? "ok" : "warn"} text={kcalText} />
      <Status
        icon={proteinOk ? "checkmark-circle" : "alert-circle"}
        tone={proteinOk ? "ok" : "warn"}
        text={proteinOk ? t("day.proteinOk") : t("day.proteinShort", { g: fmtInt(day.proteinShort) })}
      />
    </View>
  );
}

/** The day against its targets: kcal and protein fills, carbs and fat ranges, then what the numbers mean. */
export function DaySummary({ day }: { day: DayView }) {
  const { t } = useTranslation("mealPlan");
  const { targets, total } = day;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t("day.total")}</Text>
      <TargetBar big label={t("day.kcal")} value={total.kcal} target={targets.kcal} unit="kcal" over={kcalIsOver(day)} />
      <TargetBar label={t("day.protein")} value={total.proteinG} target={targets.proteinG} unit="g" over={false} />
      <RangeBar label={t("day.carbs")} value={total.carbsG} range={targets.carbsG} />
      <RangeBar label={t("day.fat")} value={total.fatG} range={targets.fatG} />

      <MetaLine
        itemStyle={styles.breakdown}
        items={[
          `${t("day.eaten")} ${t("day.unitKcal", { n: fmtInt(day.eaten.kcal) })}`,
          day.isPast ? null : `${t("day.planned")} ${t("day.unitKcal", { n: fmtInt(day.planned.kcal) })}`,
        ]}
      />

      {day.isPast ? null : <DayStatuses day={day} />}
      <Text style={styles.source}>{t(targets.source === "live" ? "day.sourceLive" : "day.sourceBase")}</Text>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  bar: {
    gap: 8,
  },
  barHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    columnGap: theme.spacing.md,
    rowGap: 2,
  },
  barLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  barValues: {
    flexShrink: 1,
    textAlign: "right",
  },
  barValue: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  barValueBig: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
  },
  barOf: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  trackBig: {
    height: 12,
    borderRadius: 6,
  },
  fill: {
    height: "100%",
    borderRadius: 6,
  },
  rangeWrap: {
    height: 18,
    justifyContent: "center",
  },
  band: {
    position: "absolute",
    top: 2,
    bottom: 2,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.colors.makan,
    backgroundColor: theme.colors.makanSoft,
    opacity: 0.9,
  },
  marker: {
    position: "absolute",
    top: 0,
    width: 4,
    height: 18,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: theme.colors.foreground,
  },
  breakdown: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  statuses: {
    gap: 6,
  },
  status: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  statusText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    fontWeight: "600",
  },
  source: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
