import { Share2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";

import {
  defaultShareText,
  drawStoryCard,
  storyPhotoSrc,
  STORY_TEMPLATES,
  type StorySpec,
  type StoryTemplate,
} from "@/components/story/story-card";

type ShareStoryButtonProps = {
  story: StorySpec;
  /** Empty string renders the icon only (needs `ariaLabel`). */
  label?: string;
  ariaLabel?: string;
  /** Overrides the default share copy for the card kind. */
  text?: string;
  fileName?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
};

/**
 * Opens a preview sheet with the three story templates (photo + stats,
 * transparent stats sticker, branded card), lets the user swap the background
 * photo, and hands the picked render to the OS share sheet via the Web Share
 * API (mobile Chrome/Safari offer Instagram > Story there); on browsers
 * without file sharing it downloads the PNG instead. Pure data in — screens
 * own their queries, the social feed can reuse the same painters.
 */
export function ShareStoryButton({
  story,
  label = "Bagikan ke Story",
  ariaLabel,
  text,
  fileName,
  variant,
  size,
  className,
  disabled,
}: ShareStoryButtonProps) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<StoryTemplate>("brand");
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  const defaultPhoto = storyPhotoSrc(story);
  const effectivePhoto = photoSrc ?? defaultPhoto;
  const templates = useMemo(
    () => STORY_TEMPLATES.filter((candidate) => !candidate.needsPhoto || effectivePhoto != null),
    [effectivePhoto],
  );

  const renderTemplate = useCallback(
    (candidate: StoryTemplate, canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      void drawStoryCard(
        canvas,
        story,
        candidate,
        candidate === "photo" ? effectivePhoto : undefined,
      ).catch((err: Error) => toast.error(err.message || "Gagal membuat gambar."));
    },
    [story, effectivePhoto],
  );

  useEffect(() => {
    if (!open) return;
    setTemplate((current) =>
      templates.some((candidate) => candidate.id === current)
        ? current
        : (templates[0]?.id ?? "brand"),
    );
    templates.forEach((candidate, index) => {
      renderTemplate(candidate.id, canvasRefs.current[index] ?? null);
    });
  }, [open, templates, renderTemplate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const share = async () => {
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      await drawStoryCard(canvas, story, template, template === "photo" ? effectivePhoto : undefined);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Gagal membuat gambar.");
      const name = fileName ?? `joyorogo-${story.kind}-${template}.png`;
      const file = new File([blob], name, { type: "image/png" });

      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: text ?? defaultShareText(story) });
        setOpen(false);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        toast.info("Gambar diunduh, kirim manual ya. Browser ini belum dukung share langsung.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message || "Gagal membagikan.");
      }
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (photoSrc) URL.revokeObjectURL(photoSrc);
    setPhotoSrc(URL.createObjectURL(file));
    setTemplate("photo");
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || busy}
        aria-label={label ? undefined : (ariaLabel ?? label)}
        onClick={() => setOpen(true)}
      >
        {busy && label ? (
          "Menyiapkan..."
        ) : (
          <>
            <Share2 className="size-4" aria-hidden />
            {label}
          </>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Bagikan ke Story"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900 p-4 text-zinc-50 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-2xl pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onScroll={(event) => {
                const slide = Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth);
                setActive(Math.min(Math.max(slide, 0), templates.length - 1));
              }}
            >
              {templates.map((candidate, index) => (
                <div key={candidate.id} className="w-full shrink-0 snap-center">
                  <div className="mx-auto aspect-[9/16] h-[52dvh] overflow-hidden rounded-2xl bg-zinc-800">
                    <canvas
                      ref={(canvas) => {
                        canvasRefs.current[index] = canvas;
                        renderTemplate(candidate.id, canvas);
                      }}
                      className="h-full w-full object-contain"
                      aria-label={`Pratinjau ${candidate.label}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-center gap-2" role="tablist">
              {templates.map((candidate, index) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="tab"
                  aria-selected={index === active}
                  aria-label={candidate.label}
                  onClick={() => {
                    const track = canvasRefs.current[index]?.closest(".snap-x");
                    track?.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
                  }}
                  className={`h-2 cursor-pointer rounded-full transition-all ${
                    index === active ? "w-6 bg-primary" : "w-2 bg-white/25 hover:bg-white/40"
                  }`}
                />
              ))}
            </div>

            <div className="mt-2 min-h-10 text-center">
              <p className="text-sm font-bold">{templates[active]?.label}</p>
              <p className="text-xs text-zinc-400">{templates[active]?.hint}</p>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
              <label className="cursor-pointer rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/10 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    pickPhoto(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                {effectivePhoto ? "Pilih foto lain" : "Pakai fotoku"}
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 border-white/15 text-zinc-200 hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                Batal
              </Button>
              <Button className="flex-1" disabled={busy} onClick={() => void share()}>
                {busy ? "Menyiapkan..." : "Bagikan"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
