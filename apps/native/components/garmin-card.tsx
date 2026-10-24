import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Input, Text } from "@/components/ui";
import { errorMessage, timeAgo } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

const GARMIN_KEY_URL = "https://connect.garmin.com/app/settings/personalApiToken";
const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

/**
 * `headless` drops the icon and name from the card when the screen already shows them in its title row
 * (the Garmin page), leaving the status line.
 */
export function GarminCard({ headless = false }: { headless?: boolean }) {
  const { t } = useTranslation(["garmin", "common"]);
  const { theme } = useUnistyles();
  const statusQuery = useQuery(orpc.garmin.status.queryOptions());
  const sync = useMutation(
    orpc.garmin.sync.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
  );
  const [apiKey, setApiKey] = useState("");
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
    const key = apiKey.trim();
    if (!key) return;
    setActionError(null);
    setBusy(true);
    try {
      await client.garmin.connect({ apiKey: key });
      setApiKey("");
      queryClient.invalidateQueries();
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
      await client.garmin.disconnect();
      queryClient.invalidateQueries();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  let subtitle = t("garmin:status.checkingCard");
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
    return null;
  } else if (data && !data.connected) {
    subtitle = t("garmin:status.connectHint");
    action = (
      <View style={styles.form}>
        <Text style={styles.subtitle}>{t("garmin:key.steps")}</Text>
        <Button
          variant="ghost"
          size="sm"
          label={t("garmin:key.link")}
          onPress={() => void WebBrowser.openBrowserAsync(GARMIN_KEY_URL)}
          style={styles.link}
        />
        <Input
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={t("garmin:key.placeholder")}
          accessibilityLabel={t("garmin:key.label")}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
        />
        <View style={styles.connectedActions}>
          <Button
            label={busy ? t("garmin:action.connecting") : t("garmin:action.connect")}
            onPress={() => void connect()}
            loading={busy}
            disabled={apiKey.trim().length === 0}
          />
        </View>
      </View>
    );
  } else if (data) {
    const when = data.lastSyncAt
      ? timeAgo(new Date(data.lastSyncAt))
      : t("garmin:status.neverSynced");
    subtitle = [
      t("garmin:status.connectedSynced", { when }),
      data.importedCount > 0 ? t("garmin:status.imported", { count: data.importedCount }) : null,
      data.lastSyncFailed ? t("garmin:status.lastFailed") : null,
      sync.data
        ? t("garmin:status.synced", { imported: sync.data.imported, skipped: sync.data.skipped })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    action = (
      <View style={styles.connectedActions}>
        <Button
          variant="secondary"
          size="sm"
          label={sync.isPending ? t("garmin:action.syncing") : t("garmin:action.sync")}
          onPress={() => sync.mutate({})}
          loading={sync.isPending || busy}
        />
        <Button
          variant="ghost"
          size="sm"
          label={busy ? t("garmin:action.disconnecting") : t("garmin:action.disconnect")}
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
            <Ionicons name="fitness" size={20} color={theme.colors.mutedForeground} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.title}>{t("garmin:title")}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>
      )}
      {action}
      {data?.configured ? (
        <View style={styles.notes}>
          <Text style={styles.subtitle}>{t("garmin:notes.text")}</Text>
          <Text style={styles.subtitle}>{t("garmin:notes.dedupe")}</Text>
          {data.connected ? <Text style={styles.subtitle}>{t("garmin:key.expiry")}</Text> : null}
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
  form: {
    gap: theme.spacing.sm,
  },
  link: {
    alignSelf: "flex-start",
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
