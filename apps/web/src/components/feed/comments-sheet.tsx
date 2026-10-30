import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, MessageCircleOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Avatar } from "@/components/avatar";
import { CommentAttachmentCard } from "@/components/feed/comment-attachment";
import { CommentComposer } from "@/components/feed/comment-composer";
import type { ReplyTarget } from "@/components/feed/comment-composer";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { commentPhotoUrl } from "@/components/sticker";
import { useSession } from "@/lib/auth-client";
import type { FeedPost, PostCommentItem } from "@/lib/api-types";
import { timeAgo } from "@/lib/format";
import { useDelayedDelete } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type CommentPages = { pages: { items: PostCommentItem[] }[]; pageParams: unknown[] };

/** Rows a delete leaves behind in one cached comments/replies list: a hidden placeholder, or nothing. */
function afterDelete(
  old: CommentPages,
  row: { id: string; parentId: string | null; replyCount: number },
  placeholder: string,
): CommentPages {
  if (!Array.isArray(old.pages)) return old;
  const hide = row.parentId === null && row.replyCount > 0;
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((item): PostCommentItem[] => {
        if (item.id === row.id) {
          return hide
            ? [
                {
                  ...item,
                  deleted: true,
                  body: placeholder,
                  author: { id: "", name: "", handle: null, image: null },
                  replyTo: null,
                  attachment: null,
                },
              ]
            : [];
        }
        if (row.parentId && item.id === row.parentId) return [{ ...item, replyCount: Math.max(0, item.replyCount - 1) }];
        return [item];
      }),
    })),
  };
}

/**
 * Komentar satu postingan: daftar bertingkat (balasan dilipat di bawah "Lihat N balasan"), kirim, balas, lampiran,
 * dan hapus (milik sendiri, atau komentar apa pun di postinganmu sendiri).
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
  const { t } = useTranslation("feed");
  const session = useSession();
  const myId = session.data?.user.id ?? null;
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const comments = useInfiniteQuery({
    ...orpc.social.comments.infiniteOptions({
      input: (cursor: number | undefined) => ({ postId: post.id, limit: 20, cursor }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setReplyTo(null);
      setExpanded(new Set());
    }
  }, [open]);

  const expand = (topId: string) => setExpanded((prev) => new Set(prev).add(topId));

  const removeComment = useDelayedDelete<{ id: string; parentId: string | null; replyCount: number }>({
    remove: (row) => client.social.deleteComment({ id: row.id }),
    patch: (row, cache) => {
      for (const prefix of [orpc.social.comments.key(), orpc.social.commentReplies.key()]) {
        cache.matching<CommentPages>(prefix, (old) => afterDelete(old, row, t("comments.deleted")));
      }
    },
    label: () => t("comments.undoLabel"),
    invalidate: () => [orpc.social.key()],
  });

  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const actions = { isOwn, myId, removeComment };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("comments.title")}
      description={isOwn ? t("comments.own") : t("comments.other", { name: post.author.name })}
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
          <EmptyHint title={t("comments.empty.title")} pose="wink">
            {t("comments.empty.body")}
          </EmptyHint>
        ) : (
          <ul className="space-y-4" aria-label={t("comments.list")}>
            {items.map((comment) => (
              <li key={comment.id}>
                <CommentRow
                  comment={comment}
                  topId={comment.id}
                  onReply={myId ? () => {
                    setReplyTo({ commentId: comment.id, topId: comment.id, name: comment.author.name });
                  } : undefined}
                  {...actions}
                />
                {comment.replyCount > 0 && (
                  <Replies
                    topId={comment.id}
                    count={comment.replyCount}
                    open={expanded.has(comment.id)}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(comment.id)) next.delete(comment.id);
                        else next.add(comment.id);
                        return next;
                      })
                    }
                    onReply={(reply) =>
                      setReplyTo({ commentId: reply.id, topId: comment.id, name: reply.author.name })
                    }
                    canReply={myId !== null}
                    {...actions}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {comments.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={comments.isFetchingNextPage}
            onClick={() => void comments.fetchNextPage()}
          >
            {comments.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
            {t("comments.moreComments")}
          </Button>
        )}

        {/* Sticks to the bottom of the sheet while the list scrolls. The sheet pads its scroller by 1.5rem + 3rem (the popup sits 3rem under the fold), and sticky measures from the content box, so -bottom-6 lands it on the screen edge. */}
        <div className="sticky -bottom-6 z-10 -mx-5 border-t border-border bg-card px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          {myId && post.commentsOff && !isOwn ? (
            <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <MessageCircleOff className="size-4 shrink-0" aria-hidden />
              {t("comments.off.notice")}
            </p>
          ) : myId ? (
            <CommentComposer
              postId={post.id}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onSent={(topId) => {
                if (topId) expand(topId);
              }}
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              <Trans
                ns="feed"
                i18nKey="comments.signIn"
                components={{
                  link: <Link to="/login" className="font-bold text-primary hover:underline" />,
                }}
              />
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

type RowActions = {
  isOwn: boolean;
  myId: string | null;
  removeComment: (row: { id: string; parentId: string | null; replyCount: number }) => void;
};

function CommentRow({
  comment,
  topId,
  isOwn,
  myId,
  removeComment,
  onReply,
}: RowActions & {
  comment: PostCommentItem;
  topId: string;
  onReply?: (() => void) | undefined;
}) {
  const { t } = useTranslation("feed");
  const reply = comment.parentId !== null;
  const canDelete = !comment.deleted && (isOwn || comment.author.id === myId);

  return (
    <div className="flex items-start gap-2.5" data-comment-id={comment.id} data-top-id={topId}>
      <span className="shrink-0">
        {comment.deleted ? (
          <span className={reply ? "block size-7 rounded-full bg-muted" : "block size-8 rounded-full bg-muted"} aria-hidden />
        ) : (
          <Avatar
            name={comment.author.name}
            image={comment.author.image}
            className={reply ? "size-7" : "size-8"}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        {comment.deleted ? (
          <p className="text-sm text-muted-foreground italic">{t("comments.deleted")}</p>
        ) : (
          <>
            {(comment.body.length > 0 || comment.replyTo) && (
              <p className="text-sm [overflow-wrap:anywhere]">
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
                {comment.replyTo && (
                  <span className="font-semibold text-primary">
                    @{comment.replyTo.handle ?? comment.replyTo.name}{" "}
                  </span>
                )}
                <span className="text-muted-foreground">{comment.body}</span>
              </p>
            )}
            {comment.body.length === 0 && !comment.replyTo && (
              <p className="text-sm font-bold [overflow-wrap:anywhere]">{comment.author.name}</p>
            )}
            {comment.attachment && (
              <CommentAttachmentCard
                attachment={comment.attachment}
                photoSrc={comment.attachment.hasPhoto ? commentPhotoUrl(comment.id) : undefined}
                className="mt-2"
              />
            )}
            <p className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span>{timeAgo(comment.createdAt)}</span>
              {onReply && (
                <button
                  type="button"
                  className="-my-2 inline-flex min-h-9 items-center px-1 font-semibold hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  onClick={onReply}
                >
                  {t("comments.reply")}
                </button>
              )}
            </p>
          </>
        )}
      </div>
      {canDelete && (
        <button
          type="button"
          aria-label={t("comments.delete")}
          className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          onClick={() =>
            removeComment({ id: comment.id, parentId: comment.parentId, replyCount: comment.replyCount })
          }
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** The replies under one top-level comment: collapsed to "Lihat N balasan", loaded when opened, paged by 10. */
function Replies({
  topId,
  count,
  open,
  onToggle,
  onReply,
  canReply,
  ...actions
}: RowActions & {
  topId: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onReply: (reply: PostCommentItem) => void;
  canReply: boolean;
}) {
  const { t } = useTranslation("feed");
  const replies = useInfiniteQuery({
    ...orpc.social.commentReplies.infiniteOptions({
      input: (cursor: number | undefined) => ({ parentId: topId, limit: 10, cursor }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
    enabled: open,
  });
  const items = replies.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="mt-2 ml-10">
      <button
        type="button"
        aria-expanded={open}
        className="-my-1 inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        onClick={onToggle}
      >
        <span aria-hidden className="h-px w-6 bg-border" />
        {open ? t("comments.hideReplies") : t("comments.viewReplies", { count })}
      </button>
      {open && (
        <div className="mt-1 space-y-3">
          {replies.isPending ? (
            <Skeleton className="h-10 rounded-2xl" />
          ) : replies.error ? (
            <ScreenError message={replies.error.message} onRetry={() => replies.refetch()} />
          ) : (
            <ul className="space-y-3">
              {items.map((reply) => (
                <li key={reply.id}>
                  <CommentRow
                    comment={reply}
                    topId={topId}
                    onReply={canReply ? () => onReply(reply) : undefined}
                    {...actions}
                  />
                </li>
              ))}
            </ul>
          )}
          {replies.hasNextPage && (
            <button
              type="button"
              disabled={replies.isFetchingNextPage}
              className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
              onClick={() => void replies.fetchNextPage()}
            >
              {replies.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("comments.moreReplies")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
