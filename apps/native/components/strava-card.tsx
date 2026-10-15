import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import Svg, { Path } from "react-native-svg";

import { Button, Card, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

// Strava OAuth in the in-app browser. Strava only accepts a redirect whose
// host matches the app's Authorization Callback Domain (joyorogo.com, shared
// with the web callback), so the custom scheme carries that host. The code is
// exchanged server-side; app/+native-intent.tsx keeps the router off this URL.
export const STRAVA_REDIRECT_URI = "joyorogo://joyorogo.com/strava";

export function StravaCard() {
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
          throw new Error("Strava tidak mengembalikan kode otorisasi.");
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

  let subtitle = "Memuat status Strava…";
  let action: React.ReactNode = null;
  if (statusQuery.isError) {
    subtitle = errorMessage(statusQuery.error);
    action = (
      <Button
        variant="secondary"
        size="sm"
        label="Coba lagi"
        onPress={() => statusQuery.refetch()}
      />
    );
  } else if (statusQuery.data && !statusQuery.data.configured) {
    subtitle = "Segera hadir: aktivitas Strava otomatis masuk ke angka bakar.";
  } else if (statusQuery.data && !statusQuery.data.connected) {
    subtitle = "Hubungkan akun Strava untuk mengimpor aktivitas olahragamu otomatis.";
    action = (
      <Button
        size="sm"
        label="Hubungkan"
        icon="bicycle"
        onPress={() => void connect()}
        loading={busy}
      />
    );
  } else if (statusQuery.data) {
    subtitle = `Terhubung${statusQuery.data.athleteId ? ` (atlet ${statusQuery.data.athleteId})` : ""}.${
      sync.data ? ` ${sync.data.imported} diimpor, ${sync.data.skipped} dilewati.` : ""
    }`;
    action = (
      <View style={styles.connectedActions}>
        <Button
          variant="secondary"
          size="sm"
          label="Sinkronkan"
          onPress={() => sync.mutate({})}
          loading={sync.isPending || busy}
        />
        <Button
          variant="ghost"
          size="sm"
          label="Putuskan"
          destructive
          onPress={() => void disconnect()}
          disabled={busy || sync.isPending}
        />
      </View>
    );
  }

  return (
    <Card>
      <View style={styles.headRow}>
        {/* Strava's app-icon mark: white glyph on Strava orange, per their brand guide. */}
        <View style={styles.logo}>
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path
              fill="#FFFFFF"
              d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"
            />
          </Svg>
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Strava</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      {action}
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {sync.isError ? <Text style={styles.error}>{errorMessage(sync.error)}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#FC4C02",
    alignItems: "center",
    justifyContent: "center",
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
