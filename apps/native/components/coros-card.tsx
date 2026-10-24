import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Text } from "@/components/ui";
import { errorMessage, timeAgo } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

// COROS redirects to the API host, which 302s to this custom scheme with code and state.
// The code is exchanged server-side; app/+native-intent.tsx keeps the router off this URL.
export const COROS_REDIRECT_URI = "joyorogo://joyorogo.com/coros";

const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

/**
 * `headless` drops the icon and name from the card when the screen already shows them in its title row
 * (the COROS page), leaving the status line.
 */
export function CorosCard({ headless = false }: { headless?: boolean }) {
  const { t } = useTranslation(["coros", "common"]);
  const { theme } = useUnistyles();
  const statusQuery = useQuery(orpc.coros.status.queryOptions());
  const sync = useMutation(
    orpc.coros.sync.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Once per mount: refresh a stale connection when the card opens.
  const autoSynced = useRef(false);
  const data = statusQuery.data;
  useEffect(() => {
    if (autoSynced.current || !data?.configured || !data.connected) return;
    autoSynced.current = true;
    const last = data.lastSyncAt ? new Date(data.lastSyncAt).getTime() : null;
    if (last === null || Date.now() - last > AUTO_SYNC_AFTER_MS) sync.mutate({});
  }, [data, sync]);

  const connect = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const { url } = await client.coros.authorizeUrl({ returnTo: "native" });
      const result = await WebBrowser.openAuthSessionAsync(url, COROS_REDIRECT_URI);
      if (result.type === "success") {
        const params = new URL(result.url).searchParams;
        const error = params.get("error");
        if (error) throw new Error(t("coros:callback.denied", { error }));
        const code = params.get("code");
        const state = params.get("state");
        if (!code || !state) throw new Error(t("coros:error.noCode"));
        await client.coros.exchangeCode({ code, state });
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
      await client.coros.disconnect();
      queryClient.invalidateQueries();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  let subtitle = t("coros:status.checkingCard");
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
  } else if (data && !data.configured) {
    subtitle = t("coros:status.comingSoon");
  } else if (data && !data.connected) {
    subtitle = t("coros:status.connectHint");
    action = (
      <View style={styles.connectedActions}>
        <Button
          label={busy ? t("coros:action.connecting") : t("coros:action.connect")}
          onPress={() => void connect()}
          loading={busy}
        />
      </View>
    );
  } else if (data) {
    const when = data.lastSyncAt
      ? timeAgo(new Date(data.lastSyncAt))
      : t("coros:status.neverSynced");
    subtitle = [
      t("coros:status.connectedSynced", { when }),
      data.importedCount > 0 ? t("coros:status.imported", { count: data.importedCount }) : null,
      data.lastSyncFailed ? t("coros:status.lastFailed") : null,
      sync.data ? t("coros:status.synced", { imported: sync.data.imported, skipped: sync.data.skipped }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    action = (
      <View style={styles.connectedActions}>
        <Button
          variant="secondary"
          size="sm"
          label={sync.isPending ? t("coros:action.syncing") : t("coros:action.sync")}
          onPress={() => sync.mutate({})}
          loading={sync.isPending || busy}
        />
        <Button
          variant="ghost"
          size="sm"
          label={busy ? t("coros:action.disconnecting") : t("coros:action.disconnect")}
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
          <View style={styles.mark}>
            <Ionicons name="watch" size={20} color={theme.colors.mutedForeground} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.title}>{t("coros:title")}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>
      )}
      {action}
      {data?.configured ? (
        <View style={styles.notes}>
          <Text style={styles.subtitle}>{t("coros:notes.text")}</Text>
          <Text style={styles.subtitle}>{t("coros:notes.dedupe")}</Text>
        </View>
      ) : null}
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
  mark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
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
  notes: {
    gap: theme.spacing.sm,
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
