import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { useProOffer } from "@/components/pro/use-pro-offer";
import { Text } from "@/components/ui";

/**
 * The always-visible "Pro" pill beside the date in the Beranda header, for free accounts that can buy. It is the one
 * persistent entry point: the "promo" card sits at the bottom of Beranda and people can hide it, this cannot be missed.
 * It is small on purpose (the header is already full), with a padded hit area. Draws nothing for Pro accounts and
 * wherever /founder could not sell.
 */
export function ProChip() {
  const { t } = useTranslation("billing");
  const { canSell } = useProOffer();
  if (!canSell) return null;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("nudge.chipLabel")}
      onPress={() => router.push({ pathname: "/founder", params: { from: "chip" } })}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      style={styles.chip}
    >
      <Text style={styles.label}>{t("nudge.chip")}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    alignItems: "center",
    justifyContent: "center",
    height: 24,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
  label: {
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    color: theme.colors.primaryForeground,
  },
}));
