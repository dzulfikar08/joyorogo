import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { Button, Card, Text } from "@/components/ui";
import { OTA_ENABLED, useOtaUpdate } from "@/src/lib/use-ota-update";
import { fmtDateMedium } from "@/utils/format";

/**
 * Profil "Pembaruan" card for over-the-air JS updates (expo-updates, docs/ota.md): which bundle runs,
 * whether a newer one is downloading or waiting for a restart, and a manual check. Renders nothing in
 * dev clients, Expo Go and on the web, where OTA is off.
 */
export function OtaUpdateCard() {
  const { t } = useTranslation("settings");
  const ota = useOtaUpdate();
  if (!OTA_ENABLED) return null;

  const busy = ota.phase === "checking" || ota.phase === "downloading";
  const running =
    ota.source === "update" && ota.updateId
      ? t("update.ota.running", {
          id: ota.updateId.slice(0, 8),
          date: ota.createdAt ? fmtDateMedium(ota.createdAt.toISOString().slice(0, 10)) : "-",
        })
      : t(ota.source === "emergency" ? "update.ota.emergency" : "update.ota.embedded");

  return (
    <Card>
      <Text style={styles.cardTitle}>{t("update.ota.title")}</Text>
      <Text style={styles.note}>{running}</Text>
      {ota.channel && ota.runtimeVersion ? (
        <Text style={styles.note}>
          {t("update.ota.detail", { channel: ota.channel, runtime: ota.runtimeVersion.slice(0, 8) })}
        </Text>
      ) : null}
      {ota.phase === "error" ? (
        <Text style={styles.error}>{t("update.ota.error")}</Text>
      ) : (
        <Text style={styles.note}>
          {ota.phase === "checking"
            ? t("update.ota.checking")
            : ota.phase === "downloading"
              ? ota.percent === null
                ? t("update.ota.downloadingPlain")
                : t("update.ota.downloading", { percent: ota.percent })
              : ota.phase === "ready"
                ? t("update.ota.ready")
                : t("update.ota.upToDate")}
        </Text>
      )}
      {ota.phase === "ready" ? (
        <Button label={t("update.ota.restart")} onPress={() => void ota.restart()} />
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        label={busy ? t("update.checkingShort") : t("update.check")}
        onPress={() => void ota.check()}
        loading={busy}
        disabled={busy}
      />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
