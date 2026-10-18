import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { GainInfo } from "@joyorogo/api/lib/gain";

import { InfoNote } from "@/components/maternal/flag-notes";
import { Text } from "@/components/ui";

/** GainInfo.flags as neutral info cards (never alarm colors, never blocks anything). */
export function GainNotes({ gain }: { gain: GainInfo }) {
  const { t } = useTranslation("gain");
  if (gain.flags.length === 0) return null;
  return (
    <View style={styles.stack}>
      {gain.flags.map((flag) => {
        switch (flag) {
          case "BMI_LOW":
            return (
              <InfoNote
                key={flag}
                title={t("notes.bmiLow.title")}
                body={t("notes.bmiLow.body", { bmi: gain.bmi })}
              />
            );
          case "RAPID_LOSS":
            return (
              <InfoNote key={flag} title={t("notes.rapidLoss.title")} body={t("notes.rapidLoss.body")} />
            );
          case "TARGET_ABOVE_HEALTHY":
            return (
              <InfoNote
                key={flag}
                title={t("notes.aboveHealthy.title")}
                body={t("notes.aboveHealthy.body", { bmi: gain.targetBmi })}
              />
            );
        }
      })}
    </View>
  );
}

/** Not-a-medical-device disclaimer: full info card (setup, Settings) or one small line (dashboard card). */
export function GainDisclaimer({ short = false }: { short?: boolean }) {
  const { t } = useTranslation("gain");
  if (short) return <Text style={styles.short}>{t("notes.disclaimer")}</Text>;
  return <InfoNote body={t("notes.disclaimer")} />;
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.spacing.sm,
  },
  short: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
