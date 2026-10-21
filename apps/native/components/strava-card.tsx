import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { BrandMark } from "@/components/brand-mark";
import { Button, Card, Text } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { StravaRetentionNote } from "@/components/strava-retention-notice";
import { errorMessage } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

// Strava OAuth in the in-app browser. Strava only accepts a redirect whose
// host matches the app's Authorization Callback Domain (joyorogo.com, shared
// with the web callback), so the custom scheme carries that host. The code is
// exchanged server-side; app/+native-intent.tsx keeps the router off this URL.
export const STRAVA_REDIRECT_URI = "joyorogo://joyorogo.com/strava";

/**
 * `headless` drops the mark and name from the card when the screen already shows them in its title row
 * (the Strava page), leaving the status line.
 */
export function StravaCard({ compact = false, headless = false }: { compact?: boolean; headless?: boolean }) {
  const { t } = useTranslation(["settings", "common", "olahraga"]);
  const statusQuery = useQuery(orpc.strava.status.queryOptions());
  const sync = useMutation(
    orpc.strava.sync.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const connect = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const redirectUri = STRAVA_REDIRECT_URI;
      const { url } = await client.strava.authorizeUrl({ redirectUri });
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type === "success") {
        const code = new URL(result.url).searchParams.get("code");
        if (!code) {
          throw new Error(t("strava.error.noCode"));
        }
        await client.strava.exchangeCode({ code, redirectUri });
        queryClient.invalidateQueries();
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await client.strava.disconnect();
      queryClient.invalidateQueries();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  let subtitle = t("strava.status.loadingNative");
  let action: React.ReactNode = null;
  if (statusQuery.isError) {
    subtitle = errorMessage(statusQuery.error);
    action = (
      <Button
        variant="secondary"
        size="sm"
        label={t("common:actions.retry")}
        onPress={() => statusQuery.refetch()}
      />
    );
  } else if (statusQuery.data && !statusQuery.data.configured) {
    subtitle = t("strava.status.comingSoon");
  } else if (statusQuery.data && !statusQuery.data.connected) {
    subtitle = t("strava.status.connectHintNative");
    action = (
      // Official "Connect with Strava" artwork, unmodified (docs/brand-marks.md); the 2x file is
      // picked automatically. A busy request dims it and ignores taps instead of swapping the art.
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("hubNative.strava.connectLabel")}
        disabled={busy}
        onPress={() => void connect()}
        style={[styles.connectButton, busy && styles.connectBusy]}
      >
        <Image
          source={require("@/assets/images/brand/connect-with-strava.png")}
          style={styles.connectImage}
          accessibilityIgnoresInvertColors
        />
      </Pressable>
    );
  } else if (statusQuery.data) {
    const athleteId = statusQuery.data.athleteId;
    const connectedLine = athleteId
      ? t("strava.status.connectedAthlete", { id: athleteId })
      : t("strava.status.connected");
    subtitle = sync.data
      ? `${connectedLine} ${t("strava.status.synced", {
          imported: sync.data.imported,
          skipped: sync.data.skipped,
        })}`
      : connectedLine;
    action = (
      <View style={styles.connectedActions}>
        <Button
          variant="secondary"
          size="sm"
          label={t("strava.action.syncNative")}
          onPress={() => sync.mutate({})}
          loading={sync.isPending || busy}
        />
        <Button
          variant="ghost"
          size="sm"
          label={t("strava.action.disconnect")}
          destructive
          onPress={() => void disconnect()}
          disabled={busy || sync.isPending}
        />
      </View>
    );
  }

  return (
    <Card>
      {headless ? (
        <Text style={styles.subtitle}>{subtitle}</Text>
      ) : (
        <View style={styles.headRow}>
          <BrandMark brand="strava" />
          <View style={styles.headText}>
            <Text style={styles.title}>Strava</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>
      )}
      {action}
      {statusQuery.data?.configured ? (
        compact ? (
          <Disclosure plain title={t("olahraga:strava.notesTitle")}>
            <StravaRetentionNote />
          </Disclosure>
        ) : (
          <StravaRetentionNote />
        )
      ) : null}
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {sync.isError ? (
        <Text style={styles.error}>{errorMessage(sync.error)}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  connectButton: {
    alignSelf: "flex-start",
  },
  connectBusy: {
    opacity: 0.5,
  },
  connectImage: {
    width: 237,
    height: 48,
  },
  headText: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  connectedActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
