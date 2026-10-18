import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router } from "expo-router";
import { Pressable, View } from "react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { fmtNumber } from "@joyorogo/i18n";

import { BootLoader, Card, PageHeader, Screen, SectionTitle, Text } from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { JoyoFitCard } from "@/components/workout/joyofit-card";
import { clearLegacyDraft } from "@/lib/workout/legacy-draft";
import { fmtDateMedium, fmtInt } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type WorkoutStatus = Awaited<ReturnType<AppRouterClient["workout"]["status"]>>;

/** Read-only archive of strength sessions logged in JoyoRogo before the move to JoyoFit. */
export default function Latihan() {
  const { t } = useTranslation(["olahraga", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));

  // One-time notice when an unsaved draft from the removed logger is found.
  const [draftNotice, setDraftNotice] = useState(false);
  useEffect(() => {
    void clearLegacyDraft().then((found) => {
      if (found) setDraftNotice(true);
    });
  }, []);

  const [shareTarget, setShareTarget] = useState<
    null | { refId: string; title: string; preview: string }
  >(null);

  const sessionMeta = (date: string, durationMin: number | null, sets: number) =>
    [
      fmtDateMedium(date),
      durationMin != null ? t("latihan.count.minutes", { count: durationMin }) : null,
      t("latihan.count.sets", { count: sets }),
    ]
      .filter(Boolean)
      .join(" · ");
  const recordLine = (pr: WorkoutStatus["prs"][number]): string => {
    const best = pr.bestSet;
    if (!best) return "–";
    const set =
      best.weightKg != null
        ? t("latihan.record.weighted", { reps: best.reps, kg: fmtNumber(best.weightKg, 1) })
        : t("latihan.record.bodyweight", { reps: best.reps });
    return pr.best1RM
      ? t("latihan.record.bestE1rm", { set, kg: fmtInt(pr.best1RM.e1rm ?? 0) })
      : t("latihan.record.best", { set });
  };

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  return (
    <>
      <Stack.Screen options={{ title: t("latihan.title") }} />
      <Screen>
        <PageHeader title={t("latihan.title")} />

        <JoyoFitCard />
        {draftNotice ? (
          <Card>
            <Text style={styles.loadingText}>{t("moved.draftNotice")}</Text>
          </Card>
        ) : null}
        <Text style={styles.loadingText}>{t("moved.archive")}</Text>

        <SectionTitle title={t("latihan.progress.title")} />
        <Card>
          {status.isPending ? (
            <Text style={styles.loadingText}>{t("common:state.loading")}</Text>
          ) : (status.data?.prs.length ?? 0) === 0 ? (
            <Text style={styles.loadingText}>{t("latihan.progress.empty")}</Text>
          ) : (
            <View style={styles.prList}>
              {status.data!.prs.slice(0, 10).map((pr) => (
                <Pressable
                  key={pr.exerciseId}
                  accessibilityRole="button"
                  accessibilityLabel={t("latihan.progress.history", { name: pr.name })}
                  onPress={() => router.push(`/latihan/gerakan?id=${pr.exerciseId}`)}
                  style={({ pressed }) => [styles.prRow, pressed && styles.pressed]}
                >
                  <View style={styles.prText}>
                    <Text style={styles.prName} numberOfLines={1}>
                      {pr.name}
                    </Text>
                    <Text style={styles.prSub} numberOfLines={1}>
                      {recordLine(pr)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={theme.colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        <SectionTitle title={t("latihan.list.history.title")} />
        {history.isPending ? (
          <Card>
            <Text style={styles.loadingText}>{t("common:state.loading")}</Text>
          </Card>
        ) : (history.data?.items.length ?? 0) === 0 ? (
          <Card>
            <Text style={styles.historyEmptyTitle}>{t("latihan.list.history.emptyTitle")}</Text>
            <Text style={styles.loadingText}>{t("latihan.list.history.emptyHint")}</Text>
          </Card>
        ) : (
          <Card style={styles.historyCard}>
            {history.data!.items.map((item) => (
              <View key={item.session.id} style={styles.historyRowWrap}>
                <View style={styles.prText}>
                  <Text style={styles.prName} numberOfLines={1}>
                    {item.session.name}
                  </Text>
                  <Text style={styles.prSub} numberOfLines={1}>
                    {sessionMeta(item.session.date, item.session.durationMin, item.sets.length)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("latihan.list.history.shareFeed", { name: item.session.name })}
                  onPress={() =>
                    setShareTarget({
                      refId: item.session.id,
                      title: item.session.name,
                      preview: sessionMeta(item.session.date, item.session.durationMin, item.sets.length),
                    })
                  }
                  style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
                >
                  <Ionicons name="share-social-outline" size={16} color={theme.colors.foreground} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </Screen>

      <ShareToFeedSheet
        visible={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        title={shareTarget?.title ?? ""}
        preview={shareTarget?.preview ?? ""}
        kind="latihan"
        refId={shareTarget?.refId ?? ""}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  loadingText: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  historyEmptyTitle: { fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  prList: { gap: theme.spacing.md },
  prRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  prText: { flex: 1, gap: 2 },
  prName: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.foreground },
  prSub: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  historyCard: { gap: 0 },
  historyRowWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  shareButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
}));
