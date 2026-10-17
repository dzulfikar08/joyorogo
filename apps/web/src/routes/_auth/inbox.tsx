import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, Hand, MessageSquareText, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { InboxItem } from "@/lib/api-types";
import { Avatar } from "@/components/avatar";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { ListGroup, ListRow, Page, PageHeader } from "@/components/kit/surface";
import { timeAgo } from "@/lib/format";
import { useSession } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const inboxOptions = orpc.group.inbox.queryOptions({ input: { limit: 50 } });

export const Route = createFileRoute("/_auth/inbox")({
  loader: ({ context }) => context.queryClient.ensureQueryData(inboxOptions),
  pendingComponent: InboxSkeleton,
  component: InboxPage,
});

function InboxSkeleton() {
  const { t } = useTranslation("misc");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("inbox.loading")}>
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-44 rounded-full" />
      </div>
      <Skeleton className="h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
    </Page>
  );
}

type MarkReadSnapshot = { restore: () => void };

function InboxPage() {
  const { t } = useTranslation(["misc", "common"]);
  const queryClient = useQueryClient();
  const session = useSession();
  const meId = session.data?.user.id;
  const inbox = useQuery(inboxOptions);

  const markRead = useMutation(
    orpc.group.markRead.mutationOptions({
      onMutate: async (input) => markReadOptimistic(queryClient, input.ids),
      onError: (error, _input, previous) => {
        previous?.restore();
        toast.error(error.message);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: orpc.group.key() });
      },
    }),
  );

  const nudge = useMutation(
    orpc.group.nudge.mutationOptions({
      onMutate: (input) => {
        const items = queryClient.getQueryData<InboxItem[]>(inboxOptions.queryKey) ?? [];
        const target = items.find(
          (it) => it.senderId === input.toUserId && it.groupId === input.groupId,
        );
        return markReadOptimistic(queryClient, target ? [target.id] : []);
      },
      onSuccess: (_data, input) => {
        toast.success(
          input.kind === "poke" ? t("inbox.toast.pokeSent") : t("inbox.toast.noteSent"),
        );
        queryClient.invalidateQueries({ queryKey: orpc.group.key() });
      },
      onError: (error, _input, previous) => {
        previous?.restore();
        toast.error(error.message);
      },
    }),
  );

  const [replyTarget, setReplyTarget] = useState<InboxItem | null>(null);

  if (inbox.isPending) return <InboxSkeleton />;
  if (inbox.error) {
    return <ScreenError message={inbox.error.message} onRetry={() => inbox.refetch()} />;
  }

  const items = inbox.data ?? [];
  const unread = items.filter((item) => item.readAt === null);

  return (
    <Page className="max-w-xl">
      <PageHeader
        title={t("common:nav.title.inbox")}
        subtitle={t("inbox.subtitleWeb")}
        action={
          unread.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate({})}
            >
              <CheckCheck className="size-4" aria-hidden />
              {t("inbox.markAllRead")}
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <div className="mt-1">
          <EmptyHint title={t("inbox.empty.titleWeb")} pose="sleepy">
            {t("inbox.empty.bodyWeb")}
          </EmptyHint>
        </div>
      ) : (
        <ListGroup className="mt-1">
          {items.map((item) => (
            <ListRow
              key={item.id}
              className={item.readAt === null ? "bg-makan-soft/60" : undefined}
              onClick={item.readAt === null ? () => markRead.mutate({ ids: [item.id] }) : undefined}
              icon={<Avatar name={item.senderName} image={item.senderImage ?? null} className="size-10" />}
              title={
                item.kind === "poke"
                  ? t("inbox.item.pokeTitle", { name: item.senderName })
                  : t("inbox.item.noteTitle", { name: item.senderName })
              }
              subtitle={item.message ?? item.groupName}
              value={timeAgo(item.createdAt)}
              trailing={
                item.senderId !== meId && item.senderInGroup ? (
                  <div className="flex shrink-0 gap-1.5">
                    {item.kind === "poke" ? (
                      <ReplyButton
                        label={t("inbox.item.pokeBackAria", { name: item.senderName })}
                        pending={nudge.isPending && nudge.variables?.toUserId === item.senderId}
                        onClick={(event) => {
                          event.stopPropagation();
                          nudge.mutate({
                            groupId: item.groupId,
                            toUserId: item.senderId,
                            kind: "poke",
                          });
                        }}
                      >
                        <Hand className="size-4" aria-hidden />
                        {t("inbox.item.pokeBack")}
                      </ReplyButton>
                    ) : (
                      <ReplyButton
                        label={t("inbox.item.replyAria", { name: item.senderName })}
                        pending={false}
                        onClick={(event) => {
                          event.stopPropagation();
                          setReplyTarget(item);
                        }}
                      >
                        <MessageSquareText className="size-4" aria-hidden />
                        {t("inbox.item.reply")}
                      </ReplyButton>
                    )}
                  </div>
                ) : undefined
              }
            />
          ))}
        </ListGroup>
      )}
      {items.length > 0 && (
        <p className="mt-4 px-2 text-xs text-muted-foreground">
          {t("inbox.footnote")}
        </p>
      )}

      <ReplySheet
        item={replyTarget}
        pending={nudge.isPending}
        onClose={() => setReplyTarget(null)}
        onSend={(message) => {
          if (!replyTarget) return;
          nudge.mutate(
            {
              groupId: replyTarget.groupId,
              toUserId: replyTarget.senderId,
              kind: "note",
              message,
            },
            { onSuccess: () => setReplyTarget(null) },
          );
        }}
      />
    </Page>
  );
}

function markReadOptimistic(
  queryClient: QueryClient,
  ids: string[] | undefined,
): MarkReadSnapshot {
  const previous = queryClient.getQueryData<InboxItem[]>(inboxOptions.queryKey);
  queryClient.setQueryData<InboxItem[]>(inboxOptions.queryKey, (old) =>
    old?.map((item) =>
      (!ids || ids.includes(item.id)) && item.readAt === null
        ? { ...item, readAt: new Date() }
        : item,
    ),
  );
  return {
    restore: () => {
      queryClient.setQueryData(inboxOptions.queryKey, previous);
    },
  };
}

function ReplyButton({
  children,
  label,
  pending,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  pending: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={pending}
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1 rounded-full bg-muted px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

function ReplySheet({
  item,
  pending,
  onClose,
  onSend,
}: {
  item: InboxItem | null;
  pending: boolean;
  onClose: () => void;
  onSend: (message: string) => void;
}) {
  const { t } = useTranslation("misc");
  const [message, setMessage] = useState("");

  if (!item) return null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("inbox.sheet.title", { name: item.senderName })}
      description={t("inbox.sheet.description", { group: item.groupName })}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(message.trim());
        }}
      >
        <div className="relative">
          <textarea
            aria-label={t("inbox.sheet.textAria")}
            rows={3}
            maxLength={140}
            autoFocus
            placeholder={t("inbox.sheet.placeholderWeb")}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          <span className="pointer-events-none absolute right-3 bottom-2 text-[0.6875rem] text-muted-foreground">
            {message.length}/140
          </span>
        </div>
        <Button type="submit" className="w-full" disabled={pending || message.trim() === ""}>
          <Send className="size-4" aria-hidden />
          {pending ? t("inbox.sheet.sending") : t("inbox.sheet.send")}
        </Button>
      </form>
    </Sheet>
  );
}
