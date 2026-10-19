import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { ActivityLevel } from "@joyorogo/api/lib/engine";
import type {
  ActivityOption,
  CalibrationRecommendation,
  StepsRecommendation,
} from "@joyorogo/api/lib/activity-guide";
import { fmtNumber } from "@joyorogo/i18n";

import { PressableScale } from "@/components/motion";
import { Button, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

/** The pick rule, shown at every level picker: choose by daily life, without the workouts that are logged. */
function PickRule({ children }: { children: string }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.callout}>
      <Ionicons name="information-circle" size={20} color={theme.colors.makanText} />
      <Text style={styles.calloutText}>{children}</Text>
    </View>
  );
}

function LevelOption({
  option,
  current,
  selected,
  disabled,
  onPress,
}: {
  option: ActivityOption;
  /** the option the person has now (what the impact line compares against) */
  current: ActivityOption | null;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation("energy");
  const { theme } = useUnistyles();
  const diff = current ? option.targetKcal - current.targetKcal : 0;
  const impact = selected
    ? t("impact.current")
    : diff > 0
      ? t("impact.up", { kcal: fmtInt(diff) })
      : diff < 0
        ? t("impact.down", { kcal: fmtInt(-diff) })
        : t("impact.same");
  const name = t(`levels.${option.level}.name`);
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <View style={styles.optionHead}>
        <View style={styles.optionTitle}>
          <Text style={[styles.optionName, selected && styles.selectedText]}>{name}</Text>
          <View style={styles.badgeRow}>
            <Text style={styles.factor}>{t("factor", { factor: fmtNumber(option.factor, 3) })}</Text>
            {selected ? <Text style={styles.currentBadge}>{t("current")}</Text> : null}
          </View>
        </View>
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={24}
          color={selected ? theme.colors.primary : theme.colors.mutedForeground}
        />
      </View>
      <Text style={styles.desc}>{t(`levels.${option.level}.desc`)}</Text>
      <Text style={styles.example}>{t(`levels.${option.level}.example`)}</Text>
      <View style={styles.result}>
        <Text style={styles.target}>{t("impact.target", { kcal: fmtInt(option.targetKcal) })}</Text>
        <Text style={styles.example}>{t("impact.tdee", { kcal: fmtInt(option.tdeeKcal) })}</Text>
        <Text style={[styles.impact, selected && styles.selectedText]}>{impact}</Text>
        {option.floored ? <Text style={styles.floor}>{t("impact.floor")}</Text> : null}
      </View>
    </PressableScale>
  );
}

/**
 * The five activity levels with what each makes of THIS person's eat target. Presentational: the caller supplies the
 * options (server `profile.activityGuide`, or `activityOptions` computed from the onboarding form) and the selection.
 */
export function ActivityLevelPicker({
  options,
  value,
  maternal,
  disabled = false,
  onSelect,
}: {
  options: readonly ActivityOption[];
  value: ActivityLevel | null;
  maternal: boolean;
  disabled?: boolean;
  onSelect: (level: ActivityLevel) => void;
}) {
  const { t } = useTranslation("energy");
  const current = options.find((option) => option.level === value) ?? null;
  return (
    <View style={styles.wrap}>
      <PickRule>{t("pickRule")}</PickRule>
      {maternal ? <Text style={styles.note}>{t("maternalNote")}</Text> : null}
      <View style={styles.list} accessibilityRole="radiogroup">
        {options.map((option) => (
          <LevelOption
            key={option.level}
            option={option}
            current={current}
            selected={option.level === value}
            disabled={disabled}
            onPress={() => onSelect(option.level)}
          />
        ))}
      </View>
      {current ? (
        <Text style={styles.note}>{t("included", { kcal: fmtInt(current.includedKcal) })}</Text>
      ) : null}
    </View>
  );
}

function ApplyRow({
  level,
  current,
  applying,
  onApply,
}: {
  level: ActivityLevel;
  current: ActivityLevel | null;
  applying: ActivityLevel | null;
  onApply: (level: ActivityLevel) => void;
}) {
  const { t } = useTranslation("energy");
  if (level === current) return <Text style={styles.sameText}>{t("recommend.same")}</Text>;
  const busy = applying === level;
  return (
    <View style={styles.applyRow}>
      <Text style={styles.suggest}>{t("recommend.suggest", { level: t(`levels.${level}.name`) })}</Text>
      <Button
        size="sm"
        label={busy ? t("recommend.applying") : t("recommend.apply")}
        disabled={applying !== null}
        onPress={() => onApply(level)}
      />
    </View>
  );
}

/**
 * "Lebih akurat": the steps and weight-trend recommendations for the level, each with its reasoning. Recommendations
 * are never applied on their own. `showEmpty` explains when neither exists (settings); otherwise nothing renders.
 */
export function ActivityRecommendations({
  steps,
  calibration,
  current,
  applying,
  showEmpty,
  onApply,
}: {
  steps: StepsRecommendation | null;
  calibration: CalibrationRecommendation | null;
  /** the level in effect (saved on the settings screen, selected in the onboarding form) */
  current: ActivityLevel | null;
  /** the level being saved right now, if any (disables the other buttons) */
  applying: ActivityLevel | null;
  showEmpty: boolean;
  onApply: (level: ActivityLevel) => void;
}) {
  const { t } = useTranslation("energy");
  if (!steps && !calibration && !showEmpty) return null;
  return (
    <View style={styles.recWrap}>
      <Text style={styles.recTitle}>{t("recommend.title")}</Text>
      <Text style={styles.note}>{t("recommend.intro")}</Text>
      {steps ? (
        <View style={styles.recCard}>
          <Text style={styles.recCardTitle}>{t("recommend.steps.title")}</Text>
          <Text style={styles.desc}>
            {t("recommend.steps.body", {
              steps: fmtInt(steps.avgSteps),
              days: steps.days,
              level: t(`levels.${steps.level}.name`),
            })}
          </Text>
          <Text style={styles.example}>{t("recommend.steps.bounds")}</Text>
          <ApplyRow level={steps.level} current={current} applying={applying} onApply={onApply} />
        </View>
      ) : null}
      {calibration ? (
        <View style={styles.recCard}>
          <Text style={styles.recCardTitle}>{t("recommend.calibration.title")}</Text>
          <Text style={styles.desc}>
            {t("recommend.calibration.body", {
              days: calibration.windowDays,
              logged: calibration.loggedDays,
              measured: fmtInt(calibration.measuredKcal),
              formula: fmtInt(calibration.formulaKcal),
              level: t(`levels.${calibration.level}.name`),
              factor: fmtNumber(calibration.impliedFactor, 2),
            })}
          </Text>
          <Text style={styles.target}>{t("recommend.calibration.measured", { kcal: fmtInt(calibration.measuredKcal) })}</Text>
          <Text style={styles.target}>{t("recommend.calibration.formula", { kcal: fmtInt(calibration.formulaKcal) })}</Text>
          <Text style={styles.example}>{t("recommend.calibration.note")}</Text>
          <ApplyRow level={calibration.level} current={current} applying={applying} onApply={onApply} />
        </View>
      ) : null}
      {!steps && !calibration ? <Text style={styles.note}>{t("recommend.empty")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.md },
  callout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  calloutText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  list: { gap: theme.spacing.md },
  option: {
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  optionSelected: { backgroundColor: theme.colors.makanSoft },
  optionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  optionTitle: { flex: 1, gap: 2 },
  optionName: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  selectedText: { color: theme.colors.makanText },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.sm,
  },
  factor: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  currentBadge: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  desc: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  example: {
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  result: {
    gap: 2,
    marginTop: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  target: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  impact: {
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  floor: {
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.warning,
  },
  recWrap: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  recTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  recCard: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  recCardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  applyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  suggest: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  sameText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
}));
