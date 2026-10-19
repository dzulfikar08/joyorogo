import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { needsBreakdown } from "@joyorogo/api/lib/engine";
import type { Targets } from "@joyorogo/api/lib/engine";
import { DEFAULT_ADD_BACK_SETTINGS } from "@joyorogo/api/lib/exercise-credit";
import { MAX_SURPLUS_KCAL, MIN_SURPLUS_KCAL } from "@joyorogo/api/lib/gain";
import { fmtNumber } from "@joyorogo/i18n";

import { CalibrationLearnLink } from "@/components/calibration-learn-link";
import { EnergySources } from "@/components/energy-sources";
import { Num, Sheet, Text } from "@/components/ui";
import { loadAddBackSettings } from "@/src/lib/exercise-credit-prefs";
import { fmtDateMedium, fmtInt } from "@/utils/format";

type Step = {
  key: string;
  label: string;
  name: string;
  body: string;
  sign: "" | "+" | "−" | "=";
  kcal: number;
  strong?: boolean;
};

/**
 * Sheet "Kebutuhan harianmu", straight from needsBreakdown (no formula of its own). BMR -> pengali aktivitas -> TDEE ->
 * potongan / surplus / tambahan AKG (Hamil, Menyusui) -> target makan, then the movement measured above the factor,
 * what the factor already holds, and the sources.
 */
export function NeedsSheet({
  visible,
  onClose,
  targets,
}: {
  visible: boolean;
  onClose: () => void;
  targets: Targets;
}) {
  const { t } = useTranslation(["settings", "maternal", "gain", "energy"]);
  const needs = needsBreakdown(targets);
  const maternal = targets.maternal ?? null;
  const gain = targets.gain ?? null;
  const calibration = needs.calibration;
  const active = calibration?.status === "active" ? calibration : null;
  const calibrated = active !== null;
  // Only the "movement above the factor" row needs the percentage in force.
  const credit = useQuery({
    queryKey: ["add-back-settings"],
    queryFn: loadAddBackSettings,
    enabled: visible && needs.exerciseKcal > 0,
  });

  const bmrStep: Step = {
    key: "bmr",
    label: t("plan.needs.bmr.label"),
    name: t("plan.needs.bmr.name"),
    body: t("plan.needs.bmr.body"),
    sign: "",
    kcal: needs.bmrKcal,
  };
  const activityStep: Step = {
    key: "activity",
    label: t("plan.needs.activity.label"),
    name: t("plan.needs.activity.name"),
    body: active
      ? t("energy:needs.calibrated", {
          formula: fmtInt(active.formulaKcal),
          measured: fmtInt(active.measuredKcal ?? active.formulaKcal),
          used: fmtInt(active.usedKcal ?? needs.tdeeKcal),
        })
      : t("plan.needs.activity.body", { level: t(`energy:levels.${needs.level}.name`) }),
    sign: "+",
    kcal: needs.activityKcal,
  };
  const targetStep: Step = {
    key: "target",
    label: t("plan.needs.target.label"),
    name: t("plan.needs.target.name"),
    body: t("plan.needs.target.body"),
    sign: "=",
    kcal: needs.targetKcal,
    strong: true,
  };

  const steps: Step[] = maternal
    ? [
        bmrStep,
        activityStep,
        {
          key: "tdee",
          label: t("plan.needs.tdee.label"),
          name: t("maternal:needs.baseName"),
          body: t("maternal:needs.baseBody"),
          sign: "=",
          kcal: needs.tdeeKcal,
          strong: true,
        },
        {
          key: "add",
          label: t("maternal:target.add"),
          name: t(`maternal:needs.add.${maternal.stage}`),
          body: t("maternal:needs.addBody"),
          sign: "+",
          kcal: needs.addKcal,
        },
        targetStep,
      ]
    : [
        bmrStep,
        activityStep,
        {
          key: "tdee",
          label: t("plan.needs.tdee.label"),
          name: t("plan.needs.tdee.name"),
          body: t("plan.needs.tdee.body"),
          sign: "=",
          kcal: needs.tdeeKcal,
          strong: true,
        },
        gain
          ? {
              key: "surplus",
              label: t("gain:plan.surplus.label"),
              name: t("gain:plan.surplus.name"),
              body: t("gain:plan.surplus.body", { min: MIN_SURPLUS_KCAL, max: MAX_SURPLUS_KCAL }),
              sign: "+",
              kcal: needs.surplusKcal,
            }
          : needs.cutKcal > 0
            ? {
                key: "cut",
                label: t("plan.needs.cut.label"),
                name: t("plan.needs.cut.name"),
                body: t("plan.needs.cut.body"),
                sign: "−",
                kcal: needs.cutKcal,
              }
            : {
                key: "cut",
                label: t("plan.needs.cutNone.label"),
                name: t("plan.needs.cutNone.name"),
                body: t("plan.needs.cutNone.body"),
                sign: "",
                kcal: 0,
              },
        targetStep,
      ];

  // Movement measured above the factor: a step when something is counted today, a plain note otherwise.
  const extraStep: Step | null =
    needs.exerciseKcal > 0
      ? {
          key: "extra",
          label: t(calibrated ? "energy:needs.extra.labelCalibrated" : "energy:needs.extra.label"),
          name: t("energy:needs.extra.name"),
          body: t(calibrated ? "energy:needs.extra.bodyCalibrated" : "energy:needs.extra.body", {
            pct: credit.data?.pct ?? DEFAULT_ADD_BACK_SETTINGS.pct,
          }),
          sign: "+",
          kcal: needs.exerciseKcal,
        }
      : null;
  const shown = extraStep ? [...steps, extraStep] : steps;

  return (
    <Sheet visible={visible} onClose={onClose} title={t("plan.needs.title")}>
      <Text style={styles.intro}>{t("plan.needs.intro")}</Text>
      <Text style={styles.formula}>
        {calibrated
          ? t("energy:needs.formulaCalibrated", {
              bmr: fmtInt(needs.bmrKcal),
              move: fmtInt(needs.tdeeKcal - needs.bmrKcal),
              tdee: fmtInt(needs.tdeeKcal),
            })
          : t("energy:needs.formula", {
              bmr: fmtInt(needs.bmrKcal),
              factor: fmtNumber(needs.factor, 3),
              tdee: fmtInt(needs.tdeeKcal),
            })}
      </Text>
      {shown.map((step) => (
        <View key={step.key} style={[styles.step, step.strong && styles.stepStrong]}>
          <View style={styles.stepHead}>
            <View style={styles.stepTitle}>
              <Text style={styles.stepLabel}>{step.label}</Text>
              <Text style={styles.stepName}>{step.name}</Text>
            </View>
            <View style={styles.stepValue}>
              <Num style={styles.stepNumber}>
                {step.sign ? `${step.sign} ` : ""}
                {fmtInt(step.kcal)}
              </Num>
              <Text style={styles.stepUnit}>{t("plan.needs.unit")}</Text>
            </View>
          </View>
          <Text style={styles.stepBody}>{step.body}</Text>
        </View>
      ))}
      {extraStep ? null : <Text style={styles.note}>{t(calibrated ? "energy:needs.noneCalibrated" : "energy:needs.none")}</Text>}
      <Text style={styles.note}>
        {calibrated
          ? t("energy:needs.includedCalibrated", { kcal: fmtInt(needs.includedKcal) })
          : t("energy:needs.included", { factor: fmtNumber(needs.factor, 3), kcal: fmtInt(needs.includedKcal) })}
      </Text>
      {calibration && !maternal ? (
        <>
          {calibration.status === "off" ? (
            <Text style={styles.note}>{t("energy:auto.status.off", { formula: fmtInt(calibration.formulaKcal) })}</Text>
          ) : calibration.status === "waiting" ? (
            <Text style={styles.note}>
              {t("energy:auto.status.waiting", { date: fmtDateMedium(calibration.nextDate) })}
            </Text>
          ) : calibration.status === "collecting" ? (
            <Text style={styles.note}>
              {t("energy:auto.status.collecting", {
                logged: calibration.loggedDays,
                loggedNeeded: calibration.loggedDaysNeeded,
                count: calibration.weighIns,
                needed: calibration.weighInsNeeded,
                span: calibration.spanDays,
                spanNeeded: calibration.spanDaysNeeded,
              })}
            </Text>
          ) : null}
          <CalibrationLearnLink label={t("energy:auto.learn")} />
        </>
      ) : null}
      {maternal ? <Text style={styles.note}>{t("maternal:needs.noDeficit")}</Text> : null}
      {gain ? (
        <>
          <Text style={styles.note}>{t("gain:plan.burnNote")}</Text>
          <Text style={styles.note}>{t("gain:plan.estimate")}</Text>
          <Text style={styles.note}>{t("gain:estimate.body")}</Text>
        </>
      ) : null}
      {!maternal && !gain && !needs.maintenance && needs.deficitKcal > 0 ? (
        <Text style={styles.note}>{t("plan.needs.burnNote", { deficit: fmtInt(needs.deficitKcal) })}</Text>
      ) : null}
      <EnergySources plain />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  intro: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  formula: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  step: {
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  stepStrong: {
    backgroundColor: theme.colors.makanSoft,
  },
  stepHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  stepTitle: {
    flex: 1,
  },
  stepLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  stepName: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
  stepValue: {
    alignItems: "flex-end",
  },
  stepNumber: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
  },
  stepUnit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  stepBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
}));
