import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

// Strava OAuth in the in-app browser. The redirect comes back to the app via
// the joyorogo:// scheme, then the code is exchanged server-side.
export function StravaCard() {
  const { theme } = useUnistyles();
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
      const redirectUri = Linking.createURL("strava");
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
    subtitle =
      "Belum dikonfigurasi: kredensial Strava belum diisi di server, jadi akun belum bisa dihubungkan.";
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
        <View style={[styles.iconChip, { backgroundColor: theme.colors.bakarSoft }]}>
          <Text style={[styles.iconGlyph, { color: theme.colors.bakarText }]}>S</Text>
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
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: {
    fontSize: 15,
    fontWeight: "800",
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
