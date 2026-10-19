import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { CommentAttachmentCard } from "@/components/feed/comment-attachment";
import { Avatar, Button, Card, ErrorState, Skeleton, Text } from "@/components/ui";
import { openAuthor } from "@/components/feed/post-card";
import type { FeedComment } from "@/src/lib/social";
import { errorMessage, timeAgo } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type CommentPages = { pages: { items: FeedComment[] }[]; pageParams: unknown[] };

/**
 * What a cached comments or replies list looks like once `row` is deleted: a comment with replies stays as the
 * "komentar dihapus" placeholder, anything else disappears, and the thread above a removed reply counts one less.
 */
export function afterCommentDelete(old: CommentPages | undefined, row: FeedComment, placeholder: string): CommentPages | undefined {
  if (!old || !Array.isArray(old.pages)) return old;
  const hide = row.parentId === null && row.replyCount > 0;
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((item): FeedComment[] => {
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
        if (row.parentId && item.id === row.parentId) {
          return [{ ...item, replyCount: Math.max(0, item.replyCount - 1) }];
        }
        return [item];
      }),
    })),
  };
}

export type CommentActions = {
  me: string | null;
  isOwnPost: boolean;
  /** Undefined when nobody is signed in. */
  onReply: ((comment: FeedComment, topId: string) => void) | undefined;
  onDelete: (comment: FeedComment) => void;
};

/**
 * The comments of one post: top-level comments newest-last, each with its replies folded under
 * "Lihat N balasan" and loaded ten at a time when opened.
 */
export function CommentSection({
  postId,
  expanded,
  onToggle,
  ...actions
}: CommentActions & {
  postId: string;
  expanded: ReadonlySet<string>;
  onToggle: (topId: string) => void;
}) {
  const { t } = useTranslation("feed");
  const comments = useInfiniteQuery(
    orpc.social.comments.infiniteOptions({
      input: (cursor: number | undefined) => ({ postId, limit: 20, cursor }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const items = (comments.data?.pages.flatMap((page) => page.items) ?? []) as FeedComment[];

  if (comments.isPending) return <Skeleton width="100%" height={80} radius={24} />;
  if (comments.isError) {
    return <ErrorState message={errorMessage(comments.error)} onRetry={() => void comments.refetch()} />;
  }
  if (items.length === 0) {
    return (
      <Card>
        <Text style={styles.muted}>{t("comments.empty.short")}</Text>
      </Card>
    );
  }
  return (
    <View style={styles.list}>
      {items.map((comment) => (
        <Card key={comment.id} style={styles.thread}>
          <CommentBody comment={comment} topId={comment.id} {...actions} />
          {comment.replyCount > 0 ? (
            <Replies
              topId={comment.id}
              count={comment.replyCount}
              open={expanded.has(comment.id)}
              onToggle={() => onToggle(comment.id)}
              {...actions}
            />
          ) : null}
        </Card>
      ))}
      {comments.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          label={t("comments.moreComments")}
          loading={comments.isFetchingNextPage}
          onPress={() => void comments.fetchNextPage()}
        />
      ) : null}
    </View>
  );
}

function CommentBody({
  comment,
  topId,
  me,
  isOwnPost,
  onReply,
  onDelete,
}: CommentActions & { comment: FeedComment; topId: string }) {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  const reply = comment.parentId !== null;

  if (comment.deleted) {
    return (
      <View style={styles.row}>
        <View style={[styles.ghostAvatar, reply && styles.ghostAvatarSmall]} />
        <Text style={styles.deleted}>{t("comments.deleted")}</Text>
      </View>
    );
  }
  const canDelete = comment.author.id === me || isOwnPost;
  const mention = comment.replyTo ? `@${comment.replyTo.handle ?? comment.replyTo.name} ` : null;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("post.openProfile", { name: comment.author.name })}
        onPress={() => openAuthor(comment.author.handle)}
      >
        <Avatar name={comment.author.name} image={comment.author.image} size={reply ? 24 : 32} />
      </Pressable>
      <View style={styles.content}>
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("post.openProfile", { name: comment.author.name })}
            onPress={() => openAuthor(comment.author.handle)}
            style={styles.headName}
          >
            <Text style={styles.name} numberOfLines={1}>
              {comment.author.name}
            </Text>
          </Pressable>
          <Text style={styles.muted}>{timeAgo(comment.createdAt)}</Text>
        </View>
        {comment.body.length > 0 || mention ? (
          <Text style={styles.body}>
            {mention ? <Text style={styles.mention}>{mention}</Text> : null}
            {comment.body}
          </Text>
        ) : null}
        {comment.attachment ? (
          <CommentAttachmentCard
            attachment={comment.attachment}
            photo={comment.attachment.hasPhoto ? { type: "comment", commentId: comment.id } : null}
            style={styles.attachment}
          />
        ) : null}
        <View style={styles.actions}>
          {onReply ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("comments.reply")}
              onPress={() => onReply(comment, topId)}
              style={({ pressed }) => [styles.replyButton, pressed && styles.pressed]}
            >
              <Text style={styles.replyLabel}>{t("comments.reply")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {canDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("comments.delete")}
          onPress={() => onDelete(comment)}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={16} color={theme.colors.destructive} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The replies under one top-level comment: folded to "Lihat N balasan", loaded when opened, paged by 10. */
function Replies({
  topId,
  count,
  open,
  onToggle,
  ...actions
}: CommentActions & { topId: string; count: number; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  const replies = useInfiniteQuery({
    ...orpc.social.commentReplies.infiniteOptions({
      input: (cursor: number | undefined) => ({ parentId: topId, limit: 10, cursor }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
    enabled: open,
  });
  const items = (replies.data?.pages.flatMap((page) => page.items) ?? []) as FeedComment[];

  return (
    <View style={styles.replies}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? t("comments.hideReplies") : t("comments.viewReplies", { count })}
        onPress={onToggle}
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
      >
        <View style={styles.toggleLine} />
        <Text style={styles.toggleLabel}>{open ? t("comments.hideReplies") : t("comments.viewReplies", { count })}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.colors.mutedForeground} />
      </Pressable>
      {open ? (
        replies.isPending ? (
          <Skeleton width="100%" height={48} radius={18} />
        ) : replies.isError ? (
          <ErrorState message={errorMessage(replies.error)} onRetry={() => void replies.refetch()} />
        ) : (
          <View style={styles.replyList}>
            {items.map((reply) => (
              <CommentBody key={reply.id} comment={reply} topId={topId} {...actions} />
            ))}
            {replies.hasNextPage ? (
              <Button
                variant="ghost"
                size="sm"
                label={t("comments.moreReplies")}
                loading={replies.isFetchingNextPage}
                onPress={() => void replies.fetchNextPage()}
              />
            ) : null}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing.md,
  },
  thread: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.xs,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  headName: {
    flexShrink: 1,
  },
  name: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  muted: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  body: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  mention: {
    fontWeight: "700",
    color: theme.colors.primary,
  },
  attachment: {
    marginTop: theme.spacing.xs,
  },
  deleted: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    color: theme.colors.mutedForeground,
  },
  ghostAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.muted,
  },
  ghostAvatarSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  replyButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingRight: theme.spacing.md,
  },
  replyLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  iconButton: {
    width: 44,
    height: 44,
    marginTop: -10,
    marginRight: -10,
    alignItems: "center",
    justifyContent: "center",
  },
  replies: {
    gap: theme.spacing.sm,
    paddingLeft: theme.spacing.xl + theme.spacing.sm,
  },
  replyList: {
    gap: theme.spacing.md,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    minHeight: 44,
  },
  toggleLine: {
    width: 20,
    height: 1,
    backgroundColor: theme.colors.hairline,
  },
  toggleLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  pressed: {
    opacity: 0.7,
  },
}));
