import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useProOffer } from "@/components/pro/use-pro-offer";
import { Button, Card, Text } from "@/components/ui";

/**
 * The Pro card at the top of Lainnya for free accounts that can buy: what Pro is, in one concrete line, and the button.
 * It replaces the list row at the bottom of the page that nobody scrolled to. Draws nothing for Pro accounts.
 */
export function MoreProCard() {
  const { t } = useTranslation("billing");
  const { canSell, config } = useProOffer();
  if (!canSell || !config) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.text}>
        <Text style={styles.title}>{t("nudge.more.title")}</Text>
        <Text style={styles.body}>
          {config.founderDailyCap === null
            ? t("nudge.more.bodyUnlimited")
            : t("nudge.more.bodyCapped", { pro: config.founderDailyCap })}
        </Text>
      </View>
      <Button
        size="sm"
        label={t("nudge.more.cta")}
        onPress={() => router.push({ pathname: "/founder", params: { from: "profile" } })}
      />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.makanSoft,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.makanText,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.makanText,
  },
}));
