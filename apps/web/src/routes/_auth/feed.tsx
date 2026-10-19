import type { TFunction } from "@joyorogo/i18n";
import { FEED_TIP_EVERY, TIPS, feedTipIndex, type Tip } from "@joyorogo/api/lib/tips";
import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  CheckCheck,
  Hand,
  Heart,
  MessageSquareText,
  PlusCircle,
  Reply,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/avatar";
import { FeedComposerSheet } from "@/components/feed/composer";
import { HandlePrompt } from "@/components/feed/handle-prompt";
import { PostCard } from "@/components/feed/post-card";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { ListRow, Page, PageHeader, Segmented } from "@/components/kit/surface";
import { MetaLine } from "@/components/meta-line";
import { TipCard } from "@/components/tips/tip-card";
import { useSession } from "@/lib/auth-client";
import type { FeedPost, SocialNotificationItem } from "@/lib/api-types";
import { timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/feed")({
  component: FeedPage,
});

type FeedTab = "mengikuti" | "jelajah" | "tips";

function tabOptions(t: TFunction<"feed">) {
  return [
    { value: "mengikuti" as const, label: t("tab.following") },
    { value: "jelajah" as const, label: t("tab.explore") },
    { value: "tips" as const, label: t("tab.tips") },
  ];
}

type FeedRow = { kind: "post"; post: FeedPost } | { kind: "tip"; tip: Tip };

/** Satu kartu tips tiap FEED_TIP_EVERY postingan, rotasinya ganti tiap hari. */
function withTipCards(posts: FeedPost[]): FeedRow[] {
  const rows: FeedRow[] = [];
  let tipNo = 0;
  let postNo = 0;
  for (const post of posts) {
    rows.push({ kind: "post", post });
    postNo++;
    if (postNo % FEED_TIP_EVERY === 0) {
      rows.push({ kind: "tip", tip: TIPS[feedTipIndex(tipNo++)]! });
    }
  }
  return rows;
}

function FeedSkeleton() {
  const { t } = useTranslation("feed");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("list.loading")}>
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-32 rounded-full" />
      </div>
      <Skeleton className="h-11 rounded-full" />
      <Skeleton className="mt-3 h-40 rounded-3xl" />
      <Skeleton className="mt-3 h-40 rounded-3xl" />
    </Page>
  );
}

function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="absolute -top-1 right-1 grid min-w-[1.05rem] place-items-center rounded-full bg-destructive px-1 text-[0.5625rem] leading-[0.95rem] font-bold text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

const NOTIF_ICON = {
  kudos: Heart,
  comment: MessageSquareText,
  reply: Reply,
  follow: UserPlus,
} as const;

function notifText(t: TFunction<"feed">, item: SocialNotificationItem): string {
  if (item.kind === "kudos") return t("notif.text.kudos", { name: item.actorName });
  if (item.kind === "follow") return t("notif.text.follow", { name: item.actorName });
  if (item.kind === "reply") {
    return item.excerpt
      ? t("notif.text.replyExcerpt", { name: item.actorName, excerpt: item.excerpt })
      : t("notif.text.reply", { name: item.actorName });
  }
  return item.excerpt
    ? t("notif.text.commentExcerpt", { name: item.actorName, excerpt: item.excerpt })
    : t("notif.text.comment", { name: item.actorName });
}

function NotificationsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("feed");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notifications = useQuery({
    ...orpc.social.notifications.queryOptions({ input: { limit: 50 } }),
    enabled: open,
  });
  const markRead = useMutation(
    orpc.social.notificationsMarkRead.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.social.key() }),
      onError: (error) => toast.error(error.message),
    }),
  );

  const items = notifications.data?.items ?? [];
  const unread = items.filter((item) => item.readAt === null);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("notif.title")}
    >
      <div className="space-y-3">
        {unread.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate({})}
            >
              <CheckCheck className="size-4" aria-hidden />
              {t("notif.markRead")}
            </Button>
          </div>
        )}
        {notifications.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
          </div>
        ) : notifications.error ? (
          <ScreenError
            message={notifications.error.message}
            onRetry={() => notifications.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyHint title={t("notif.empty.title")} pose="sleepy">
            {t("notif.empty.body")}
          </EmptyHint>
        ) : (
          <ul className="space-y-2" aria-label={t("notif.list")}>
            {items.map((item) => {
              const Icon = NOTIF_ICON[item.kind];
              return (
                <ListRow
                  key={item.id}
                  className={item.readAt === null ? "bg-makan-soft/60" : undefined}
                  onClick={
                    item.postId
                      ? () => {
                          onOpenChange(false);
                          void navigate({ to: "/p/$postId", params: { postId: item.postId! } });
                        }
                      : item.readAt === null
                        ? () => markRead.mutate({ ids: [item.id] })
                        : undefined
                  }
                  icon={
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon className="size-4 text-foreground" aria-hidden />
                    </span>
                  }
                  title={notifText(t, item)}
                  subtitle={
                    <MetaLine
                      items={[item.postTitle, timeAgo(item.createdAt)]}
                      className="tabular-nums"
                    />
                  }
                  trailing={
                    <Avatar name={item.actorName} image={item.actorImage} className="size-8" />
                  }
                />
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function FeedPage() {
  const { t } = useTranslation(["feed", "common"]);
  const session = useSession();
  const [tab, setTab] = useState<FeedTab>("mengikuti");
  const [notifOpen, setNotifOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const unread = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const feed = useInfiniteQuery(
    orpc.social.feed.infiniteOptions({
      input: (pageParam: number | undefined) => ({
        // Tab Tips tidak pernah menembak server; nilainya cuma buat tipe.
        tab: tab === "tips" ? ("jelajah" as const) : tab,
        limit: 10,
        cursor: pageParam,
      }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      // Tab Tips murni konten statis lokal; tidak ada feed yang perlu dimuat.
      enabled: tab !== "tips",
    }),
  );

  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const myId = session.data?.user.id ?? null;
  const unreadCount = unread.data?.count ?? 0;

  return (
    <Page className="max-w-xl">
      <PageHeader
        title={t("common:nav.feed")}
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("header.compose")}
              onClick={() => setComposerOpen(true)}
            >
              <PlusCircle className="size-5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                unreadCount > 0
                  ? t("header.notificationsUnread", { count: unreadCount })
                  : t("header.notifications")
              }
              onClick={() => setNotifOpen(true)}
              className="relative"
            >
              <Bell className="size-5" aria-hidden />
              {unreadCount > 0 && <UnreadBadge count={unreadCount} />}
            </Button>
          </div>
        }
      />

      <FeedComposerSheet open={composerOpen} onOpenChange={setComposerOpen} />

      <HandlePrompt className="mb-3" />

      <Segmented<FeedTab>
        label={t("tab.label")}
        value={tab}
        onChange={setTab}
        options={tabOptions(t)}
      />

      <div className="mt-3 space-y-3">
        {tab === "tips" ? (
          TIPS.map((tip) => <TipCard key={tip.slug} tip={tip} />)
        ) : feed.isPending ? (
          <FeedSkeleton />
        ) : feed.error ? (
          <ScreenError message={feed.error.message} onRetry={() => feed.refetch()} />
        ) : posts.length === 0 ? (
          <EmptyHint
            pose={tab === "mengikuti" ? "peek" : "relax"}
            title={
              tab === "mengikuti"
                ? t("list.empty.following.title")
                : t("list.empty.explore.title")
            }
          >
            {tab === "mengikuti" ? t("list.empty.following.body") : t("list.empty.explore.body")}
          </EmptyHint>
        ) : (
          withTipCards(posts).map((row, index) =>
            row.kind === "tip" ? (
              <TipCard key={`tip-${row.tip.slug}`} tip={row.tip} />
            ) : (
              <PostCard
                key={row.post.id}
                post={row.post}
                isOwn={row.post.author.id === myId}
                index={index}
              />
            ),
          )
        )}

        {tab !== "tips" && feed.hasNextPage && posts.length > 0 && (
          <Button
            variant="secondary"
            className="w-full"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? t("common:state.loading") : t("list.more")}
          </Button>
        )}
      </div>

      <NotificationsSheet open={notifOpen} onOpenChange={setNotifOpen} />
    </Page>
  );
}
