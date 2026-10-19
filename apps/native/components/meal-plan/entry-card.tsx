import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { useAppConfig } from "@/components/billing";
import { PressableScale } from "@/components/motion";
import { Card, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

import { Pill } from "./parts";

/** "Rencana makan" entry on Beranda and Makan. Free accounts see a Pro label; the screen itself shows the upsell. */
export function MealPlanEntry() {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const config = useAppConfig();
  const free = profile.data?.tier === "free" && config.data?.paywall === true;
  const body = profile.data?.tier === "founder" ? t("entry.bodyPro") : t("entry.body");

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${t("entry.title")}${free ? `, ${t("entry.pro")}` : ""}. ${body}`}
      onPress={() => router.push("/rencana-makan")}
      scaleTo={0.98}
    >
      <Card style={styles.card}>
        <View style={styles.chip}>
          <Ionicons name="restaurant" size={20} color={theme.colors.makanText} />
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t("entry.title")}</Text>
            {free ? <Pill label={t("entry.pro")} tone="makan" /> : null}
          </View>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.cta}>
            <Text style={styles.ctaLabel}>{t("entry.cta")}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 32,
  },
  ctaLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
  },
}));
