import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { useProOffer } from "@/components/pro/use-pro-offer";
import { Text } from "@/components/ui";
import { showScanAllowance } from "@/src/lib/pro-nudge";
import { orpc } from "@/utils/orpc";

/**
 * "Sisa 2 dari 3 scan gratis hari ini" on the camera, for free accounts that can buy. The count is the server's own
 * (`profile.scanAllowance`, the rule the scan enforces), re-read each time the camera appears. Tapping it opens the
 * paywall: the point where someone is about to spend a scan is the point where Pro is easiest to understand.
 * Draws nothing for Pro, for unlimited accounts, while loading, and against a server that predates the endpoint.
 */
export function ScanAllowance() {
  const { t } = useTranslation("billing");
  const { canSell } = useProOffer();
  const allowance = useQuery({
    ...orpc.profile.scanAllowance.queryOptions(),
    enabled: canSell,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  if (!canSell || !showScanAllowance(allowance.data)) return null;
  const { left, quota } = allowance.data;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("nudge.scanLeftAction")}
      onPress={() =>
        router.push({ pathname: "/founder", params: { from: left === 0 ? "quota" : "scanleft" } })
      }
      hitSlop={8}
      dimTo={0.7}
      style={styles.pill}
    >
      <Text style={styles.text}>
        {left === 0 ? t("nudge.scanLeftNone") : t("nudge.scanLeft", { left, total: quota })}
      </Text>
      <Text style={styles.action}>{t("nudge.scanLeftAction")}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  action: {
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    color: "#FFFFFF",
    textDecorationLine: "underline",
  },
}));
