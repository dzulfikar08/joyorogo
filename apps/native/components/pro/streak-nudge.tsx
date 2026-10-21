import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { useProOffer } from "@/components/pro/use-pro-offer";
import { Button, Card, Text } from "@/components/ui";
import { streakNudge } from "@/src/lib/pro-nudge";
import { readStreakNudge, writeStreakNudge } from "@/src/lib/pro-nudge-store";

/**
 * One card on Beranda when a free account's logging streak reaches 7, 14, 30, 60 or 100 days (and for two days after).
 * It is the moment someone has proven the habit, so the pitch is tied to it. Shown once per milestone: the close button
 * or the call to action marks the milestone as seen on this phone, and a streak that moves past it does not bring it back.
 */
export function StreakNudge({ userId, streakDays }: { userId: string | null; streakDays: number }) {
  const { t } = useTranslation("billing");
  const { theme } = useUnistyles();
  const { canSell } = useProOffer();
  const [lastShown, setLastShown] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readStreakNudge(userId).then((value) => {
      if (live) setLastShown(value);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  const milestone = canSell && userId && lastShown !== null ? streakNudge(streakDays, lastShown) : null;
  if (milestone === null || !userId) return null;

  const markSeen = () => {
    setLastShown(milestone);
    void writeStreakNudge(userId, milestone);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("nudge.streak.title", { days: milestone })}</Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("nudge.streak.dismiss")}
          onPress={markSeen}
          hitSlop={8}
          dimTo={0.6}
          style={styles.close}
        >
          <Ionicons name="close" size={20} color={theme.colors.makanText} />
        </PressableScale>
      </View>
      <Text style={styles.body}>{t("nudge.streak.body")}</Text>
      <Button
        size="sm"
        label={t("nudge.streak.cta")}
        onPress={() => {
          markSeen();
          router.push({ pathname: "/founder", params: { from: "streak", days: String(milestone) } });
        }}
        style={styles.cta}
      />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.makanSoft,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  title: {
    flex: 1,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.makanText,
  },
  close: {
    width: 44,
    height: 44,
    marginRight: -12,
    marginTop: -12,
    marginBottom: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.makanText,
  },
  cta: {
    alignSelf: "flex-start",
  },
}));
