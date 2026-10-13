import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  EmptyState,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Skeleton,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { timeAgoId } from "@/src/lib/group";
import { orpc, queryClient } from "@/utils/orpc";

/** Kotak Masuk: pokes and notes from groupmates; opening a row marks it read. */
export default function Inbox() {
  const gate = useSessionGate();
  const inbox = useQuery(orpc.group.inbox.queryOptions({ input: { limit: 50 } }));

  const markRead = useMutation(
    orpc.group.markRead.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.group.key() }),
    }),
  );

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Kotak Masuk" />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={64} radius={20} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const items = inbox.data ?? [];

  return (
    <Screen>
      <PageHeader title="Kotak Masuk" caption="Colek dan catatan dari teman grupmu." />

      {inbox.isPending ? (
        <Skeleton width="100%" height={220} radius={24} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="Belum ada apa-apa"
          description="Colek dan catatan dari teman grup akan muncul di sini."
        />
      ) : (
        <ListGroup>
          {items.map((item) => {
            const unread = item.readAt === null;
            return (
              <ListRow
                key={item.id}
                icon={item.kind === "poke" ? "hand-left" : "pencil"}
                iconTint={item.kind === "poke" ? "bakar" : "tidur"}
                title={item.senderName}
                subtitle={`${item.kind === "poke" ? "mencolek kamu" : (item.message ?? "mengirim catatan")} • ${item.groupName}`}
                value={timeAgoId(item.createdAt)}
                onPress={unread ? () => markRead.mutate({ ids: [item.id] }) : undefined}
                right={
                  unread ? (
                    <View style={styles.dot} accessibilityLabel="Belum dibaca" />
                  ) : undefined
                }
              />
            );
          })}
        </ListGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
}));
