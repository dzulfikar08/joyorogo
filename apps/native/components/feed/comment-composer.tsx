import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View, type TextInput } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { CommentAttachmentCard } from "@/components/feed/comment-attachment";
import { useToast } from "@/components/toast";
import { Chip, Input, Sheet, Skeleton, Text } from "@/components/ui";
import { compressPhoto } from "@/lib/compress-photo";
import type { PendingPhoto } from "@/lib/compress-photo";
import type { CommentAttachable, CommentItemKind } from "@/src/lib/social";
import { errorMessage } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

const COMMENT_MAX = 280;
const KINDS: CommentItemKind[] = ["workout", "food", "weight", "recap", "route"];

/** The one thing a draft comment carries: a photo not uploaded yet, or an item of the commenter's own. */
type Draft = { type: "photo"; photo: PendingPhoto } | { type: "item"; item: CommentAttachable };

export type ReplyTarget = { commentId: string; topId: string; name: string };

/**
 * Bar pinned under the post screen: reply chip, draft attachment, attach menu (Galeri / Kamera / Dari aplikasi),
 * text field and send. Sending a photo uploads it first, then posts the comment with its id.
 */
export function CommentComposer({
  postId,
  replyTo,
  onCancelReply,
  onSent,
}: {
  postId: string;
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  /** The thread the comment landed in (null for a top-level comment). */
  onSent: (topId: string | null) => void;
}) {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInput>(null);
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const send = useMutation({
    mutationFn: async (input: { body: string; draft: Draft | null; parentId: string | undefined }) => {
      let attachment: Parameters<typeof client.social.addComment>[0]["attachment"];
      if (input.draft?.type === "photo") {
        const uploaded = await client.social.uploadCommentPhoto({
          imageBase64: input.draft.photo.base64,
          mimeType: "image/jpeg",
        });
        attachment = { kind: "image", photoId: uploaded.photoId };
      } else if (input.draft?.type === "item") {
        attachment = { kind: input.draft.item.kind, refId: input.draft.item.refId };
      }
      return client.social.addComment({
        postId,
        body: input.body,
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(attachment ? { attachment } : {}),
      });
    },
    onSuccess: (row) => {
      setBody("");
      setDraft(null);
      setMenuOpen(false);
      onCancelReply();
      onSent(row.parentId);
      void queryClient.invalidateQueries({ queryKey: orpc.social.key() });
      toast.success(t("comments.toast.sent"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const pickPhoto = async (source: "gallery" | "camera") => {
    setMenuOpen(false);
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
      };
      if (source === "camera") {
        const asked = await ImagePicker.requestCameraPermissionsAsync();
        if (!asked.granted) {
          toast.error(t("comments.attach.cameraDenied"));
          return;
        }
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync({ ...options, selectionLimit: 1 });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      setWorking(true);
      setDraft({ type: "photo", photo: await compressPhoto(asset) });
    } catch (e) {
      toast.error(t("comments.attach.photoError"), errorMessage(e));
    } finally {
      setWorking(false);
    }
  };

  const clean = body.trim();
  const canSend = (clean.length > 0 || draft !== null) && !send.isPending && !working;
  const submit = () => {
    if (!canSend) return;
    send.mutate({ body: clean, draft, parentId: replyTo?.commentId });
  };

  return (
    <View style={styles.bar}>
      {replyTo ? (
        <View style={styles.replyChip}>
          <Text style={styles.replyText} numberOfLines={1}>
            {t("comments.replyingTo", { name: replyTo.name })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("comments.cancelReply")}
            hitSlop={8}
            onPress={onCancelReply}
            style={({ pressed }) => [styles.chipClose, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={16} color={theme.colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      {draft ? (
        <View style={styles.draft}>
          <CommentAttachmentCard
            attachment={
              draft.type === "item"
                ? draft.item.preview
                : { kind: "image", title: "", date: null, mapLine: null, hasPhoto: true, stats: {} }
            }
            photo={
              draft.type === "photo"
                ? { type: "local", uri: draft.photo.localUri }
                : draft.item.photoId
                  ? { type: "diary", photoId: draft.item.photoId }
                  : null
            }
            style={styles.draftCard}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("comments.attach.remove")}
            hitSlop={8}
            onPress={() => setDraft(null)}
            style={({ pressed }) => [styles.draftRemove, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={14} color={theme.colors.background} />
          </Pressable>
        </View>
      ) : null}

      {menuOpen ? (
        <View style={styles.menu}>
          <Chip label={t("comments.attach.gallery")} onPress={() => void pickPhoto("gallery")} />
          <Chip label={t("comments.attach.camera")} onPress={() => void pickPhoto("camera")} />
          <Chip
            label={t("comments.attach.fromApp")}
            onPress={() => {
              setMenuOpen(false);
              setPickerOpen(true);
            }}
          />
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("comments.attach.add")}
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen((open) => !open)}
          style={({ pressed }) => [styles.roundButton, menuOpen && styles.roundButtonOn, pressed && styles.pressed]}
        >
          <Ionicons
            name={menuOpen ? "close" : "add"}
            size={22}
            color={menuOpen ? theme.colors.primaryForeground : theme.colors.foreground}
          />
        </Pressable>
        <Input
          ref={inputRef}
          value={body}
          onChangeText={setBody}
          maxLength={COMMENT_MAX}
          multiline
          placeholder={replyTo ? t("comments.replyPlaceholder") : t("comments.placeholder")}
          accessibilityLabel={t("comments.label")}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("comments.send")}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={submit}
          style={({ pressed }) => [styles.roundButton, styles.sendButton, !canSend && styles.sendOff, pressed && styles.pressed]}
        >
          {send.isPending || working ? (
            <ActivityIndicator size="small" color={theme.colors.primaryForeground} />
          ) : (
            <Ionicons name="send" size={18} color={theme.colors.primaryForeground} />
          )}
        </Pressable>
      </View>

      <AttachPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(item) => {
          setDraft({ type: "item", item });
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

/** "Dari aplikasi": the commenter's own recent items, one kind at a time. */
function AttachPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (item: CommentAttachable) => void;
}) {
  const { t } = useTranslation("feed");
  const [kind, setKind] = useState<CommentItemKind>("workout");
  const list = useQuery({
    ...orpc.social.commentAttachables.queryOptions({ input: { kind } }),
    enabled: visible,
  });
  const items = list.data?.items ?? [];

  return (
    <Sheet visible={visible} onClose={onClose} title={t("comments.attach.pickerTitle")}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
        {KINDS.map((k) => (
          <Chip key={k} label={t(`comments.attach.kind.${k}`)} selected={k === kind} onPress={() => setKind(k)} />
        ))}
      </ScrollView>
      {list.isPending ? (
        <View style={styles.pickerList}>
          <Skeleton width="100%" height={72} radius={18} />
          <Skeleton width="100%" height={72} radius={18} />
        </View>
      ) : list.isError ? (
        <Text style={styles.pickerNote}>{errorMessage(list.error)}</Text>
      ) : items.length === 0 ? (
        <Text style={styles.pickerNote}>
          {list.data?.notice === "mapOff" ? t("comments.attach.mapOff") : t(`comments.attach.empty.${kind}`)}
        </Text>
      ) : (
        <View style={styles.pickerList}>
          {items.map((item) => (
            <Pressable
              key={`${item.kind}:${item.refId}`}
              accessibilityRole="button"
              accessibilityLabel={item.preview.title || t(`comments.attach.kind.${item.kind}`)}
              onPress={() => onPick(item)}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <CommentAttachmentCard
                attachment={item.preview}
                photo={item.photoId ? { type: "diary", photoId: item.photoId } : null}
                style={styles.pickerCard}
              />
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    width: "100%",
    maxWidth: 640,
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  replyChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    minHeight: 36,
    paddingLeft: theme.spacing.md,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
  },
  replyText: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  chipClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  draft: {
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  draftCard: {
    maxWidth: 280,
  },
  draftRemove: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.foreground,
  },
  menu: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  roundButtonOn: {
    backgroundColor: theme.colors.primary,
  },
  sendButton: {
    backgroundColor: theme.colors.primary,
  },
  sendOff: {
    opacity: 0.4,
  },
  input: {
    flex: 1,
    minWidth: 0,
    maxHeight: 112,
  },
  kindRow: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  pickerList: {
    gap: theme.spacing.sm,
  },
  pickerCard: {
    maxWidth: "100%",
  },
  pickerNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  pressed: {
    opacity: 0.7,
  },
}));
