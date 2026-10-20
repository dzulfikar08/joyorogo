import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { ManualTdeeInfo } from "@joyorogo/api/lib/manual-tdee";

import { CalibrationLearnLink } from "@/components/calibration-learn-link";
import { ManualTdeeForm, ManualTdeeSuggestionCard } from "@/components/manual-tdee";
import { Card, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

/** Profil > Target & tubuh: "Pakai TDEE sendiri", your own maintenance kcal with the goal pace and floors on top. */
export function ManualTdeeSection({ info }: { info: ManualTdeeInfo | null | undefined }) {
  const { t } = useTranslation("energy");
  if (!info) return null;
  return (
    <>
      <Card>
        <Text style={styles.title}>{t("manual.title")}</Text>
        <Text style={styles.note}>{t("manual.subtitle")}</Text>
        {info.kcal !== null ? (
          <View style={styles.status}>
            <Text style={styles.statusStrong}>{t("manual.active", { kcal: fmtInt(info.kcal) })}</Text>
            <Text style={styles.statusNote}>{t("manual.activeCalibration")}</Text>
          </View>
        ) : null}
        {/* a new key re-seeds the draft after a save, a reset or a "Pakai angka ini" */}
        <ManualTdeeForm key={info.kcal ?? "auto"} info={info} />
        <CalibrationLearnLink label={t("manual.learn")} hash="manual" />
      </Card>
      <ManualTdeeSuggestionCard info={info} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  note: {
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  status: {
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  statusStrong: {
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
}));
