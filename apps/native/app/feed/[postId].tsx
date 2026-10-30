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
import { CommentComposer } from "@/components/feed/comment-composer";
import { CommentsOffNotice } from "@/components/feed/comments-off-notice";
import type { ReplyTarget } from "@/components/feed/comment-composer";
import { CommentSection, afterCommentDelete } from "@/components/feed/comment-thread";
import { useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";

const NOTE_MAX = 200;

/** Detail satu post: kartu, daftar semangat, komentar, dan menu lainnya. */
export default function DetailPost() {
  const { t } = useTranslation(["feed", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const queryClient = useQueryClient();
  const { postId: id, comment } = useLocalSearchParams<{ postId: string; comment?: string }>();
  // The feed's comment button lands here with ?comment=1: the field takes the cursor once the post has loaded.
  const [focusComposer, setFocusComposer] = useState(comment === "1" ? 1 : 0);

  const { data: session } = authClient.useSession();
  const me = session?.user.id ?? null;

  const post = useQuery(orpc.social.post.queryOptions({ input: { id } }));
  const kudosList = useQuery(orpc.social.kudosList.queryOptions({ input: { postId: id } }));

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
  const setCommentsOff = useOptimisticMutation<{ off: boolean }, { ok: boolean; commentsOff: boolean }>({
    mutationFn: ({ off }) => client.social.setCommentsOff({ postId: id, off }),
    patch: ({ off }, cache) => {
      cache.value<FeedItem>(postKey, (old) => (old ? { ...old, commentsOff: off } : old));
    },
    success: ({ off }) => ({ message: off ? t("menu.toast.commentsOff") : t("menu.toast.commentsOn") }),
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
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleThread = (topId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topId)) next.delete(topId);
      else next.add(topId);
      return next;
    });

  const deleteComment = useDelayedDelete<FeedComment>({
    remove: (row) => client.social.deleteComment({ id: row.id }),
    patch: (row, cache) => {
      for (const prefix of [orpc.social.comments.key(), orpc.social.commentReplies.key()]) {
        for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
          cache.value<Parameters<typeof afterCommentDelete>[0]>(query.queryKey, (data) =>
            afterCommentDelete(data, row, t("comments.deleted")),
          );
        }
      }
    },
    label: (row) => row.body,
    fallback: t("comments.undoLabel"),
    invalidate: () => [orpc.social.key()],
  });

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
    <Screen
      scrollEnabled={!scrubbing}
      footer={
        data.commentsOff && !isOwnPost ? (
          <CommentsOffNotice />
        ) : (
          <CommentComposer
            postId={id}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            focusSignal={focusComposer}
            onSent={(topId) => {
              if (topId) setExpanded((prev) => new Set(prev).add(topId));
            }}
          />
        )
      }
    >
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
        onComment={() => setFocusComposer((n) => n + 1)}
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
      <CommentSection
        postId={id}
        me={me}
        isOwnPost={isOwnPost}
        expanded={expanded}
        onToggle={toggleThread}
        onReply={(comment, topId) => setReplyTo({ commentId: comment.id, topId, name: comment.author.name })}
        onDelete={(comment) => setConfirm({ comment })}
      />

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
              icon={data.commentsOff ? "chatbubble-outline" : "lock-closed-outline"}
              iconTint="tidur"
              title={data.commentsOff ? t("menu.commentsOn.title") : t("menu.commentsOff.title")}
              subtitle={data.commentsOff ? t("menu.commentsOn.subtitle") : t("menu.commentsOff.subtitle")}
              onPress={() => {
                setMenuOpen(false);
                setCommentsOff.mutate({ off: !data.commentsOff });
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
