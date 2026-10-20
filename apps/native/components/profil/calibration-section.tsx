import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { CalibrationInfo } from "@joyorogo/api/lib/calibration";

import { CalibrationLearnLink } from "@/components/calibration-learn-link";
import { Card, Text } from "@/components/ui";
import { loadCalibrationEnabled, saveCalibrationPref } from "@/src/lib/calibration-prefs";
import { syncPrefs } from "@/src/lib/prefs-sync";
import { fmtDateMedium, fmtInt } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/** One thing the calibration still waits for: its label, how far it is, and a bar for it. */
function Progress({ label, text, value, needed }: { label: string; text: string; value: number; needed: number }) {
  const share = Math.min(1, value / needed);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${text}`}
      accessibilityValue={{ min: 0, max: needed, now: Math.min(value, needed) }}
    >
      <View style={styles.progressHead}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressText}>{text}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
      </View>
    </View>
  );
}

/** Where the calibration stands, from the server's verdict (`profile.activityGuide.autoCalibration`). */
function Status({ info }: { info: CalibrationInfo }) {
  const { t } = useTranslation("energy");
  const formula = fmtInt(info.formulaKcal);
  switch (info.status) {
    case "collecting":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>{t("auto.status.collectingTitle")}</Text>
          <View style={styles.progressList}>
            <Progress
              label={t("auto.progress.days")}
              text={t("auto.progress.value", { value: info.loggedDays, needed: info.loggedDaysNeeded })}
              value={info.loggedDays}
              needed={info.loggedDaysNeeded}
            />
            <Progress
              label={t("auto.progress.weighIns")}
              text={t("auto.progress.value", { value: info.weighIns, needed: info.weighInsNeeded })}
              value={info.weighIns}
              needed={info.weighInsNeeded}
            />
            <Progress
              label={t("auto.progress.span")}
              text={t("auto.progress.valueDays", { value: info.spanDays, needed: info.spanDaysNeeded })}
              value={info.spanDays}
              needed={info.spanDaysNeeded}
            />
          </View>
          <Text style={styles.statusNote}>{t("auto.status.collectingHint")}</Text>
        </View>
      );
    case "waiting":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>{t("auto.status.waitingTitle")}</Text>
          <Text style={styles.statusNote}>{t("auto.status.waitingBody", { date: fmtDateMedium(info.nextDate) })}</Text>
        </View>
      );
    case "active":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>{t("auto.status.activeTitle")}</Text>
          <Text style={styles.statusStrong}>
            {t("auto.status.activeBody", { formula, used: fmtInt(info.usedKcal ?? info.formulaKcal) })}
          </Text>
          <Text style={styles.statusNote}>
            {t(info.clamped ? "auto.status.clamped" : "auto.status.activeMeasured", {
              measured: info.measuredKcal === null ? formula : fmtInt(info.measuredKcal),
            })}
          </Text>
          <Text style={styles.statusNote}>
            {t("auto.status.held", { date: fmtDateMedium(info.anchorDate), next: fmtDateMedium(info.nextDate) })}
          </Text>
        </View>
      );
    case "manual":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>{t("auto.status.manualTitle")}</Text>
          <Text style={styles.statusNote}>
            {info.measuredKcal === null
              ? t("auto.status.manualBodyNoMeasure")
              : t("auto.status.manualBody", { measured: fmtInt(info.measuredKcal) })}
          </Text>
        </View>
      );
    case "off":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>{t("auto.status.offTitle")}</Text>
          <Text style={styles.statusNote}>{t("auto.status.offBody", { formula })}</Text>
          {info.measuredKcal !== null ? (
            <Text style={styles.statusNote}>
              {t("auto.status.offMeasured", { measured: fmtInt(info.measuredKcal), formula })}
            </Text>
          ) : null}
        </View>
      );
  }
}

/**
 * Profil > Target & tubuh: the switch for automatic calibration of the eat target to the weight trend, where it stands,
 * and one line on how it works. The server reads the switch from the synced prefs, so a change is pushed before refetching.
 */
export function CalibrationSection({
  info,
  maternal,
}: {
  info: CalibrationInfo | null;
  maternal: boolean;
}) {
  const { t } = useTranslation("energy");
  const { theme } = useUnistyles();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // The server's verdict (the plan it computed) wins over this phone's copy, so the switch can never disagree with it.
  const serverEnabled = info?.enabled;
  useEffect(() => {
    if (serverEnabled !== undefined) {
      setEnabled(serverEnabled);
      return;
    }
    let live = true;
    void loadCalibrationEnabled().then((loaded) => {
      if (live) setEnabled(loaded);
    });
    return () => {
      live = false;
    };
  }, [serverEnabled]);

  if (enabled === null) return null;

  const pending = info?.status === "collecting" || info?.status === "waiting";

  const commit = async (value: boolean) => {
    setEnabled(value);
    await saveCalibrationPref("energy.calibration", value);
    await syncPrefs().catch(() => null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.fasting.today.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.weight.key() }),
    ]);
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t("auto.title")}</Text>
      {maternal ? (
        <Text style={styles.note}>{t("auto.maternal")}</Text>
      ) : (
        <>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>{t("auto.toggle")}</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={(value) => void commit(value)}
              trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
              thumbColor={theme.colors.background}
              accessibilityLabel={t("auto.toggle")}
            />
          </View>
          <Text style={styles.consequence}>
            {t(
              !enabled
                ? "auto.toggleOff"
                : info?.status === "manual"
                  ? "auto.toggleManual"
                  : pending
                    ? "auto.toggleOnPending"
                    : "auto.toggleOn",
            )}
          </Text>

          {info ? <Status info={info} /> : null}

          <Text style={styles.note}>{t("auto.explain")}</Text>
          <CalibrationLearnLink label={t("auto.learn")} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minHeight: 44,
    marginTop: theme.spacing.sm,
  },
  switchText: { flex: 1, flexShrink: 1 },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  consequence: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  note: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  status: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  statusTitle: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  statusStrong: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  statusNote: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.makanText,
  },
  progressList: { marginTop: theme.spacing.sm, gap: theme.spacing.sm },
  progressHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  progressLabel: {
    flex: 1,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.makanText,
  },
  progressText: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  track: {
    height: 8,
    marginTop: theme.spacing.xs,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.background,
  },
  fill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
}));
