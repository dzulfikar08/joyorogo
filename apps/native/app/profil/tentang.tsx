import "@/unistyles";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { serverUrl } from "@/components/billing";
import { OtaUpdateCard } from "@/components/ota-update-card";
import { Group, ProfilPage } from "@/components/profil/page";
import { Button, Card, ListRow, Text } from "@/components/ui";
import { downloadAndInstallApk, installedAppVersion, useApkUpdate } from "@/src/lib/apk-update";
import { errorMessage, fmtMegabytes } from "@/utils/format";

/** Tentang: app version, quick (OTA) updates, Android APK updates, privacy policy. */
export default function Tentang() {
  const { t } = useTranslation("settings");
  return (
    <ProfilPage title={t("hub.rows.about.title")}>
      <TentangContent />
    </ProfilPage>
  );
}

function TentangContent() {
  const { t } = useTranslation("settings");
  // Android only: Profil forces a check on mount so the section reflects the
  // server right now. The app-start check stays silent and throttled.
  const updateState = useApkUpdate(true);
  const updateResult = updateState?.result ?? null;
  const update = updateResult?.state === "available" ? updateResult.update : null;
  const installed = updateState ? installedAppVersion() : null;
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);

  const installUpdate = async () => {
    if (!update || installing) return;
    setInstalling(true);
    setInstallError(null);
    setInstallProgress(0);
    try {
      await downloadAndInstallApk(update, setInstallProgress);
      // The system installer takes over; if installs from this app are not
      // allowed, Android shows its own prompt before returning here.
    } catch (e) {
      setInstallError(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };
  const version = installedAppVersion();

  return (
    <>
      <Group>
        <ListRow
          icon="information-circle"
          iconTint="muted"
          title={t("hubNative.about.version")}
          value={`${version.versionName} (${version.versionCode})`}
        />
      </Group>

      {/* Over-the-air JS updates (expo-updates); renders nothing where OTA is off. */}
      <OtaUpdateCard />

      {/* Android only: update section. useApkUpdate is null on iOS and web. */}
      {updateState && installed ? (
        <Card>
          <Text style={styles.cardTitle}>{t("update.title")}</Text>
          <Text style={styles.note}>
            {t("update.installed", {
              name: installed.versionName,
              code: installed.versionCode,
            })}
          </Text>
          {/* Empat kondisi: memeriksa / terbaru / tersedia / gagal. */}
          {updateState.refreshing || updateResult === null ? (
            <Text style={styles.note}>{t("update.checking")}</Text>
          ) : updateResult.state === "up-to-date" ? (
            <Text style={styles.note}>{t("update.upToDate")}</Text>
          ) : updateResult.state === "error" ? (
            <Text style={styles.error}>{updateResult.message}</Text>
          ) : (
            <>
              <Text style={styles.note}>
                {t("update.available", {
                  name: updateResult.update.versionName,
                  code: updateResult.update.versionCode,
                  size: fmtMegabytes(updateResult.update.size),
                })}
              </Text>
              <Button
                label={
                  installing
                    ? t("update.downloading", { percent: installProgress })
                    : t("update.install")
                }
                onPress={() => void installUpdate()}
                loading={installing}
              />
              {installError ? <Text style={styles.error}>{installError}</Text> : null}
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            label={updateState.refreshing ? t("update.checkingShort") : t("update.check")}
            onPress={() => void updateState.refresh()}
            loading={updateState.refreshing}
            disabled={installing}
          />
        </Card>
      ) : null}

      <Group>
        <ListRow
          icon="shield-checkmark"
          iconTint="makan"
          title={t("privacy.policy")}
          chevron
          onPress={() => void WebBrowser.openBrowserAsync(`${serverUrl()}/privasi`)}
        />
      </Group>
    </>
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
