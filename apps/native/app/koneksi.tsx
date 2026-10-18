import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { isMcpDataScope, mcpScopeKey } from "@joyorogo/api/lib/mcp-scopes";

import { useAppConfig } from "@/components/billing";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  PageHeader,
  Screen,
  SectionTitle,
  Skeleton,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtDateMedium, timeAgo } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

const GUIDE_URL = "https://joyorogo.com/panduan/ai";
const infoOptions = orpc.mcpConnection.info.queryOptions();
const listOptions = orpc.mcpConnection.list.queryOptions();
const activityOptions = orpc.mcpConnection.activity.queryOptions({ input: { limit: 20 } });

/** The connection being confirmed for revoke. */
type RevokeTarget = { clientId: string; name: string };

/**
 * Koneksi AI: the Claude / ChatGPT connector address, the apps that may read
 * the user's data (revocable), and the recent read activity.
 */
export default function Koneksi() {
  const { t } = useTranslation("koneksi");
  const gate = useSessionGate();
  const toast = useToast();
  const config = useAppConfig();
  const info = useQuery(infoOptions);
  const list = useQuery(listOptions);
  const activity = useQuery(activityOptions);
  const [target, setTarget] = useState<RevokeTarget | null>(null);
  const revoke = useMutation({
    mutationFn: (clientId: string) => client.mcpConnection.revoke({ clientId }),
    onSuccess: async () => {
      const name = target?.name ?? "";
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: orpc.mcpConnection.key() });
      toast.success(t("revoke.done", { name }));
    },
    onError: (e) => toast.error(t("revoke.error"), errorMessage(e)),
  });

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title={t("title")} />
        <Skeleton width="100%" height={120} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const url = info.data?.url;
  const unlocked = info.data?.unlocked ?? true;
  const canBuy = config.data?.paywall === true;
  const refetchAll = () =>
    Promise.all([info.refetch(), list.refetch(), activity.refetch()]);

  const copy = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    toast.success(t("connector.copied"));
  };

  const connections = list.data ?? [];

  return (
    <Screen
      refreshing={list.isRefetching || info.isRefetching || activity.isRefetching}
      onRefresh={() => void refetchAll()}
    >
      <PageHeader title={t("title")} caption={t("subtitle")} />

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t("connector.title")}</Text>
        <Text style={styles.note}>{t("connector.hint")}</Text>
        {url ? (
          <Text style={styles.url} selectable>
            {url}
          </Text>
        ) : (
          <Skeleton width="100%" height={24} radius={8} />
        )}
        <View style={styles.row}>
          <Button size="sm" variant="secondary" icon="copy" label={t("connector.copy")} onPress={() => void copy()} disabled={!url} />
          <Button
            size="sm"
            variant="ghost"
            icon="book"
            label={t("connector.guide")}
            onPress={() => void Linking.openURL(GUIDE_URL)}
          />
        </View>
      </Card>

      {!unlocked ? (
        <Card style={styles.card}>
          <Text style={styles.note}>{t("pro.required")}</Text>
          {canBuy ? (
            <Button
              size="sm"
              variant="secondary"
              label={t("pro.cta")}
              onPress={() =>
                router.push({
                  pathname: "/founder",
                  params: { from: "profile", next: "/koneksi" },
                })
              }
            />
          ) : null}
        </Card>
      ) : null}

      <SectionTitle title={t("list.title")} />
      {list.isPending ? (
        <Skeleton width="100%" height={140} radius={24} />
      ) : list.isError ? (
        <ErrorState message={t("list.error")} onRetry={() => void list.refetch()} />
      ) : connections.length === 0 ? (
        <EmptyState icon="link" title={t("list.empty")} description={t("list.emptyHint")} />
      ) : (
        connections.map((c) => (
          <Card key={c.clientId} style={styles.card}>
            <Text style={styles.cardTitle}>{c.name}</Text>
            {c.redirectHosts.length > 0 ? (
              <Text style={styles.meta}>{t("list.via", { hosts: c.redirectHosts.join(", ") })}</Text>
            ) : null}
            <Text style={styles.meta}>
              {t("list.connectedAt", { date: fmtDateMedium(jakartaToday(new Date(c.connectedAt))) })}
            </Text>
            <Text style={styles.meta}>
              {c.lastUsedAt === null
                ? t("list.neverUsed")
                : t("list.lastUsed", { when: timeAgo(new Date(c.lastUsedAt)) })}
            </Text>
            <Text style={styles.meta}>{t("list.calls", { count: c.calls30d })}</Text>
            <Text style={styles.allows}>{t("list.allows")}</Text>
            {c.scopes.filter(isMcpDataScope).map((s) => (
              <Text key={s} style={styles.scope}>
                {t(`scope.${mcpScopeKey(s)}.label` as never)}
              </Text>
            ))}
            <Button
              size="sm"
              variant="secondary"
              destructive
              label={t("revoke.action")}
              onPress={() => setTarget(c)}
            />
          </Card>
        ))
      )}

      <SectionTitle title={t("activity.title")} />
      <Text style={styles.note}>{t("activity.hint")}</Text>
      {activity.isPending ? (
        <Skeleton width="100%" height={120} radius={24} />
      ) : activity.isError ? (
        <ErrorState message={t("list.error")} onRetry={() => void activity.refetch()} />
      ) : (activity.data ?? []).length === 0 ? (
        <Text style={styles.note}>{t("activity.empty")}</Text>
      ) : (
        <View style={styles.activityList}>
          {(activity.data ?? []).map((a) => (
            <ListRow
              key={a.id}
              title={t(`activity.tool.${a.tool}` as never, { defaultValue: a.tool })}
              subtitle={`${a.clientName ?? ""}${a.clientName ? " · " : ""}${timeAgo(new Date(a.createdAt))}${a.args ? ` · ${a.args}` : ""}`}
              value={t(`activity.outcome.${a.outcome}` as never)}
            />
          ))}
        </View>
      )}

      <ConfirmSheet
        visible={target !== null}
        onClose={() => setTarget(null)}
        title={t("revoke.title", { name: target?.name ?? "" })}
        message={t("revoke.body", { name: target?.name ?? "" })}
        confirmLabel={t("revoke.confirm")}
        cancelLabel={t("revoke.cancel")}
        loading={revoke.isPending}
        onConfirm={() => target && revoke.mutate(target.clientId)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.sm },
  cardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  url: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.muted,
    borderRadius: 12,
    padding: theme.spacing.md,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  allows: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  scope: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  activityList: {
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: theme.colors.card,
  },
}));
