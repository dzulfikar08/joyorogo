import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { removeById, upsertById } from "@joyorogo/api/lib/optimistic";

import { Avatar } from "@/components/avatar";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { useSession } from "@/lib/auth-client";
import type { FeedPost } from "@/lib/api-types";
import { timeAgo } from "@/lib/format";
import { useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type FeedComment = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string; handle: string | null; image: string | null };
};

/**
 * Komentar satu postingan: daftar + kirim + hapus (milik sendiri, atau
 * komentar apa pun di postinganmu sendiri).
 */
export function CommentsSheet({
  post,
  isOwn,
  open,
  onOpenChange,
}: {
  post: FeedPost;
  isOwn: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const myId = session.data?.user.id ?? null;
  const [body, setBody] = useState("");
  const addTempId = useRef<string | null>(null);

  const comments = useQuery({
    ...orpc.social.comments.queryOptions({ input: { postId: post.id, limit: 50 } }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) setBody("");
  }, [open]);

  const commentsKey = orpc.social.comments.queryOptions({
    input: { postId: post.id, limit: 50 },
  }).queryKey;

  const add = useOptimisticMutation<
    Parameters<AppRouterClient["social"]["addComment"]>[0],
    Awaited<ReturnType<AppRouterClient["social"]["addComment"]>>
  >({
    mutationFn: (input) => client.social.addComment(input),
    patch: (input, cache) => {
      const tempId = crypto.randomUUID();
      addTempId.current = tempId;
      // Provisional comment (my own author card) until the server id arrives.
      const provisional = {
        id: tempId,
        body: input.body,
        createdAt: new Date(),
        author: { id: myId ?? "", name: session.data?.user.name ?? "", handle: null, image: session.data?.user.image ?? null },
      };
      // social.comments caches hold { items, nextCursor }.
      cache.value<{ items: FeedComment[]; nextCursor: number | null }>(commentsKey, (old) =>
        old ? { ...old, items: [...old.items, provisional] } : old,
      );
    },
    invalidate: () => [orpc.social.key()],
    success: (_input, row) => {
      setBody("");
      const tempId = addTempId.current;
      addTempId.current = null;
      if (tempId) {
        queryClient.setQueryData<{ items: FeedComment[] }>(commentsKey, (old) => {
          if (!old) return old;
          const last = old.items.at(-1);
          if (!last) return old;
          return { ...old, items: upsertById(removeById(old.items, tempId), { ...last, id: row.id }) };
        });
      }
      return {
        message: "Komentar terkirim",
        undo: () => {
          queryClient.setQueryData<{ items: FeedComment[] }>(commentsKey, (old) =>
            old ? { ...old, items: removeById(old.items, row.id) } : old,
          );
          void client.social.deleteComment({ id: row.id });
        },
      };
    },
  });
  const removeComment = useDelayedDelete<{ id: string }>({
    remove: (row) => client.social.deleteComment({ id: row.id }),
    patch: (row, cache) => {
      cache.value<{ items: FeedComment[]; nextCursor: number | null }>(commentsKey, (old) =>
        old ? { ...old, items: removeById(old.items, row.id) } : old,
      );
    },
    label: () => "Komentar",
    invalidate: () => [orpc.social.key()],
  });

  const items = comments.data?.items ?? [];

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Komentar"
      description={isOwn ? "Komentar di postinganmu" : `Di postingan ${post.author.name}`}
    >
      <div className="space-y-3">
        {comments.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-2xl" />
            <Skeleton className="h-12 rounded-2xl" />
          </div>
        ) : comments.error ? (
          <ScreenError message={comments.error.message} onRetry={() => comments.refetch()} />
        ) : items.length === 0 ? (
          <EmptyHint title="Belum ada komentar">
            Jadi yang pertama memberi semangat lewat komentar.
          </EmptyHint>
        ) : (
          <ul className="space-y-3" aria-label="Daftar komentar">
            {items.map((comment) => (
              <li key={comment.id} className="flex items-start gap-2.5">
                <span className="shrink-0">
                  <Avatar name={comment.author.name} image={comment.author.image} className="size-8" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {comment.author.handle ? (
                      <Link
                        to="/u/$handle"
                        params={{ handle: comment.author.handle }}
                        className="font-bold hover:underline"
                      >
                        {comment.author.name}
                      </Link>
                    ) : (
                      <span className="font-bold">{comment.author.name}</span>
                    )}{" "}
                    <span className="text-muted-foreground">{comment.body}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</p>
                </div>
                {(isOwn || comment.author.id === myId) && (
                  <button
                    type="button"
                    aria-label="Hapus komentar"
                    className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                    onClick={() => removeComment(comment)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {myId ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const clean = body.trim();
              if (clean.length === 0) return;
              add.mutate({ postId: post.id, body: clean });
            }}
          >
            <Input
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={280}
              placeholder="Tulis komentar..."
              aria-label="Tulis komentar"
            />
            <Button
              type="submit"
              size="icon"
              disabled={add.isPending || body.trim().length === 0}
              aria-label="Kirim komentar"
            >
              <Send className="size-4" aria-hidden />
            </Button>
          </form>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="font-bold text-primary hover:underline">
              Masuk
            </Link>{" "}
            untuk ikut berkomentar.
          </p>
        )}
      </div>
    </Sheet>
  );
}
