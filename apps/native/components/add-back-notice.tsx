import "@/unistyles";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { DEFAULT_ADD_BACK_SETTINGS } from "@joyorogo/api/lib/exercise-credit";

import { Button, Card, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { readDismissal, saveDismissal } from "@/src/lib/dismissals";

/** One-time note that Sisa now adds back exercise. `show` is the server's verdict (`day.summary.addBackNotice`). */
export function AddBackNotice({ show }: { show: boolean }) {
  const { t } = useTranslation("home");
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readDismissal("dismissed.addBackNotice", userId).then((stored) => {
      if (live) setDismissed(stored);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!show || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    if (userId) void saveDismissal("dismissed.addBackNotice", userId);
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t("addBackNotice.title")}</Text>
      <Text style={styles.body}>{t("addBackNotice.body", { pct: DEFAULT_ADD_BACK_SETTINGS.pct })}</Text>
      <View style={styles.actions}>
        <Button
          label={t("addBackNotice.action")}
          onPress={() => {
            dismiss();
            router.push("/profil/target");
          }}
        />
        <Button variant="secondary" label={t("addBackNotice.dismiss")} onPress={dismiss} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.sm },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
}));
