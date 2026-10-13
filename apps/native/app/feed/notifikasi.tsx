import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect } from "react";

import {
  Avatar,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Skeleton,
} from "@/components/ui";
import { openAuthor } from "@/components/feed/post-card";
import { useSessionGate } from "@/lib/use-session-gate";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";
import { KIND_META, type NotificationItem } from "@/src/lib/social";
import { timeAgoId } from "@/src/lib/group";

const KIND_COPY = {
  kudos: { icon: "heart", text: "memberi semangat" },
  comment: { icon: "chatbubble", text: "komentar di" },
  follow: { icon: "person-add", text: "mulai mengikuti kamu" },
} as const;

/** Row label; tap targets the post when there is one, else the actor profile. */
function rowTitle(item: NotificationItem): string {
  if (item.kind === "follow") return `${item.actorName} mulai mengikuti kamu`;
  const target = item.postTitle ?? "sebuah post yang sudah dihapus";
  return `${item.actorName} ${KIND_COPY[item.kind].text} "${target}"`;
}

/**
 * Notifikasi feed (kudos / komentar / pengikut). Opening the screen marks
 * everything read optimistically so the Feed bell clears right away.
 */
export default function Notifikasi() {
  const gate = useSessionGate();
  const queryClient = useQueryClient();

  const notif = useQuery(orpc.social.notifications.queryOptions({ input: { limit: 30 } }));

  const markRead = useMutation({
    mutationFn: () => client.social.notificationsMarkRead({}),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.social.notificationsUnreadCount.queryOptions().queryKey,
      });
    },
  });

  useEffect(() => {
    // Mark all read once the first page lands; the badge clears without a
    // visible flash because the count query refetches after.
    if (notif.data && notif.data.items.some((item) => item.readAt === null)) {
      markRead.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notif.data]);

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Notifikasi" />
        <Skeleton width="100%" height={200} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const press = (item: NotificationItem) => {
    if (item.postId) {
      router.push(`/feed/${item.postId}`);
    } else {
      openAuthor(item.actorHandle);
    }
  };

  return (
    <Screen>
      <PageHeader title="Notifikasi" caption="Semangat, komentar, dan pengikut baru." />
      {notif.isPending ? (
        <Skeleton width="100%" height={200} radius={24} />
      ) : notif.isError ? (
        <ErrorState message={errorMessage(notif.error)} onRetry={() => void notif.refetch()} />
      ) : notif.data.items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="Belum ada notifikasi"
          description="Saat ada yang memberi semangat atau mengikuti kamu, kabarnya muncul di sini."
        />
      ) : (
        <ListGroup>
          {notif.data.items.map((item) => {
            const copy = KIND_COPY[item.kind];
            return (
              <ListRow
                key={item.id}
                thumb={<Avatar name={item.actorName} image={item.actorImage} size={32} />}
                icon={copy.icon}
                iconTint={item.readAt === null ? "bakar" : undefined}
                title={rowTitle(item)}
                subtitle={[
                  item.excerpt ?? null,
                  item.postKind ? KIND_META[item.postKind].label : null,
                  timeAgoId(item.createdAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onPress={() => press(item)}
              />
            );
          })}
        </ListGroup>
      )}
    </Screen>
  );
}
