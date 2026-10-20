import { Ionicons } from "@expo/vector-icons";
import { Linking } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";
import { SITE_ORIGIN } from "@/src/lib/share-links";

/** Link to a section of the public energy guide (the calibration one by default). `label` is the translated text. */
export function CalibrationLearnLink({ label, hash = "calibration" }: { label: string; hash?: string }) {
  const { theme } = useUnistyles();
  return (
    <PressableScale
      accessibilityRole="link"
      onPress={() => void Linking.openURL(`${SITE_ORIGIN}/panduan/kalori#${hash}`)}
      hitSlop={8}
      scaleTo={1}
      dimTo={0.7}
      style={styles.link}
    >
      <Text style={styles.label}>{label}</Text>
      <Ionicons name="open-outline" size={14} color={theme.colors.makanText} />
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  link: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: theme.spacing.xs,
    minHeight: 36,
  },
  label: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
}));
