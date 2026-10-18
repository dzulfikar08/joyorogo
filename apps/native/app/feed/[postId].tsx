import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, Redirect, router } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import {
  Avatar,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  Input,
  ListRow,
  PageHeader,
  Screen,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";
import { PostCard, openAuthor } from "@/components/feed/post-card";
import { RouteMapPreview } from "@/components/feed/route-map-preview";
import { WorkoutDetail } from "@/components/feed/workout-detail";
import { useSessionGate } from "@/lib/use-session-gate";
import { authClient } from "@/lib/auth-client";
import { REPORT_REASONS, type FeedComment, type FeedItem, type ReportReason } from "@/src/lib/social";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";
import { errorMessage, timeAgo } from "@/utils/format";

const COMMENT_MAX = 280;
const NOTE_MAX = 200;

/** Detail satu post: kartu, daftar semangat, komentar, dan menu lainnya. */
export default function DetailPost() {
  const { t } = useTranslation(["feed", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const queryClient = useQueryClient();
  const { postId: id } = useLocalSearchParams<{ postId: string }>();

  const { data: session } = authClient.useSession();
  const me = session?.user.id ?? null;

  const post = useQuery(orpc.social.post.queryOptions({ input: { id } }));
  const kudosList = useQuery(orpc.social.kudosList.queryOptions({ input: { postId: id } }));
  const comments = useQuery(orpc.social.comments.queryOptions({ input: { postId: id } }));

  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "block" | "deletePost" | { comment: FeedComment }>(null);

  const toast = useToast();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.social.key() });
  };

  type FeedPage = { items: FeedItem[]; nextCursor: number | null };
  type FeedCache = { pages: FeedPage[]; pageParams: unknown[] };

  // Delayed commit: post vanishes now, DELETE fires after the undo window,
  // and the back navigation only happens once the delete really landed.
  const deletePostCommit = useDelayedDelete<{ id: string }>({
    remove: async () => {
      await client.social.deletePost({ id });
      router.replace("/feed");
    },
    patch: (_row, cache) => {
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ["social", "feed"] })) {
        cache.value<FeedCache>(query.queryKey, (data) =>
          data === undefined
            ? undefined
            : {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((item) => item.id !== id),
                })),
              },
        );
      }
    },
    label: () => t("menu.undoLabel"),
    invalidate: () => [orpc.social.key()],
  });
  const block = useMutation({
    mutationFn: () => client.social.block({ userId: post.data!.author.id }),
    onSuccess: () => {
      refresh();
      router.replace("/feed");
    },
  });
  const postKey = orpc.social.post.queryOptions({ input: { id } }).queryKey;
  const setPostMap = useOptimisticMutation<{ show: boolean }, { showMap: number }>({
    mutationFn: ({ show }) => client.social.setPostMap({ postId: id, show }),
    patch: ({ show }, cache) => {
      cache.value<FeedItem>(postKey, (old) =>
        old
          ? {
              ...old,
              mapLine: show ? old.mapLine : undefined,
              stats: { ...old.stats, showMap: show ? 1 : 0 },
            }
          : old,
      );
    },
    success: ({ show }) => ({ message: show ? t("menu.toast.mapShown") : t("menu.toast.mapHidden") }),
    invalidate: () => [orpc.social.key()],
  });
  const report = useMutation({
    mutationFn: (input: { reason: ReportReason; note?: string }) =>
      client.social.report({ postId: id, ...input }),
    onSuccess: () => {
      setReportOpen(false);
      toast.success(t("menu.toast.reported"));
    },
  });
  type CommentRow = NonNullable<NonNullable<typeof comments.data>["items"]>[number];
  const commentsKey = orpc.social.comments.queryOptions({ input: { postId: id } }).queryKey;

  /** social.comments caches hold { items, nextCursor }: append one row. */
  const insertCommentRow = (cache: OptimisticCache, row: CommentRow) => {
    cache.value<{ items: CommentRow[]; nextCursor: number | null }>(commentsKey, (old) =>
      old ? { ...old, items: [...old.items, row] } : old,
    );
  };

  /** social.comments caches hold { items, nextCursor }: strip one row. */
  const stripCommentRow = (cache: OptimisticCache, commentId: string) => {
    cache.value<{ items: CommentRow[]; nextCursor: number | null }>(commentsKey, (old) =>
      old ? { ...old, items: old.items.filter((comment) => comment.id !== commentId) } : old,
    );
  };

  const addComment = useOptimisticMutation<
    string,
    { id: string }
  >({
    mutationFn: (body) => client.social.addComment({ postId: id, body }),
    patch: (body, cache) => {
      insertCommentRow(cache, {
        id: `temp-${Date.now()}`,
        body,
        createdAt: new Date(),
        author: {
          id: me ?? "",
          name: session?.user.name ?? t("composer.fallbackName"),
          handle: null,
          image: session?.user.image ?? null,
        },
      });
    },
    success: (_input, data) => {
      setCommentText("");
      return {
        message: t("comments.toast.sent"),
        undo: () => void client.social.deleteComment({ id: data.id }),
      };
    },
    invalidate: () => [orpc.social.key()],
  });
  const deleteComment = useDelayedDelete<CommentRow>({
    remove: (row) => client.social.deleteComment({ id: row.id }),
    patch: (row, cache) => {
      stripCommentRow(cache, row.id);
    },
    label: (row) => row.body,
    fallback: t("comments.undoLabel"),
    invalidate: () => [orpc.social.key()],
  });

  const [commentText, setCommentText] = useState("");
  const [scrubbing, setScrubbing] = useState(false);

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title={t("common:nav.title.post")} />
        <Skeleton width="100%" height={240} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (post.isPending) {
    return (
      <Screen>
        <PageHeader title={t("common:nav.title.post")} />
        <Skeleton width="100%" height={240} radius={24} />
        <Skeleton width="100%" height={120} radius={24} />
      </Screen>
    );
  }
  if (post.isError) {
    return (
      <Screen>
        <PageHeader title={t("common:nav.title.post")} />
        <ErrorState
          message={errorMessage(post.error)}
          onRetry={() => void post.refetch()}
        />
      </Screen>
    );
  }

  const data = post.data;
  const isOwnPost = data.author.id === me;

  return (
    <Screen scrollEnabled={!scrubbing}>
      <PageHeader
        title={t("common:nav.title.post")}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common:nav.more")}
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.foreground} />
          </Pressable>
        }
      />

      <PostCard
        post={data}
        onPressAuthor={(handle) => openAuthor(handle)}
        right={null}
        hideMap
      />

      {data.mapLine ? (
        <Card>
          <RouteMapPreview line={data.mapLine} title={data.title} size="detail" />
        </Card>
      ) : null}

      {data.stats?.source === "joyofit" && data.stats.hasDetail === 1 ? <WorkoutDetail postId={data.id} onScrubActive={setScrubbing} /> : null}

      <Text style={styles.sectionLabel}>{t("post.kudos.label")}</Text>
      {kudosList.isPending ? (
        <Skeleton width="100%" height={80} radius={24} />
      ) : (kudosList.data?.length ?? 0) === 0 ? (
        <Card>
          <Text style={styles.muted}>{t("post.kudos.empty")}</Text>
        </Card>
      ) : (
        <Card style={styles.listCard}>
          {kudosList.data!.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              accessibilityLabel={t("post.openProfile", { name: person.name })}
              onPress={() => openAuthor(person.handle)}
              style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}
            >
              <Avatar name={person.name} image={person.image} size={28} />
              <Text style={styles.personName}>{person.name}</Text>
              <Ionicons name="heart" size={14} color={theme.colors.bakar} />
            </Pressable>
          ))}
        </Card>
      )}

      <Text style={styles.sectionLabel}>{t("comments.title")}</Text>
      {comments.isPending ? (
        <Skeleton width="100%" height={80} radius={24} />
      ) : (comments.data?.items.length ?? 0) === 0 ? (
        <Card>
          <Text style={styles.muted}>{t("comments.empty.short")}</Text>
        </Card>
      ) : (
        <View style={styles.commentList}>
          {comments.data!.items.map((comment) => {
            const canDelete = comment.author.id === me || isOwnPost;
            return (
              <Card key={comment.id} style={styles.commentCard}>
                <View style={styles.commentHeader}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("post.openProfile", { name: comment.author.name })}
                    onPress={() => openAuthor(comment.author.handle)}
                    style={({ pressed }) => [styles.commentAuthor, pressed && styles.pressed]}
                  >
                    <Avatar name={comment.author.name} image={comment.author.image} size={24} />
                    <Text style={styles.personName}>{comment.author.name}</Text>
                    <Text style={styles.muted}>{timeAgo(comment.createdAt)}</Text>
                  </Pressable>
                  {canDelete ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("comments.delete")}
                      onPress={() => setConfirm({ comment })}
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                    >
                      <Ionicons name="trash-outline" size={16} color={theme.colors.destructive} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.commentBody}>{comment.body}</Text>
              </Card>
            );
          })}
        </View>
      )}
      {comments.isError ? <Text style={styles.error}>{errorMessage(comments.error)}</Text> : null}

      <Card style={styles.commentForm}>
        <Field label={t("comments.field", { n: commentText.length, max: COMMENT_MAX })}>
          <Input
            value={commentText}
            onChangeText={setCommentText}
            maxLength={COMMENT_MAX}
            multiline
            placeholder={t("comments.placeholder")}
          />
        </Field>
        {addComment.isError ? (
          <Text style={styles.error}>{errorMessage(addComment.error)}</Text>
        ) : null}
        <Button
          label={t("comments.sendShort")}
          size="sm"
          disabled={commentText.trim().length === 0 || addComment.isPending}
          loading={addComment.isPending}
          onPress={() => addComment.mutate(commentText.trim())}
        />
      </Card>

      {/* Overflow menu */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={t("common:nav.more")}>
        <Card style={styles.menuCard}>
          <ListRow
            icon="flag-outline"
            iconTint="bakar"
            title={t("menu.report.title")}
            subtitle={t("menu.report.subtitle")}
            onPress={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
          {!isOwnPost ? (
            <ListRow
              icon="ban-outline"
              iconTint="tidur"
              title={t("menu.block.title", { name: data.author.name })}
              subtitle={t("menu.block.subtitle")}
              onPress={() => {
                setMenuOpen(false);
                setConfirm("block");
              }}
            />
          ) : null}
          {isOwnPost && data.stats?.hasMap === 1 ? (
            <ListRow
              icon={data.stats.showMap === 0 ? "map-outline" : "eye-off-outline"}
              iconTint="tidur"
              title={data.stats.showMap === 0 ? t("menu.mapShow.title") : t("menu.mapHide.title")}
              subtitle={data.stats.showMap === 0 ? t("menu.mapShow.subtitle") : t("menu.mapHide.subtitle")}
              onPress={() => {
                setMenuOpen(false);
                setPostMap.mutate({ show: data.stats?.showMap === 0 });
              }}
            />
          ) : null}
          {isOwnPost ? (
            <ListRow
              icon="trash-outline"
              iconTint="bakar"
              title={t("menu.delete.title")}
              destructive
              onPress={() => {
                setMenuOpen(false);
                setConfirm("deletePost");
              }}
            />
          ) : null}
        </Card>
      </Sheet>

      {/* Report sheet: reason chips + optional note */}
      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        pending={report.isPending}
        error={report.isError ? errorMessage(report.error) : null}
        onSubmit={(reason, note) => report.mutate({ reason, note: note.trim().length > 0 ? note.trim() : undefined })}
      />

      <ConfirmSheet
        visible={confirm === "deletePost"}
        onClose={() => setConfirm(null)}
        title={t("confirm.deletePost.title")}
        message={t("confirm.deletePost.message")}
        confirmLabel={t("common:actions.delete")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={() => {
          setConfirm(null);
          deletePostCommit({ id });
        }}
      />
      <ConfirmSheet
        visible={confirm === "block"}
        onClose={() => setConfirm(null)}
        title={t("confirm.block.title", { name: data.author.name })}
        message={t("confirm.block.message")}
        confirmLabel={t("confirm.block.action")}
        cancelLabel={t("common:actions.cancel")}
        loading={block.isPending}
        onConfirm={() => block.mutate()}
      />
      <ConfirmSheet
        visible={confirm !== null && confirm !== "block" && confirm !== "deletePost"}
        onClose={() => setConfirm(null)}
        title={t("confirm.deleteComment.title")}
        message={t("confirm.deleteComment.message")}
        confirmLabel={t("common:actions.delete")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={() => {
          const target = confirm;
          if (target && target !== "block" && target !== "deletePost") {
            deleteComment(target.comment);
          }
          setConfirm(null);
        }}
      />
    </Screen>
  );
}

/** Report sheet: chips for the reason plus an optional note (maks 200). */
function ReportSheet({
  visible,
  onClose,
  pending,
  error,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  onSubmit: (reason: ReportReason, note: string) => void;
}) {
  const { t } = useTranslation("feed");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (visible) {
      setReason(null);
      setNote("");
    }
  }, [visible]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("menu.report.title")}
      footer={
        <Button
          label={t("report.send")}
          disabled={reason === null || pending}
          loading={pending}
          onPress={() => reason !== null && onSubmit(reason, note)}
        />
      }
    >
      <Field label={t("report.reasonLabel")}>
        <View style={styles.chipRow}>
          {REPORT_REASONS.map((item) => (
            <Chip
              key={item}
              label={t(`report.reason.${item}`)}
              selected={reason === item}
              onPress={() => setReason(item)}
            />
          ))}
        </View>
      </Field>
      <Field label={t("report.noteCount", { n: note.length, max: NOTE_MAX })}>
        <Input value={note} onChangeText={setNote} maxLength={NOTE_MAX} multiline placeholder={t("report.noteDetail")} />
      </Field>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  listCard: {
    gap: theme.spacing.md,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  personName: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  commentList: {
    gap: theme.spacing.md,
  },
  commentCard: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  commentAuthor: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  commentBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  commentForm: {
    gap: theme.spacing.md,
  },
  menuCard: {
    paddingVertical: 0,
    overflow: "hidden",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  error: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.destructive,
  },
}));
