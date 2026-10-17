import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import Animated, { SlideInUp, SlideOutUp, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Text } from "@/components/ui";
import { useAppUpdate } from "@/src/lib/use-app-update";

/**
 * Android-only banner for a newer JoyoRogo build. Play installs use Play's
 * flexible in-app update (download in the background, then "Mulai ulang");
 * sideload installs use the latest-apk.json updater. Renders nothing on iOS,
 * web, or when there is no update.
 */
export function UpdateBanner() {
  const { t } = useTranslation("settings");
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { banner, update, restart, dismiss } = useAppUpdate();

  if (banner === null) return null;

  const icon = banner.kind === "ready" ? "refresh-circle" : "arrow-down-circle";
  const title =
    banner.kind === "available"
      ? t("update.banner.title")
      : banner.kind === "downloading"
        ? t("update.banner.downloadingTitle")
        : t("update.banner.readyTitle");
  const body =
    banner.kind === "available"
      ? banner.failed
        ? t("update.banner.failed")
        : banner.versionName
          ? t("update.banner.body", { name: banner.versionName })
          : t("update.banner.bodyPlain")
      : banner.kind === "downloading"
        ? banner.percent === null
          ? undefined
          : t("update.banner.downloadingPercent", { percent: banner.percent })
        : t("update.banner.readyBody");

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: insets.top + 8 }]}>
      <Animated.View
        entering={reduceMotion ? undefined : SlideInUp.duration(220)}
        exiting={reduceMotion ? undefined : SlideOutUp.duration(180)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.card, { borderColor: theme.colors.hairline }]}
      >
        <View style={styles.row}>
          <View style={[styles.chip, { backgroundColor: theme.colors.makanSoft }]}>
            <Ionicons name={icon} size={20} color={theme.colors.makanText} />
          </View>
          <View style={styles.texts}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {body ? (
              <Text style={styles.body} numberOfLines={2}>
                {body}
              </Text>
            ) : null}
          </View>
        </View>

        {banner.kind === "downloading" ? (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${banner.percent ?? 4}%`, backgroundColor: theme.colors.primary },
              ]}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              label={t("update.banner.later")}
              onPress={dismiss}
            />
            <Button
              size="sm"
              label={banner.kind === "ready" ? t("update.banner.restart") : t("update.banner.update")}
              onPress={banner.kind === "ready" ? restart : () => void update()}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // Under the toast (100) so feedback toasts still land on top.
    zIndex: 90,
    elevation: 90,
    paddingHorizontal: theme.spacing.lg,
  },
  card: {
    borderRadius: theme.radius.tile,
    borderWidth: 1,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    shadowColor: "#1D1A15",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  chip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
}));
