import { Button } from "@joyorogo/ui/components/button";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Card } from "@/components/kit/surface";
import { Segmented } from "@/components/kit/surface";
import { useSession } from "@/lib/auth-client";
import { Avatar } from "@/components/avatar";
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
  if (!context) throw new Error("Browser tidak mendukung pengolahan gambar.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { localUrl: dataUrl, base64, mimeType: "image/jpeg" };
}

/**
 * Kartu "Buat post" di atas feed: teks bebas (maks 1000) + 0-4 foto +
 * penonton. Foto dipampatkan di perangkat, diunggah satu-satu, lalu pos
 * dibuat dengan id fotonya.
 */
export function FeedComposer() {
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
      toast.error(`Maksimal ${PHOTOS_MAX} foto per post.`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    for (const file of picked) {
      try {
        setBusy("Memproses foto...");
        const pending = await compressImage(file);
        setPhotos((prev) => [...prev, pending]);
      } catch {
        toast.error(`Gagal memproses ${file.name}.`);
      }
    }
    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async () => {
    const text = caption.trim();
    if (text.length === 0 && photos.length === 0) {
      toast.error("Tulis cerita dulu atau lampirkan satu foto.");
      return;
    }
    setBusy("Menyiapkan...");
    try {
      const photoIds: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setBusy(`Mengunggah foto ${i + 1}/${photos.length}...`);
        const uploaded = await client.social.uploadPostPhoto({
          imageBase64: photos[i].base64,
          mimeType: photos[i].mimeType,
        });
        photoIds.push(uploaded.photoId);
      }
      setBusy("Membagikan...");
      await client.social.createPost({
        kind: "cerita",
        caption: text || undefined,
        photoIds: photoIds.length > 0 ? photoIds : undefined,
        visibility,
      });
      toast.success("Post kamu muncul di feed.");
      setCaption("");
      setPhotos([]);
      queryClient.invalidateQueries({ queryKey: orpc.social.key() });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membagikan post.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar
          name={session.data?.user.name ?? "Kamu"}
          image={session.data?.user.image ?? null}
          className="size-10"
        />
        <Textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          maxLength={STORY_MAX}
          rows={3}
          placeholder="Ada cerita hari ini? Ceritakan perjalananmu..."
          aria-label="Tulis post"
          className="flex-1"
        />
      </div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-4 gap-2" aria-label="Foto terlampir">
          {photos.map((photo, index) => (
            <li key={photo.localUrl} className="relative">
              <img
                src={photo.localUrl}
                alt={`Foto ${index + 1}`}
                className="aspect-square w-full rounded-xl bg-muted object-cover"
              />
              <button
                type="button"
                aria-label={`Buang foto ${index + 1}`}
                className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-foreground text-background shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                onClick={() => setPhotos((prev) => prev.filter((p) => p !== photo))}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
          Foto
        </Button>
        <Segmented<"publik" | "grup">
          label="Penonton post"
          value={visibility}
          onChange={setVisibility}
          className="text-xs"
          options={[
            { value: "grup", label: "Teman grup" },
            { value: "publik", label: "Publik" },
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {caption.length}/{STORY_MAX}
        </span>
        <Button size="sm" disabled={busy !== null} onClick={() => void submit()}>
          {busy !== null ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {busy}
            </>
          ) : (
            <>
              <Send className="size-4" aria-hidden />
              Posting
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
