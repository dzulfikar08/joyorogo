import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { GOALS } from "@joyorogo/api/lib/challenge";

import { StatusChip } from "@/components/challenge/challenge-card";
import { Disclosure } from "@/components/disclosure";
import { LeaderboardRow } from "@/components/challenge/leaderboard-row";
import { fmtGoalValue, useRefetchOnFocus } from "@/components/challenge/shared";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { useToast } from "@/components/toast";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Screen,
  SectionTitle,
  Skeleton,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtDateMedium } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

export default function ChallengeDetailScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["challenge", "common"]);
  const gate = useSessionGate();
  const router = useRouter();
  const toast = useToast();
  const { challengeId: rawId } = useLocalSearchParams<{ id: string; challengeId: string }>();
  const challengeId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");

  const detail = useQuery(orpc.challenge.detail.queryOptions({ input: { challengeId } }));
  useRefetchOnFocus(detail.refetch);
  const [confirm, setConfirm] = useState<"leave" | "remove" | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.challenge.key() });

  const join = useMutation(
    orpc.challenge.join.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(t("toast.joinFailed"), errorMessage(e)),
    }),
  );
  const leave = useMutation(
    orpc.challenge.leave.mutationOptions({
      onSuccess: async () => {
        setConfirm(null);
        await invalidate();
      },
      onError: (e) => toast.error(t("toast.leaveFailed"), errorMessage(e)),
    }),
  );
  const remove = useMutation(
    orpc.challenge.remove.mutationOptions({
      onSuccess: async () => {
        setConfirm(null);
        await invalidate();
        router.back();
      },
      onError: (e) => toast.error(t("toast.removeFailed"), errorMessage(e)),
    }),
  );

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title={t("detail.title")} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={140} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (detail.isPending) {
    return (
      <Screen>
        <PageHeader title={t("detail.title")} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={140} radius={24} />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen>
        <PageHeader title={t("detail.title")} />
        <ErrorState message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />
      </Screen>
    );
  }

  const { challenge: c, me, leaderboard, share } = detail.data;
  const spec = GOALS[c.goal];
  const personalTarget = spec.targetKind === "personal" && me.target !== null ? me.target : null;
  const countedFrom = me.fromDate !== null && me.fromDate > c.startDate ? me.fromDate : null;
  const foodGoal = c.goal === "protein" || c.goal === "calories";

  return (
      <Screen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
        <PageHeader
          title={c.title}
          caption={`${c.groupName}${c.creatorName ? ` • ${t("detail.createdBy", { name: c.creatorName })}` : ""}`}
        />

        <Card>
          <View style={styles.chipRow}>
            <StatusChip challenge={c} />
          </View>
          <Text style={styles.rule}>{c.rule}</Text>
          <Text style={styles.dates}>
            {t("detail.dateRange", {
              from: fmtDateMedium(c.startDate),
              to: fmtDateMedium(c.endDate),
            })}{" "}
            • {t("create.duration.days", { count: c.durationDays })}
          </Text>
          {personalTarget !== null ? (
            <Text style={styles.personal}>
              {t("detail.yourTarget", { target: fmtGoalValue(personalTarget), unit: c.unit })}
            </Text>
          ) : null}
          {countedFrom !== null ? (
            <Text style={styles.muted}>
              {t("detail.countedFrom", { date: fmtDateMedium(countedFrom) })}
            </Text>
          ) : null}
          <Disclosure plain title={t("detail.howItWorks.title")}>
            <Text style={styles.muted}>{c.source}</Text>
            <Text style={styles.muted}>{t("detail.howItWorks.basis")}</Text>
            {foodGoal ? <Text style={styles.muted}>{t("detail.howItWorks.foodPrivacy")}</Text> : null}
          </Disclosure>
        </Card>

        {me.deviceHint ? (
          <View style={[styles.banner, { backgroundColor: theme.colors.tidurSoft }]}>
            <Ionicons name="information-circle" size={20} color={theme.colors.tidurText} />
            <Text style={[styles.bannerText, { color: theme.colors.tidurText }]}>
              {me.deviceHint}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {detail.data.canJoin ? (
            <Button
              icon="enter-outline"
              label={t("detail.join")}
              loading={join.isPending}
              onPress={() => join.mutate({ challengeId })}
            />
          ) : null}
          {share ? (
            <ShareStoryButton
              story={{ kind: "challenge", ...share }}
              label={t("detail.share")}
              variant="secondary"
              disabled={c.status === "upcoming"}
            />
          ) : null}
          {me.joined && c.status !== "ended" ? (
            <Button
              variant="ghost"
              destructive
              size="sm"
              label={t("detail.leaveFull")}
              onPress={() => setConfirm("leave")}
            />
          ) : null}
        </View>

        <SectionTitle title={t("board.title")} />
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
            <Text style={styles.legendText}>{t("board.legend.hit")}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.bakar }]} />
            <Text style={styles.legendText}>{t("board.legend.miss")}</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { borderWidth: 1.5, borderColor: theme.colors.mutedForeground },
              ]}
            />
            <Text style={styles.legendText}>{t("board.legend.pending")}</Text>
          </View>
        </View>

        {leaderboard.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title={t("board.empty.title")}
            description={t("board.empty.body")}
          />
        ) : (
          <View style={styles.rows}>
            {leaderboard.map((member) => (
              <LeaderboardRow key={member.userId} member={member} unit={c.unit} />
            ))}
          </View>
        )}

        {c.canDelete ? (
          <Button
            variant="ghost"
            destructive
            size="sm"
            icon="trash-outline"
            label={t("detail.remove")}
            onPress={() => setConfirm("remove")}
          />
        ) : null}

        <ConfirmSheet
          visible={confirm !== null}
          onClose={() => setConfirm(null)}
          title={
            confirm === "remove" ? t("detail.confirm.removeTitle") : t("detail.confirm.leaveTitle")
          }
          message={
            confirm === "remove"
              ? t("detail.confirm.removeMessage")
              : t("detail.confirm.leaveMessage")
          }
          confirmLabel={
            confirm === "remove" ? t("common:actions.delete") : t("detail.leave")
          }
          loading={leave.isPending || remove.isPending}
          onConfirm={() => {
            if (confirm === "remove") remove.mutate({ challengeId });
            else if (confirm === "leave") leave.mutate({ challengeId });
          }}
        />
      </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: "row",
    marginBottom: theme.spacing.md,
  },
  rule: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
  },
  muted: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 17,
    marginTop: theme.spacing.xs,
  },
  dates: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    marginTop: theme.spacing.md,
  },
  personal: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
    marginTop: theme.spacing.md,
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
  },
  bannerText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  actions: {
    gap: theme.spacing.sm,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  rows: {
    gap: theme.spacing.md,
  },
}));
