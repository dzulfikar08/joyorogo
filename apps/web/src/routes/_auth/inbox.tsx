import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, Hand, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

import { EmptyHint, ScreenError } from "@/components/screen-state";
import { ListGroup, ListRow, Page, PageHeader } from "@/components/kit/surface";
import { timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const inboxOptions = orpc.group.inbox.queryOptions({ input: { limit: 50 } });

export const Route = createFileRoute("/_auth/inbox")({
  loader: ({ context }) => context.queryClient.ensureQueryData(inboxOptions),
  pendingComponent: InboxSkeleton,
  component: InboxPage,
});

function InboxSkeleton() {
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label="Memuat kotak masuk">
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-44 rounded-full" />
      </div>
      <Skeleton className="h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
    </Page>
  );
}

function InboxPage() {
  const queryClient = useQueryClient();
  const inbox = useQuery(inboxOptions);

  const markRead = useMutation(
    orpc.group.markRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.group.key() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (inbox.isPending) return <InboxSkeleton />;
  if (inbox.error) {
    return <ScreenError message={inbox.error.message} onRetry={() => inbox.refetch()} />;
  }

  const items = inbox.data ?? [];
  const unread = items.filter((item) => item.readAt === null);

  return (
    <Page className="max-w-xl">
      <PageHeader
        title="Kotak Masuk"
        subtitle="Colek dan catatan dari teman satu grup."
        action={
          unread.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate({})}
            >
              <CheckCheck className="size-4" aria-hidden />
              Tandai dibaca
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <div className="mt-1">
          <EmptyHint title="Masih sepi">
            Colek dan catatan dari anggota grup akan muncul di sini.
          </EmptyHint>
        </div>
      ) : (
        <ListGroup className="mt-1">
          {items.map((item) => (
            <ListRow
              key={item.id}
              className={item.readAt === null ? "bg-makan-soft/60" : undefined}
              icon={
                item.kind === "poke" ? (
                  <Hand className="size-5 text-bakar-ink" aria-hidden />
                ) : (
                  <MessageSquareText className="size-5 text-makan-ink" aria-hidden />
                )
              }
              title={
                item.kind === "poke"
                  ? `${item.senderName} mencolek kamu`
                  : `Catatan dari ${item.senderName}`
              }
              subtitle={item.message ?? item.groupName}
              value={timeAgo(item.createdAt)}
              trailing={
                item.readAt === null ? (
                  <button
                    type="button"
                    aria-label="Tandai sudah dibaca"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate({ ids: [item.id] })}
                    className="size-3 shrink-0 rounded-full bg-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  />
                ) : undefined
              }
            />
          ))}
        </ListGroup>
      )}
      {items.length > 0 && (
        <p className="mt-4 px-2 text-xs text-muted-foreground">
          50 pesan terakhir. Ketuk titik biru untuk menandai satu pesan dibaca.
        </p>
      )}
    </Page>
  );
}
