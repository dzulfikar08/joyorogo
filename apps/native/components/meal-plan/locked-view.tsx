import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, SectionTitle, Text } from "@/components/ui";

import { ItemCard } from "./item-card";
import type { Overview } from "./use-meal-plan";

type Preview = Extract<Overview, { status: "locked" }>["preview"];

/** Free account: today's first meal in full as a taste, the rest only counted, and the way to Pro. */
export function LockedView({ preview }: { preview: Preview }) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();

  return (
    <>
      <Card style={styles.intro}>
        <View style={styles.icon}>
          <Ionicons name="lock-closed" size={20} color={theme.colors.makanText} />
        </View>
        <Text style={styles.title}>{t("locked.title")}</Text>
        <Text style={styles.body}>{t("locked.body")}</Text>
        <Button
          label={t("locked.cta")}
          onPress={() => router.push({ pathname: "/founder", params: { from: "banner", next: "/rencana-makan" } })}
        />
      </Card>

      {preview.item ? (
        <>
          <SectionTitle title={t("locked.preview")} />
          <ItemCard item={preview.item} />
        </>
      ) : null}

      {preview.hidden > 0 ? (
        <View style={styles.hidden}>
          <Ionicons name="lock-closed" size={16} color={theme.colors.mutedForeground} />
          <Text style={styles.hiddenText}>{t("locked.hidden", { n: preview.hidden })}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  intro: {
    gap: theme.spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    lineHeight: 26,
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.mutedForeground,
  },
  hidden: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    minHeight: 48,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  hiddenText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
}));
