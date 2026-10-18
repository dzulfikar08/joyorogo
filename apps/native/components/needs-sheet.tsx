import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { ACTIVITY_LABELS, needsBreakdown } from "@joyorogo/api/lib/engine";
import type { Targets } from "@joyorogo/api/lib/engine";
import { MAX_SURPLUS_KCAL, MIN_SURPLUS_KCAL } from "@joyorogo/api/lib/gain";

import { Num, Sheet, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";
import { orpc } from "@/utils/orpc";

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
 * Sheet "Kebutuhan harianmu", straight from needsBreakdown (no formula of its own). Normal plan: BMR -> potongan ->
 * target makan (no activity is assumed; counted exercise is added on Beranda). Hamil / Menyusui: BMR -> aktivitas ->
 * TDEE -> tambahan AKG -> target.
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
  const { t } = useTranslation(["settings", "maternal", "gain"]);
  const profile = useQuery({ ...orpc.profile.myProfile.queryOptions(), enabled: visible && !!targets.maternal });
  const needs = needsBreakdown(targets);
  const maternal = targets.maternal ?? null;
  const gain = targets.gain ?? null;
  const level = profile.data?.profile?.activityLevel as "low" | "mid" | "high" | undefined;

  const bmrStep: Step = {
    key: "bmr",
    label: t("plan.needs.bmr.label"),
    name: t("plan.needs.bmr.name"),
    body: t("plan.needs.bmr.body"),
    sign: "",
    kcal: needs.bmrKcal,
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
        {
          key: "activity",
          label: t("plan.needs.activity.label"),
          name: t("plan.needs.activity.name"),
          body: t("plan.needs.activity.body", { level: level ? ACTIVITY_LABELS[level] : "" }),
          sign: "+",
          kcal: needs.activityKcal,
        },
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

  return (
    <Sheet visible={visible} onClose={onClose} title={t("plan.needs.title")}>
      <Text style={styles.intro}>{t("plan.needs.intro")}</Text>
      {steps.map((step) => (
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
      {!maternal && needs.adaptive ? (
        <Text style={styles.note}>
          {t("plan.needs.adaptive", { formula: fmtInt(needs.formulaTdeeKcal) })}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  intro: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
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
