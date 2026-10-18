import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, usePathname } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { isHealthSyncSupported } from "@/src/lib/health-sync";
import { orpc } from "@/utils/orpc";

const healthName = Platform.OS === "ios" ? "Apple Health" : "Health Connect";

/** The two explanatory lines plus, where the Health card exists, a shortcut to it (Profil). */
function RetentionLines() {
  const { t } = useTranslation(["settings", "common"]);
  const { theme } = useUnistyles();
  const pathname = usePathname();
  const healthSupported = isHealthSyncSupported();
  const alternativeText = healthSupported
    ? t("strava.retention.healthAlternativeNative", { health: healthName })
    : t("strava.retention.healthAlternative");
  return (
    <View style={styles.lines}>
      <View style={styles.line}>
        <Ionicons name="time-outline" size={18} color={theme.colors.mutedForeground} />
        <Text style={styles.lineText}>{t("strava.retention.text")}</Text>
      </View>
      <View style={styles.line}>
        <Ionicons name="heart-outline" size={18} color={theme.colors.mutedForeground} />
        <Text style={styles.lineText}>{alternativeText}</Text>
      </View>
      {healthSupported && pathname !== "/profil/kesehatan" ? (
        <Button
          variant="secondary"
          size="sm"
          label={t("strava.retention.connectHealth", { health: healthName })}
          icon="heart"
          onPress={() => router.push("/profil/kesehatan")}
        />
      ) : null}
    </View>
  );
}

/** Block inside the Strava card, for everyone who can connect Strava. */
export function StravaRetentionNote() {
  return (
    <View style={styles.note}>
      <RetentionLines />
    </View>
  );
}

/**
 * Pemberitahuan sekali tampil untuk pengguna yang sudah menyambungkan Strava.
 * Penutupan disimpan di perangkat ini (SecureStore, per akun) supaya tidak muncul lagi.
 */
export function StravaRetentionNotice() {
  const { t } = useTranslation(["settings", "common"]);
  const { theme } = useUnistyles();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const status = useQuery(orpc.strava.status.queryOptions());
  const [dismissed, setDismissed] = useState(true);
  const storeKey = `joyorogo.stravaRetention7d.${userId}`;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    SecureStore.getItemAsync(storeKey)
      .then((stored) => {
        if (live) setDismissed(stored === "1");
      })
      .catch(() => {
        if (live) setDismissed(false);
      });
    return () => {
      live = false;
    };
  }, [userId, storeKey]);

  if (!status.data?.connected || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    void SecureStore.setItemAsync(storeKey, "1").catch(() => undefined);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("strava.retention.noticeTitle")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common:actions.close")}
          hitSlop={10}
          onPress={dismiss}
        >
          <Ionicons name="close" size={20} color={theme.colors.mutedForeground} />
        </Pressable>
      </View>
      <RetentionLines />
      <Button label={t("strava.retention.understood")} onPress={dismiss} />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
  },
  card: {
    gap: theme.spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  lines: {
    gap: theme.spacing.sm,
    alignItems: "flex-start",
  },
  line: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    alignItems: "flex-start",
  },
  lineText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
}));
