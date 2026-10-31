import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { useNotificationGate } from "@/components/reminders/permission-sheet";
import { Button, Card, Text } from "@/components/ui";
import {
  getNotificationPermission,
  openNotificationSettings,
  type NotificationPermission,
} from "@/src/lib/notifications";
import { registerPush } from "@/src/lib/push";

type Surface = "home" | "feed";

const dismissKey = (surface: Surface) => `joyorogo.pushbanner.${surface}.v1`;

/**
 * "Notifications are off" card for Beranda and Feed. Hidden while permission is granted, while it is still being
 * read, and after the person closed it (per surface, stored on the phone). "Turn on" opens the shared pre-prompt;
 * when the system no longer shows the dialog it goes to the system settings instead.
 */
export function NotificationBanner({ surface }: { surface: Surface }) {
  const { t } = useTranslation("notifications");
  const { theme } = useUnistyles();
  const gate = useNotificationGate();
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    const refresh = () => void getNotificationPermission().then(setPermission);
    refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(dismissKey(surface))
      .then((value) => {
        if (!cancelled) setDismissed(value === "1");
      })
      .catch(() => {
        if (!cancelled) setDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [surface]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    void SecureStore.setItemAsync(dismissKey(surface), "1").catch(() => {
      // Best-effort: it only comes back after a restart.
    });
  }, [surface]);

  const enable = async () => {
    if (permission === "blocked") {
      await openNotificationSettings();
      return;
    }
    const granted = await gate.ensure();
    setPermission(await getNotificationPermission());
    if (granted) await registerPush({ force: true });
  };

  if (permission === null || permission === "granted" || dismissed !== false) return <>{gate.sheet}</>;

  return (
    <>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="notifications-outline" size={22} color={theme.colors.mutedForeground} />
          <Text style={styles.text}>{t("native.banner.text")}</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("native.banner.dismiss")}
            onPress={dismiss}
            scaleTo={1}
            dimTo={0.6}
            style={styles.close}
          >
            <Ionicons name="close" size={20} color={theme.colors.mutedForeground} />
          </PressableScale>
        </View>
        <Button
          size="sm"
          label={permission === "blocked" ? t("native.banner.openSettings") : t("native.banner.enable")}
          onPress={() => void enable()}
        />
      </Card>
      {gate.sheet}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  text: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.foreground, lineHeight: 20 },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -theme.spacing.sm,
    marginVertical: -theme.spacing.sm,
  },
}));
