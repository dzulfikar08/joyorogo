import { ImagePlus, Share2, X } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";

import { Segmented } from "@/components/kit/surface";
import {
  defaultShareText,
  drawStoryCard,
  storyPhoto,
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

/** Dark checkerboard: the sticker is light text on transparent, so it needs a dark stage in both themes. */
const STICKER_STAGE =
  "bg-[conic-gradient(#1a1d1b_25%,#262a28_0_50%,#1a1d1b_0_75%,#262a28_0)] bg-[length:20px_20px]";

/**
 * Opens a preview sheet with the story templates (photo + stats, transparent
 * stats sticker, branded card) behind one segmented switcher (swipe works
 * too), lets the user swap the background photo, and hands the picked render
 * to the OS share sheet via the Web Share API (mobile Chrome/Safari offer
 * Instagram > Story there); on browsers without file sharing it downloads the
 * PNG instead. Pure data in — screens own their queries, the social feed can
 * reuse the same painters.
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
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Partial<Record<StoryTemplate, HTMLCanvasElement | null>>>({});
  /** Ignore scroll events until this time: a segmented tap animates the track. */
  const scrollLockUntil = useRef(0);

  const hasPhoto = photoSrc != null || storyPhoto(story) != null;
  const templates = useMemo(
    () => STORY_TEMPLATES.filter((candidate) => !candidate.needsPhoto || hasPhoto),
    [hasPhoto],
  );
  const activeTemplate = templates.find((candidate) => candidate.id === template) ?? templates[0];

  const scrollToTemplate = useCallback(
    (id: StoryTemplate, behavior: ScrollBehavior) => {
      const track = trackRef.current;
      const index = templates.findIndex((candidate) => candidate.id === id);
      if (!track || index < 0) return;
      scrollLockUntil.current = behavior === "smooth" ? Date.now() + 500 : 0;
      track.scrollTo({ left: index * track.clientWidth, behavior });
    },
    [templates],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    for (const candidate of templates) {
      const canvas = canvasRefs.current[candidate.id];
      if (!canvas) continue;
      drawStoryCard(canvas, story, candidate.id, photoSrc).catch((err: Error) => {
        if (!cancelled) toast.error(err.message || "Gagal membuat gambar.");
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, templates, story, photoSrc]);

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
      await drawStoryCard(canvas, story, activeTemplate?.id ?? "brand", photoSrc);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Gagal membuat gambar.");
      const name = fileName ?? `joyorogo-${story.kind}-${activeTemplate?.id ?? "brand"}.png`;
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
    // The photo template is always first; the track exists once the sheet is open.
    requestAnimationFrame(() => scrollToTemplate("photo", "smooth"));
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || busy}
        aria-label={label ? undefined : (ariaLabel ?? label)}
        onClick={() => {
          // Open on the first template (photo when the story has one).
          setTemplate(templates[0]?.id ?? "brand");
          setOpen(true);
        }}
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-sm flex-col rounded-3xl bg-card p-4 text-foreground shadow-float"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 pl-1">
              <h2 className="text-lg font-bold">Bagikan ke Story</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Tutup"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <Segmented
                label="Pilih tampilan story"
                value={activeTemplate?.id ?? "brand"}
                options={templates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.label,
                }))}
                onChange={(id) => {
                  setTemplate(id);
                  scrollToTemplate(id, "smooth");
                }}
              />

              <div className="rounded-2xl bg-muted py-3">
                <div
                  ref={trackRef}
                  className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
                  onScroll={(event) => {
                    if (Date.now() < scrollLockUntil.current) return;
                    const track = event.currentTarget;
                    const slide = Math.round(track.scrollLeft / track.clientWidth);
                    const next = templates[Math.min(Math.max(slide, 0), templates.length - 1)];
                    if (next) setTemplate(next.id);
                  }}
                >
                  {templates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="flex w-full shrink-0 snap-center justify-center"
                    >
                      <div
                        className={`aspect-[9/16] h-[min(50dvh,440px)] overflow-hidden rounded-xl ${
                          candidate.id === "sticker" ? STICKER_STAGE : "bg-card"
                        }`}
                      >
                        <canvas
                          ref={(canvas) => {
                            canvasRefs.current[candidate.id] = canvas;
                          }}
                          className="size-full object-contain"
                          aria-label={`Pratinjau ${candidate.label}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-center text-sm text-muted-foreground">{activeTemplate?.hint}</p>

              <label className="mx-auto inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-within:ring-[3px] focus-within:ring-ring/40">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    pickPhoto(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <ImagePlus className="size-4" aria-hidden />
                {hasPhoto ? "Ganti foto" : "Pakai fotoku"}
              </label>
            </div>

            <Button className="mt-3 w-full" disabled={busy} onClick={() => void share()}>
              <Share2 aria-hidden />
              {busy ? "Menyiapkan..." : "Bagikan"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
