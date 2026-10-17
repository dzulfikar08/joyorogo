import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { i18n } from "@joyorogo/i18n";

import { Segmented } from "@/components/kit/surface";
import type { FeedPost } from "@/lib/api-types";
import { useSession } from "@/lib/auth-client";
import { OptimisticCache, useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

const STORY_MAX = 1000;
const PHOTOS_MAX = 4;
const LONG_EDGE = 1600;

type Pending = { localUrl: string; base64: string; mimeType: "image/jpeg" };

/**
 * Kompres ke sisi panjang ~1600px JPEG kualitas 0.8 lewat canvas; balikin
 * base64 murni (tanpa prefiks data URL) untuk unggahan.
 */
async function compressImage(file: File): Promise<Pending> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n.t("feed:composer.error.noCanvas"));
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { localUrl: dataUrl, base64, mimeType: "image/jpeg" };
}

/**
 * Sheet "Buat post" di feed: teks bebas (maks 1000) + 0-4 foto + penonton.
 * Foto dipampatkan di perangkat, diunggah satu-satu, lalu pos dibuat dengan
 * id fotonya. Sheet dibuka dari tombol plus di header feed.
 */
export function FeedComposerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("feed");
  const queryClient = useQueryClient();
  const session = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<"publik" | "grup">("grup");
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = PHOTOS_MAX - photos.length;
    if (room <= 0) {
      toast.error(t("composer.error.maxPhotos", { count: PHOTOS_MAX }));
      return;
    }
    const picked = Array.from(files).slice(0, room);
    for (const file of picked) {
      try {
        setBusy(t("composer.busy.processing"));
        const pending = await compressImage(file);
        setPhotos((prev) => [...prev, pending]);
      } catch {
        toast.error(t("composer.error.processFile", { name: file.name }));
      }
    }
    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  type ComposerInput = {
    caption: string;
    visibility: "publik" | "grup";
    photos: Pending[];
  };
  // Uploads + createPost as one mutation; the new post is inserted into the
  // feed caches once the server id exists, and the toast undo deletes it.
  const createPost = useOptimisticMutation<
    ComposerInput,
    Awaited<ReturnType<AppRouterClient["social"]["createPost"]>>
  >({
    mutationFn: async (input) => {
      const photoIds: string[] = [];
      for (let i = 0; i < input.photos.length; i++) {
        setBusy(t("composer.busy.uploading", { n: i + 1, total: input.photos.length }));
        const uploaded = await client.social.uploadPostPhoto({
          imageBase64: input.photos[i].base64,
          mimeType: input.photos[i].mimeType,
        });
        photoIds.push(uploaded.photoId);
      }
      setBusy(t("composer.busy.sharing"));
      return client.social.createPost({
        kind: "cerita",
        caption: input.caption || undefined,
        photoIds: photoIds.length > 0 ? photoIds : undefined,
        visibility: input.visibility,
      });
    },
    invalidate: () => [orpc.social.key()],
    success: (input, post) => {
      setCaption("");
      setPhotos([]);
      const author = session.data?.user;
      const feedCache = new OptimisticCache(queryClient);
      // Newest first: prepend to the first page of every feed/myPosts cache.
      const prepend = (data: { pages: Array<{ items: FeedPost[] }> }) => ({
        ...data,
        pages: data.pages.map((page, index) =>
          index === 0
            ? {
                ...page,
                items: [
                  {
                    id: post.id,
                    kind: "cerita",
                    title: "",
                    kcal: null,
                    durationMin: null,
                    photoId: null,
                    scanId: null,
                    macros: undefined,
                    stats: undefined,
                    photoCount: input.photos.length,
                    caption: input.caption || null,
                    visibility: post.visibility,
                    createdAt: new Date(),
                    author: {
                      id: author?.id ?? "",
                      name: author?.name ?? t("composer.fallbackName"),
                      handle: null,
                      image: author?.image ?? null,
                    },
                    kudosCount: 0,
                    commentCount: 0,
                    kudosByMe: false,
                  } satisfies FeedPost,
                  ...page.items,
                ],
              }
            : page,
        ),
      });
      feedCache.matching(orpc.social.feed.key(), prepend);
      feedCache.matching(orpc.social.myPosts.key(), prepend);
      return {
        message: t("composer.toast.posted"),
        undo: () => {
          const revert = new OptimisticCache(queryClient);
          const drop = (data: { pages: Array<{ items: FeedPost[] }> }) => ({
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== post.id),
            })),
          });
          revert.matching(orpc.social.feed.key(), drop);
          revert.matching(orpc.social.myPosts.key(), drop);
          void client.social.deletePost({ id: post.id });
        },
      };
    },
  });

  const submit = async () => {
    const text = caption.trim();
    if (text.length === 0 && photos.length === 0) {
      toast.error(t("composer.error.empty"));
      return;
    }
    setBusy(t("composer.busy.preparing"));
    try {
      await createPost.mutateAsync({ caption: text, visibility, photos });
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("composer.title")}>
      <div className="space-y-3">
        <Textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          maxLength={STORY_MAX}
          rows={4}
          placeholder={t("composer.placeholder")}
          aria-label={t("composer.label")}
        />
        <p className="text-right text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {caption.length}/{STORY_MAX}
        </p>

        {photos.length > 0 && (
          <ul className="grid grid-cols-4 gap-2" aria-label={t("composer.photos")}>
            {photos.map((photo, index) => (
              <li key={photo.localUrl} className="relative">
                <img
                  src={photo.localUrl}
                  alt={t("composer.photo", { n: index + 1 })}
                  className="aspect-square w-full rounded-xl bg-muted object-cover"
                />
                <button
                  type="button"
                  aria-label={t("composer.removePhoto", { n: index + 1 })}
                  className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-foreground text-background shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  onClick={() => setPhotos((prev) => prev.filter((p) => p !== photo))}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-hidden="true"
          onChange={(event) => void addFiles(event.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={photos.length >= PHOTOS_MAX || busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus className="size-4" aria-hidden />
          {photos.length > 0
            ? t("composer.addPhotoCount", { n: photos.length, max: PHOTOS_MAX })
            : t("composer.addPhoto")}
        </Button>

        <Segmented<"publik" | "grup">
          label={t("composer.audience")}
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "grup", label: t("visibility.friends") },
            { value: "publik", label: t("visibility.publik") },
          ]}
        />

        <Button className="w-full" disabled={busy !== null} onClick={() => void submit()}>
          {busy !== null ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {busy}
            </>
          ) : (
            <>
              <Send className="size-4" aria-hidden />
              {t("composer.submit")}
            </>
          )}
        </Button>
      </div>
    </Sheet>
  );
}
