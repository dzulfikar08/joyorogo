import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";

import { InfoNote } from "./flag-notes";

/** Not-a-medical-device disclaimer: full (setup flow, Settings) or one line (dashboard card). */
export function MaternalDisclaimer({ short = false }: { short?: boolean }) {
  const { t } = useTranslation("maternal");
  if (short) return <Text style={styles.short}>{t("disclaimer.short")}</Text>;
  return (
    <InfoNote
      title={t("disclaimer.title")}
      body={`${t("disclaimer.body")}\n\n${t("disclaimer.kia")}`}
    />
  );
}

/** Privacy note: pregnancy and feeding data stay private. */
export function MaternalPrivacyNote() {
  const { t } = useTranslation("maternal");
  return (
    <View>
      <Text style={styles.short}>{t("privacy.note")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  short: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
