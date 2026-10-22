import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";

/** Who answers right now ("claude-haiku-5.5, kunci sendiri" or "JoyoRogo Pro 3/20"); tapping it opens the Joyo AI settings. */
export function EngineChip({ label }: { label: string }) {
  const { t } = useTranslation("joyoAiApp");
  const { theme } = useUnistyles();
  const router = useRouter();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("chip.open", { engine: label })}
      onPress={() => router.push("/joyo-ai-settings")}
      scaleTo={0.97}
      style={styles.chip}
    >
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.mutedForeground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    minHeight: 44,
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.pill,
  },
  label: { flexShrink: 1, fontSize: theme.fontSize.sm, fontWeight: "600" },
}));
