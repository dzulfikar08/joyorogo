import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";
import { calibrationChip } from "@/src/lib/calibration-chip";
import { fmtDateMedium } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * One line on Beranda while the automatic calibration is still collecting data (or holding for Monday): how long at the
 * earliest, or what it waits for. Gone once the calibration is active, off, or manual; the note about the target
 * moving stays with the notices. Reads the same verdict as Profil > Target & tubuh (`profile.activityGuide`).
 */
export function CalibrationChip({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation("home");
  const { theme } = useUnistyles();
  const guide = useQuery({
    ...orpc.profile.activityGuide.queryOptions(),
    enabled,
    // The gates move a day at a time.
    staleTime: 10 * 60_000,
  });
  const chip = calibrationChip(guide.data?.autoCalibration);
  if (!enabled || !chip) return null;
  const text =
    chip.kind === "days"
      ? t("calChip.days", { count: chip.days })
      : chip.kind === "waiting"
        ? t("calChip.waiting", { date: fmtDateMedium(chip.date) })
        : t("calChip.weigh");
  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint={t("calChip.hint")}
        onPress={() => router.push("/profil/target")}
        scaleTo={0.97}
        dimTo={0.8}
        style={styles.chip}
      >
        <Ionicons name="speedometer-outline" size={16} color={theme.colors.mutedForeground} />
        <Text style={styles.text} numberOfLines={1}>
          {text}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={theme.colors.mutedForeground} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row" },
  chip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  text: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
}));
