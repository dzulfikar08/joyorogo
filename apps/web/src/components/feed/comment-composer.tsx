import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Images, LayoutGrid, Loader2, Plus, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { CommentAttachmentCard } from "@/components/feed/comment-attachment";
import { photoUrl } from "@/components/sticker";
import type { CommentAttachable, CommentAttachment, CommentItemKind } from "@/lib/api-types";
import { compressImage } from "@/lib/compress-image";
import type { PendingPhoto } from "@/lib/compress-image";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

const COMMENT_MAX = 280;
const KINDS: CommentItemKind[] = ["workout", "food", "weight", "recap", "route"];

/** The one thing a draft comment carries: a photo not uploaded yet, or an item of the commenter's own. */
type Draft =
  | { type: "photo"; photo: PendingPhoto }
  | { type: "item"; item: CommentAttachable };

export type ReplyTarget = { commentId: string; topId: string; name: string };

/**
 * Composer under the comment list: text, an attach menu (Galeri / Kamera / Dari aplikasi), a reply chip. Sending a
 * photo uploads it first, then posts the comment with its id.
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
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const send = useOptimisticMutation<
    { body: string; draft: Draft | null; parentId: string | undefined },
    Awaited<ReturnType<AppRouterClient["social"]["addComment"]>>
  >({
    mutationFn: async (input) => {
      let attachment: Parameters<AppRouterClient["social"]["addComment"]>[0]["attachment"];
      if (input.draft?.type === "photo") {
        setBusy(t("comments.attach.uploading"));
        const uploaded = await client.social.uploadCommentPhoto({
          imageBase64: input.draft.photo.base64,
          mimeType: input.draft.photo.mimeType,
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
    invalidate: () => [orpc.social.key()],
    success: (_input, row) => {
      setBody("");
      setDraft(null);
      setBusy(null);
      onCancelReply();
      onSent(row.parentId);
      return {
        message: t("comments.toast.sent"),
        undo: () => {
          void client.social
            .deleteComment({ id: row.id })
            .then(() => queryClient.invalidateQueries({ queryKey: orpc.social.key() }));
        },
      };
    },
    onError: () => setBusy(null),
  });

  const addPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setMenuOpen(false);
    try {
      setBusy(t("comments.attach.uploading"));
      setDraft({ type: "photo", photo: await compressImage(file) });
    } catch {
      toast.error(t("comments.attach.photoError"));
    } finally {
      setBusy(null);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const clean = body.trim();
  const canSend = (clean.length > 0 || draft !== null) && !send.isPending && busy === null;
  const draftAttachment: CommentAttachment | null =
    draft?.type === "item"
      ? draft.item.preview
      : draft?.type === "photo"
        ? { kind: "image", title: "", date: null, mapLine: null, hasPhoto: true, stats: {} }
        : null;

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSend) return;
        send.mutate({ body: clean, draft, parentId: replyTo?.commentId });
      }}
    >
      {replyTo && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 [overflow-wrap:anywhere]">{t("comments.replyingTo", { name: replyTo.name })}</span>
          <button
            type="button"
            aria-label={t("comments.cancelReply")}
            className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            onClick={onCancelReply}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {pickerOpen && (
        <AttachPicker
          onPick={(item) => {
            setDraft({ type: "item", item });
            setPickerOpen(false);
            setMenuOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {draftAttachment && (
        <div className="relative w-fit max-w-full">
          <CommentAttachmentCard
            attachment={draftAttachment}
            photoSrc={
              draft?.type === "photo"
                ? draft.photo.localUrl
                : draft?.type === "item" && draft.item.photoId
                  ? photoUrl(draft.item.photoId)
                  : undefined
            }
            className="max-h-40"
          />
          <button
            type="button"
            aria-label={t("comments.attach.remove")}
            className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            onClick={() => setDraft(null)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {menuOpen && !pickerOpen && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("comments.attach.add")}>
          <Button type="button" variant="secondary" size="sm" onClick={() => galleryRef.current?.click()}>
            <Images aria-hidden />
            {t("comments.attach.gallery")}
          </Button>
          {coarsePointer && (
            <Button type="button" variant="secondary" size="sm" onClick={() => cameraRef.current?.click()}>
              <Camera aria-hidden />
              {t("comments.attach.camera")}
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
            <LayoutGrid aria-hidden />
            {t("comments.attach.fromApp")}
          </Button>
        </div>
      )}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => void addPhoto(event.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => void addPhoto(event.target.files)}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={menuOpen ? "default" : "secondary"}
          size="icon"
          aria-label={t("comments.attach.add")}
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((open) => !open);
            setPickerOpen(false);
          }}
        >
          <Plus className={cn("size-5 transition-transform", menuOpen && "rotate-45")} aria-hidden />
        </Button>
        <Input
          ref={inputRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={COMMENT_MAX}
          placeholder={replyTo ? t("comments.replyPlaceholder") : t("comments.placeholder")}
          aria-label={t("comments.label")}
        />
        <Button type="submit" size="icon" disabled={!canSend} aria-label={t("comments.send")}>
          {send.isPending || busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          {busy}
        </p>
      )}
    </form>
  );
}

/** "Dari aplikasi": the commenter's own recent items, one kind at a time. */
function AttachPicker({
  onPick,
  onClose,
}: {
  onPick: (item: CommentAttachable) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("feed");
  const [kind, setKind] = useState<CommentItemKind>("workout");
  const list = useQuery(orpc.social.commentAttachables.queryOptions({ input: { kind } }));
  const items = list.data?.items ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card p-2">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <p className="text-sm font-bold">{t("comments.attach.pickerTitle")}</p>
        <button
          type="button"
          aria-label={t("comments.cancelReply")}
          className="-mr-1 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div role="tablist" className="flex gap-1 overflow-x-auto pb-2 scrollbar-none">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            className={cn(
              "h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              k === kind ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setKind(k)}
          >
            {t(`comments.attach.kind.${k}`)}
          </button>
        ))}
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto overscroll-contain" role="tabpanel">
        {list.isPending ? (
          <>
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </>
        ) : list.error ? (
          <p className="px-1 py-3 text-sm text-destructive">{list.error.message}</p>
        ) : items.length === 0 ? (
          <p className="px-1 py-3 text-sm text-muted-foreground">
            {list.data?.notice === "mapOff" ? t("comments.attach.mapOff") : t(`comments.attach.empty.${kind}`)}
          </p>
        ) : (
          items.map((item) => (
            <button
              key={`${item.kind}:${item.refId}`}
              type="button"
              className="block w-full rounded-2xl text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              onClick={() => onPick(item)}
            >
              <CommentAttachmentCard
                attachment={item.preview}
                photoSrc={item.photoId ? photoUrl(item.photoId) : undefined}
                className="max-w-none hover:bg-muted"
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
