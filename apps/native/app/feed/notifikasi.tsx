import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { TFunction } from "@joyorogo/i18n";
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
import { MetaLine } from "@/components/meta-line";
import { openAuthor } from "@/components/feed/post-card";
import { useSessionGate } from "@/lib/use-session-gate";
import { client, orpc } from "@/utils/orpc";
import { errorMessage, timeAgo } from "@/utils/format";
import { KIND_META, type NotificationItem } from "@/src/lib/social";

const KIND_ICON = { kudos: "heart", comment: "chatbubble", reply: "arrow-undo", follow: "person-add" } as const;

/** Row label; tap targets the post when there is one, else the actor profile. */
function rowTitle(item: NotificationItem, t: TFunction<"feed">): string {
  if (item.kind === "follow") return t("notif.text.follow", { name: item.actorName });
  const post =
    item.postKind === "berat"
      ? t("post.weightTitle")
      : (item.postTitle ?? t("notif.deletedPost"));
  return t(`notif.onPost.${item.kind}`, {
    name: item.actorName,
    post,
  });
}

/**
 * Notifikasi feed (kudos / komentar / pengikut). Opening the screen marks
 * everything read optimistically so the Feed bell clears right away.
 */
export default function Notifikasi() {
  const { t } = useTranslation("feed");
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
        <PageHeader title={t("notif.title")} />
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
      <PageHeader title={t("notif.title")} />
      {notif.isPending ? (
        <Skeleton width="100%" height={200} radius={24} />
      ) : notif.isError ? (
        <ErrorState message={errorMessage(notif.error)} onRetry={() => void notif.refetch()} />
      ) : notif.data.items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title={t("notif.empty.title")}
          description={t("notif.empty.body")}
        />
      ) : (
        <ListGroup>
          {notif.data.items.map((item) => {
            const icon = KIND_ICON[item.kind];
            return (
              <ListRow
                key={item.id}
                thumb={<Avatar name={item.actorName} image={item.actorImage} size={32} />}
                icon={icon}
                iconTint={item.readAt === null ? "bakar" : undefined}
                title={rowTitle(item, t)}
                subtitle={
                  <MetaLine
                    items={[
                      item.excerpt ?? null,
                      item.postKind ? KIND_META[item.postKind].label : null,
                      timeAgo(item.createdAt),
                    ]}
                  />
                }
                onPress={() => press(item)}
              />
            );
          })}
        </ListGroup>
      )}
    </Screen>
  );
}
