import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, Redirect, router } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

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
import { useSessionGate } from "@/lib/use-session-gate";
import { authClient } from "@/lib/auth-client";
import { REPORT_REASONS, type FeedComment, type FeedItem } from "@/src/lib/social";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { timeAgoId } from "@/src/lib/group";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";

const COMMENT_MAX = 280;
const NOTE_MAX = 200;

/** Detail satu post: kartu, daftar semangat, komentar, dan menu lainnya. */
export default function DetailPost() {
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
    label: () => "Postingan",
    invalidate: () => [orpc.social.key()],
  });
  const block = useMutation({
    mutationFn: () => client.social.block({ userId: post.data!.author.id }),
    onSuccess: () => {
      refresh();
      router.replace("/feed");
    },
  });
  const report = useMutation({
    mutationFn: (input: { reason: (typeof REPORT_REASONS)[number]["value"]; note?: string }) =>
      client.social.report({ postId: id, ...input }),
    onSuccess: () => {
      setReportOpen(false);
      toast.success("Laporan terkirim. Terima kasih.");
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
          name: session?.user.name ?? "Kamu",
          handle: null,
          image: session?.user.image ?? null,
        },
      });
    },
    success: (_input, data) => {
      setCommentText("");
      return {
        message: "Komentar terkirim",
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
    fallback: "Komentar",
    invalidate: () => [orpc.social.key()],
  });

  const [commentText, setCommentText] = useState("");

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Post" />
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
        <PageHeader title="Post" />
        <Skeleton width="100%" height={240} radius={24} />
        <Skeleton width="100%" height={120} radius={24} />
      </Screen>
    );
  }
  if (post.isError) {
    return (
      <Screen>
        <PageHeader title="Post" />
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
    <Screen>
      <PageHeader
        title="Post"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menu lainnya"
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
      />

      <Text style={styles.sectionLabel}>Semangat</Text>
      {kudosList.isPending ? (
        <Skeleton width="100%" height={80} radius={24} />
      ) : (kudosList.data?.length ?? 0) === 0 ? (
        <Card>
          <Text style={styles.muted}>
            Belum ada yang memberi semangat. Jadilah yang pertama.
          </Text>
        </Card>
      ) : (
        <Card style={styles.listCard}>
          {kudosList.data!.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              accessibilityLabel={`Profil ${person.name}`}
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

      <Text style={styles.sectionLabel}>Komentar</Text>
      {comments.isPending ? (
        <Skeleton width="100%" height={80} radius={24} />
      ) : (comments.data?.items.length ?? 0) === 0 ? (
        <Card>
          <Text style={styles.muted}>Belum ada komentar. Mulai percakapannya.</Text>
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
                    accessibilityLabel={`Profil ${comment.author.name}`}
                    onPress={() => openAuthor(comment.author.handle)}
                    style={({ pressed }) => [styles.commentAuthor, pressed && styles.pressed]}
                  >
                    <Avatar name={comment.author.name} image={comment.author.image} size={24} />
                    <Text style={styles.personName}>{comment.author.name}</Text>
                    <Text style={styles.muted}>{timeAgoId(comment.createdAt)}</Text>
                  </Pressable>
                  {canDelete ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Hapus komentar"
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
        <Field label={`Komentar · ${commentText.length}/${COMMENT_MAX}`}>
          <Input
            value={commentText}
            onChangeText={setCommentText}
            maxLength={COMMENT_MAX}
            multiline
            placeholder="Tulis komentar..."
          />
        </Field>
        {addComment.isError ? (
          <Text style={styles.error}>{errorMessage(addComment.error)}</Text>
        ) : null}
        <Button
          label="Kirim"
          size="sm"
          disabled={commentText.trim().length === 0 || addComment.isPending}
          loading={addComment.isPending}
          onPress={() => addComment.mutate(commentText.trim())}
        />
      </Card>

      {/* Overflow menu */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Lainnya">
        <Card style={styles.menuCard}>
          <ListRow
            icon="flag-outline"
            iconTint="bakar"
            title="Laporkan post"
            subtitle="Kirimi laporan ke tim JoyoRogo"
            onPress={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
          {!isOwnPost ? (
            <ListRow
              icon="ban-outline"
              iconTint="tidur"
              title={`Blokir ${data.author.name}`}
              subtitle="Sembunyikan konten satu sama lain"
              onPress={() => {
                setMenuOpen(false);
                setConfirm("block");
              }}
            />
          ) : null}
          {isOwnPost ? (
            <ListRow
              icon="trash-outline"
              iconTint="bakar"
              title="Hapus post"
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
        title="Hapus post ini?"
        message="Post, semangat, dan komentarnya akan hilang untuk semua orang."
        confirmLabel="Hapus"
        cancelLabel="Batal"
        onConfirm={() => {
          setConfirm(null);
          deletePostCommit({ id });
        }}
      />
      <ConfirmSheet
        visible={confirm === "block"}
        onClose={() => setConfirm(null)}
        title={`Blokir ${data.author.name}?`}
        message="Konten kalian saling disembunyikan dan follow diputus. Bisa dibuka lewat daftar blokir di Profil."
        confirmLabel="Blokir"
        cancelLabel="Batal"
        loading={block.isPending}
        onConfirm={() => block.mutate()}
      />
      <ConfirmSheet
        visible={confirm !== null && confirm !== "block" && confirm !== "deletePost"}
        onClose={() => setConfirm(null)}
        title="Hapus komentar ini?"
        message="Komentar akan dihapus untuk semua orang."
        confirmLabel="Hapus"
        cancelLabel="Batal"
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
  onSubmit: (reason: (typeof REPORT_REASONS)[number]["value"], note: string) => void;
}) {
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]["value"] | null>(null);
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
      title="Laporkan post"
      footer={
        <Button
          label="Kirim laporan"
          disabled={reason === null || pending}
          loading={pending}
          onPress={() => reason !== null && onSubmit(reason, note)}
        />
      }
    >
      <Field label="Alasan">
        <View style={styles.chipRow}>
          {REPORT_REASONS.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              selected={reason === item.value}
              onPress={() => setReason(item.value)}
            />
          ))}
        </View>
      </Field>
      <Field label={`Catatan (opsional) · ${note.length}/${NOTE_MAX}`}>
        <Input value={note} onChangeText={setNote} maxLength={NOTE_MAX} multiline placeholder="Tambahkan detail kalau perlu" />
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
