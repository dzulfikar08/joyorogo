import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import type { LocationStatus } from "@/src/lib/location";

const HINT_KEY = {
  off: "toggle.hint.off",
  locating: "toggle.hint.locating",
  ready: "toggle.hint.ready",
  denied: "toggle.hint.deniedApp",
  unavailable: "toggle.hint.unavailable",
} as const satisfies Record<LocationStatus, string>;

/** Opt-in switch under the place field; state comes from usePlaceLocation(). */
export function SaveLocationToggle({
  enabled,
  status,
  onChange,
}: {
  enabled: boolean;
  status: LocationStatus;
  onChange: (on: boolean) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("place");
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Ionicons name="location" size={18} color={theme.colors.makanText} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t("toggle.title")}</Text>
        <Text style={styles.hint}>{t(HINT_KEY[enabled ? status : "off"])}</Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
        thumbColor={theme.colors.background}
        accessibilityLabel={t("toggle.title")}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
}));
