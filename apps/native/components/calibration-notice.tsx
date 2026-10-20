import "@/unistyles";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { CalibrationNotice as CalibrationNoticeData } from "@joyorogo/api/lib/calibration";

import { CalibrationLearnLink } from "@/components/calibration-learn-link";
import { CollapsibleNotice } from "@/components/collapsible-notice";
import { Button, Text } from "@/components/ui";
import { saveCalibrationPref } from "@/src/lib/calibration-prefs";
import { syncPrefs } from "@/src/lib/prefs-sync";
import { fmtInt } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * Beranda note that automatic calibration moved the base eat target. `notice` is the server's verdict
 * (`day.summary.calibrationNotice`); null hides it. Closing it stores the figure as seen (synced), hides the card
 * at once and refetches the day once the prefs are pushed.
 */
export function CalibrationNotice({ notice }: { notice: CalibrationNoticeData | null | undefined }) {
  const { t } = useTranslation("energy");
  // The figure the person closed in this session: the card stays hidden until the server sends a different one.
  const [closedKcal, setClosedKcal] = useState<number | null>(null);

  if (!notice || notice.toKcal === closedKcal) return null;

  const dismiss = async () => {
    setClosedKcal(notice.toKcal);
    await saveCalibrationPref("energy.calibrationSeen", notice.toKcal);
    await syncPrefs().catch(() => null);
    await queryClient.invalidateQueries({ queryKey: orpc.day.summary.key() });
  };

  return (
    <CollapsibleNotice id="calibration" title={t("calNotice.title")}>
      <Text style={styles.body}>
        {t("calNotice.body", { old: fmtInt(notice.fromKcal), new: fmtInt(notice.toKcal) })}
      </Text>
      <Text style={styles.body}>{t("calNotice.hint")}</Text>
      <View style={styles.actions}>
        <Button
          label={t("calNotice.action")}
          onPress={() => {
            void dismiss();
            router.push("/profil/target");
          }}
        />
        <Button variant="secondary" label={t("calNotice.dismiss")} onPress={() => void dismiss()} />
        <CalibrationLearnLink label={t("calNotice.learn")} />
      </View>
    </CollapsibleNotice>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
}));
