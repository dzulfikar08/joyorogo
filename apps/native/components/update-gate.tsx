import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, BackHandler, Platform, ScrollView, View } from "react-native";
import Animated, { SlideInUp, SlideOutUp, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Button, Text } from "@/components/ui";
import { SHEET_MAX_WIDTH } from "@/src/lib/layout";
import { openStore, useForceUpdate } from "@/src/lib/use-force-update";

/**
 * Launch-time gate, mounted once above the navigator. In order:
 * 1. "Memperbarui…" while the cold-start OTA check downloads a newer bundle (max 8 s, then the app opens).
 * 2. A blocking "Update dulu" screen when the installed native build is below the server's minimum.
 * 3. On iOS, a dismissible "Ada versi baru" banner when it is below the latest build.
 * Renders nothing otherwise, and never blocks when the config cannot be fetched.
 */
export function UpdateGate() {
  const gate = useForceUpdate();
  if (gate.otaBusy) return <OtaSplash />;
  if (gate.decision === "block") {
    return (
      <BlockScreen
        message={gate.message}
        links={gate.links}
        checking={gate.checking}
        recheck={gate.recheck}
      />
    );
  }
  if (gate.showBanner) return <NewVersionBanner links={gate.links} dismiss={gate.dismissBanner} />;
  return null;
}

function OtaSplash() {
  const { t } = useTranslation("settings");
  const { theme } = useUnistyles();
  return (
    <View style={styles.full} accessibilityLiveRegion="polite">
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={styles.splashText}>{t("update.gate.ota")}</Text>
    </View>
  );
}

function BlockScreen({
  message,
  links,
  checking,
  recheck,
}: {
  message: string | undefined;
  links: string[];
  checking: boolean;
  recheck: () => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const [rechecked, setRechecked] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  // Android back must not slip past the gate.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const store = Platform.OS === "ios" ? "ios" : "android";
  return (
    <View style={styles.full} accessibilityViewIsModal>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={[styles.chip, { backgroundColor: theme.colors.makanSoft }]}>
          <Ionicons name="arrow-down-circle" size={36} color={theme.colors.makanText} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {t("update.gate.block.title")}
        </Text>
        <Text style={styles.body}>{t("update.gate.block.body")}</Text>
        {message ? <Text style={styles.body}>{message}</Text> : null}
        <Text style={styles.body}>{t(`update.gate.block.how.${store}`)}</Text>
        {openFailed ? <Text style={styles.warn}>{t("update.gate.block.openFailed")}</Text> : null}
        {rechecked && !checking ? <Text style={styles.warn}>{t("update.gate.block.stillOld")}</Text> : null}
        <View style={styles.actions}>
          <Button
            label={t("update.gate.block.update")}
            icon="open-outline"
            onPress={() => void openStore(links).then((ok) => setOpenFailed(!ok))}
          />
          <Button
            variant="ghost"
            size="sm"
            label={checking ? t("update.gate.block.rechecking") : t("update.gate.block.recheck")}
            disabled={checking}
            onPress={() => void recheck().then(() => setRechecked(true))}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function NewVersionBanner({ links, dismiss }: { links: string[]; dismiss: () => void }) {
  const { t } = useTranslation("settings");
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  return (
    <View pointerEvents="box-none" style={[styles.bannerOverlay, { paddingTop: insets.top + 8 }]}>
      <Animated.View
        entering={reduceMotion ? undefined : SlideInUp.duration(220)}
        exiting={reduceMotion ? undefined : SlideOutUp.duration(180)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.card, { borderColor: theme.colors.hairline }]}
      >
        <View style={styles.row}>
          <View style={[styles.smallChip, { backgroundColor: theme.colors.makanSoft }]}>
            <Ionicons name="arrow-down-circle" size={20} color={theme.colors.makanText} />
          </View>
          <View style={styles.texts}>
            <Text style={styles.bannerTitle}>{t("update.gate.banner.title")}</Text>
            <Text style={styles.bannerBody}>{t("update.gate.banner.body")}</Text>
          </View>
        </View>
        <View style={styles.bannerActions}>
          <Button variant="ghost" size="sm" label={t("update.gate.banner.later")} onPress={dismiss} />
          <Button size="sm" label={t("update.gate.banner.update")} onPress={() => void openStore(links)} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Above the toast (100) and the update banner (90): nothing may sit over the gate.
  full: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    elevation: 200,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
  },
  splashText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
  },
  scroll: {
    alignSelf: "stretch",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
    width: "100%",
    maxWidth: SHEET_MAX_WIDTH,
    alignSelf: "center",
  },
  chip: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  body: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  warn: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  actions: {
    alignSelf: "stretch",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  bannerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 90,
    elevation: 90,
    paddingHorizontal: theme.spacing.lg,
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: SHEET_MAX_WIDTH,
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
  smallChip: {
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
  bannerTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  bannerBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  bannerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
  },
}));
