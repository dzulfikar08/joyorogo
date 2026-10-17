import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, EmptyState, ErrorState, Skeleton, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

import { ChallengeCard } from "./challenge-card";
import { CreateChallengeSheet } from "./create-challenge-sheet";
import { challengeHref, useRefetchOnFocus } from "./shared";

/**
 * "Tantangan" tab of a group: its challenges, join, and the host entry. Only
 * Founders host; a free user tapping "Buat tantangan" lands on the Founder
 * paywall instead, and can still join any challenge for free.
 */
export function ChallengesSection({ groupId }: { groupId: string }) {
  const { t } = useTranslation("challenge");
  const router = useRouter();
  const toast = useToast();
  const list = useQuery(orpc.challenge.list.queryOptions({ input: { groupId } }));
  useRefetchOnFocus(list.refetch);
  const [createOpen, setCreateOpen] = useState(false);

  const join = useMutation(
    orpc.challenge.join.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.challenge.key() }),
      onError: (e) => toast.error(t("toast.joinFailed"), errorMessage(e)),
    }),
  );

  const openFounder = () =>
    router.push({ pathname: "/founder", params: { from: "challenge", next: `/grup/${groupId}` } });

  const canHost = list.data?.canHost ?? false;
  const onCreate = () => (canHost ? setCreateOpen(true) : openFounder());

  return (
    <View style={styles.stack}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("section.title")}</Text>
        <Button size="sm" icon="add" label={t("section.create")} onPress={onCreate} disabled={list.isPending} />
      </View>
      {list.data && !canHost ? (
        <Text style={styles.hint}>{t("section.hostHint")}</Text>
      ) : null}

      {list.isPending ? (
        <>
          <Skeleton width="100%" height={120} radius={24} />
          <Skeleton width="100%" height={120} radius={24} />
        </>
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.challenges.length === 0 ? (
        <EmptyState
          icon="trophy-outline"
          title={t("section.empty.title")}
          description={t("section.empty.body")}
        />
      ) : (
        list.data.challenges.map((challenge) => (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            joining={join.isPending && join.variables?.challengeId === challenge.id}
            onOpen={() => router.push(challengeHref(groupId, challenge.id))}
            onJoin={() => join.mutate({ challengeId: challenge.id })}
          />
        ))
      )}

      <CreateChallengeSheet
        visible={createOpen}
        groupId={groupId}
        onClose={() => setCreateOpen(false)}
        onPaywall={openFounder}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
}));
