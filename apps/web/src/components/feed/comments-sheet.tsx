import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/avatar";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { useSession } from "@/lib/auth-client";
import type { FeedPost } from "@/lib/api-types";
import { timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

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

  const comments = useQuery({
    ...orpc.social.comments.queryOptions({ input: { postId: post.id, limit: 50 } }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) setBody("");
  }, [open]);

  // Satu invalidasi untuk semua query social: kartu feed ikut memperbarui jumlah.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.social.key() });

  const add = useMutation(
    orpc.social.addComment.mutationOptions({
      onSuccess: () => {
        setBody("");
        void invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const remove = useMutation(
    orpc.social.deleteComment.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (error) => toast.error(error.message),
    }),
  );

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
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: comment.id })}
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
