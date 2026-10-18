import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { gainRemaining, type GainInfo, type GainIntakeState } from "@joyorogo/api/lib/gain";
import { i18n } from "@joyorogo/i18n";

import { Card, SectionTitle, Text } from "@/components/ui";
import { fmtInt, fmtKg } from "@/utils/format";
import { orpc } from "@/utils/orpc";

import { GainDisclaimer, GainNotes } from "./gain-notes";

/** The `gainRemaining()` result the helpers below turn into text. */
export type GainRemaining = { state: GainIntakeState; kcal: number };

/** "Sisa" under a gain plan: what is still to eat, never a budget to stay under. */
export function gainRemainingLabel(remaining: GainRemaining): string {
  return i18n.t(`gain:today.${remaining.state}`, { kcal: fmtInt(remaining.kcal) });
}

/** One gentle line under the ring for the current intake state. */
export function gainTipLabel(remaining: GainRemaining): string {
  const key = ({ short: "tipShort", reached: "tipReached", over: "tipOver" } as const)[remaining.state];
  return i18n.t(`gain:today.${key}`);
}

/** Beranda card where the Hamil card goes: plan summary, progress, streak, flag notes, caveats. */
export function GainCard({
  gain,
  targetKcal,
  tdee,
  streakDays,
  gainedKg,
  startKg,
}: {
  gain: GainInfo;
  targetKcal: number;
  tdee: number;
  streakDays: number;
  gainedKg: number;
  startKg: number | null;
}) {
  const { t } = useTranslation("gain");
  const { theme } = useUnistyles();
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.chip}>
          <Ionicons name="trending-up" size={16} color={theme.colors.makanText} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>{t("today.cardTitle")}</Text>
          <Text style={styles.body}>
            {t("today.cardSummary", {
              target: fmtInt(targetKcal),
              tdee: fmtInt(tdee),
              surplus: `+${fmtInt(gain.surplusKcal)}`,
            })}
          </Text>
        </View>
      </View>

      {gainedKg > 0 && startKg != null ? (
        <Text style={styles.body}>
          {t("today.progress", { kg: fmtKg(gainedKg), start: fmtKg(startKg) })}
        </Text>
      ) : null}
      <Text style={styles.body}>{t("today.toGo", { kg: fmtKg(gain.gapKg) })}</Text>

      {streakDays > 0 ? (
        <View style={styles.streak}>
          <Text style={styles.strong}>{t("today.streak", { count: streakDays })}</Text>
          <Text style={styles.small}>{t("today.streakRule")}</Text>
        </View>
      ) : null}

      <GainNotes gain={gain} />
      <View style={styles.estimate}>
        <Text style={styles.smallStrong}>{t("estimate.title")}</Text>
        <Text style={styles.small}>{t("estimate.body")}</Text>
      </View>
      <GainDisclaimer short />
    </Card>
  );
}

/**
 * Scan / barcode / manual-add advice under a gain plan: what the item does for the day, never a
 * verdict. Today gets the positive line plus the day total; a past day only the neutral total.
 */
export function GainScanAdvice({ date, kcal }: { date?: string; kcal: number }) {
  const { t } = useTranslation("gain");
  const { theme } = useUnistyles();
  const today = jakartaToday();
  const day = date ?? today;
  const summary = useQuery(orpc.day.summary.queryOptions({ input: { date: day } }));
  const targets = summary.data?.targets;
  if (!summary.data || !targets || !(kcal > 0)) return null;

  const eaten = summary.data.eatenKcal;
  const target = targets.eatKcal;
  const impact = t("coach.dayImpact", {
    total: fmtInt(Math.round(eaten + kcal)),
    target: fmtInt(target),
  });
  if (day !== today) return <Text style={styles.small}>{impact}</Text>;

  const left = gainRemaining(target, eaten);
  const stillShort = left.state === "short" && kcal < left.kcal;
  return (
    <View style={styles.scan}>
      <View style={styles.head}>
        <Ionicons name="checkmark-circle" size={20} color={theme.colors.makanText} />
        <Text style={styles.strong}>{t("coach.scanTitle")}</Text>
      </View>
      <Text style={styles.body}>
        {left.state === "short"
          ? t("coach.scanShort", { kcal: fmtInt(left.kcal) })
          : t("coach.scanReached")}
      </Text>
      <Text style={styles.small}>{impact}</Text>
      {stillShort ? <Text style={styles.small}>{t("coach.dense")}</Text> : null}
    </View>
  );
}

/** Daily tip for a gain plan: the loss-focused article of the day does not apply. */
export function GainDailyTip() {
  const { t } = useTranslation(["gain", "tips"]);
  return (
    <>
      <SectionTitle title={t("tips:daily.title")} />
      <Card>
        <Text style={styles.body}>{t("gain:coach.dailyTip")}</Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  headText: {
    flex: 1,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  streak: {
    gap: 2,
  },
  strong: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  small: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
  smallStrong: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  estimate: {
    gap: 2,
  },
  scan: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.makanSoft,
  },
}));
