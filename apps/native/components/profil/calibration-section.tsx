import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { CalibrationInfo } from "@joyorogo/api/lib/calibration";

import { Card, Text } from "@/components/ui";
import { loadCalibrationEnabled, saveCalibrationPref } from "@/src/lib/calibration-prefs";
import { syncPrefs } from "@/src/lib/prefs-sync";
import { fmtDateMedium, fmtInt } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/** Where the calibration stands, from the server's verdict (`profile.activityGuide.autoCalibration`). */
function Status({ info }: { info: CalibrationInfo }) {
  const { t } = useTranslation("energy");
  const formula = fmtInt(info.formulaKcal);
  switch (info.status) {
    case "collecting":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>
            {t("auto.status.collecting", {
              logged: info.loggedDays,
              loggedNeeded: info.loggedDaysNeeded,
              span: info.spanDays,
              spanNeeded: info.spanDaysNeeded,
            })}
          </Text>
          <Text style={styles.statusNote}>
            {t("auto.status.collectingWeighIns", { count: info.weighIns, needed: info.weighInsNeeded })}
          </Text>
          <Text style={styles.statusNote}>{t("auto.status.collectingHint")}</Text>
        </View>
      );
    case "waiting":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>{t("auto.status.waiting", { date: fmtDateMedium(info.nextDate) })}</Text>
        </View>
      );
    case "active":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>
            {t("auto.status.active", {
              formula,
              measured: info.measuredKcal === null ? formula : fmtInt(info.measuredKcal),
              used: fmtInt(info.usedKcal ?? info.formulaKcal),
            })}
          </Text>
          {info.clamped ? <Text style={styles.statusNote}>{t("auto.status.clamped")}</Text> : null}
          <Text style={styles.statusNote}>
            {t("auto.status.held", { date: fmtDateMedium(info.anchorDate), next: fmtDateMedium(info.nextDate) })}
          </Text>
        </View>
      );
    case "off":
      return (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>{t("auto.status.off", { formula })}</Text>
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
 * Profil > Target & tubuh: the switch for automatic calibration of the eat target to the weight trend, what it does,
 * and where it stands. The server reads the switch from the synced prefs, so a change is pushed before refetching.
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
          <Text style={styles.body}>{t("auto.how")}</Text>
          <Text style={styles.note}>{t("auto.guard")}</Text>
          <Text style={styles.note}>{t("auto.weekly")}</Text>

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

          {info ? <Status info={info} /> : null}
          <Text style={styles.note}>{enabled ? t("auto.levelNote") : t("auto.off")}</Text>
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
    marginBottom: theme.spacing.sm,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minHeight: 44,
    marginTop: theme.spacing.md,
  },
  switchText: { flex: 1 },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  note: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  status: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  statusNote: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.makanText,
  },
  statusTitle: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
}));
