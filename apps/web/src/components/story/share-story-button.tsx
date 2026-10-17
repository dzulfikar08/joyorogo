import { Copy, Download, Ellipsis, ImagePlus, Loader2, Share2, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";

import { Segmented } from "@/components/kit/surface";
import { usePlatform } from "@/lib/platform";
import { InstagramGlyph } from "@/components/story/instagram-glyph";
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

type Target = "instagram" | "copy" | "save" | "more";

/** Dark checkerboard: the sticker is light text on transparent, so it needs a dark stage in both themes. */
const STICKER_STAGE =
  "bg-[conic-gradient(#1a1d1b_25%,#262a28_0_50%,#1a1d1b_0_75%,#262a28_0)] bg-[length:20px_20px]";

/** Whether this browser can hand a PNG to the OS share sheet (Web Share API level 2). */
function canShareImageFile(): boolean {
  try {
    return (
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [new File([""], "story.png", { type: "image/png" })] })
    );
  } catch {
    return false;
  }
}

/** One big share target: round icon over label, spinner while its action runs. */
function TargetTile({
  label,
  busy,
  disabled,
  onClick,
  children,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
      className="group flex min-w-0 max-w-28 flex-1 flex-col items-center gap-2 rounded-2xl px-1 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-muted/70 group-active:scale-95 group-disabled:group-hover:bg-muted motion-reduce:transition-none">
        {busy ? (
          <Loader2 className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          children
        )}
      </span>
      <span className="max-w-full truncate text-sm font-semibold">{label}</span>
    </button>
  );
}

/**
 * Strava-style share sheet: a preview of the story card, a template switcher
 * (photo + stats, transparent stats sticker, branded card; swipe works too), a
 * photo swap, and the share targets.
 *
 * - Instagram and More hand the picked render to the OS share sheet via the
 *   Web Share API with the file (mobile Chrome/Safari list Instagram > Story
 *   there). A browser cannot aim at one app, so Instagram only differs from
 *   More by leaving the caption out; it is hidden on desktop, and both hide
 *   where the browser cannot share files.
 * - Copy writes the PNG to the clipboard (a fallback message where the browser
 *   cannot), Save downloads it. Both are always shown.
 *
 * Renders are cached per template and photo, and the active one is prepared
 * while the sheet is open, so a tap reaches navigator.share / clipboard.write
 * while the user gesture is still alive (Safari is strict about that).
 * Pure data in: screens own their queries, the social feed can reuse the same
 * painters.
 */
export function ShareStoryButton({
  story,
  label: labelProp,
  ariaLabel,
  text,
  fileName,
  variant,
  size,
  className,
  disabled,
}: ShareStoryButtonProps) {
  const { t } = useTranslation(["makan", "common"]);
  const { os } = usePlatform();
  const label = labelProp ?? t("story.share.shareToStory");
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<StoryTemplate>("brand");
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<Target | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Partial<Record<StoryTemplate, HTMLCanvasElement | null>>>({});
  const blobs = useRef(new Map<string, Promise<Blob>>());
  /** Ignore scroll events until this time: a segmented tap animates the track. */
  const scrollLockUntil = useRef(0);

  const hasPhoto = photoSrc != null || storyPhoto(story) != null;
  const templates = useMemo(
    () => STORY_TEMPLATES.filter((candidate) => !candidate.needsPhoto || hasPhoto),
    [hasPhoto],
  );
  const activeTemplate = templates.find((candidate) => candidate.id === template) ?? templates[0];
  const activeId = activeTemplate?.id ?? "brand";
  const showMore = canShareFiles;
  const showInstagram = canShareFiles && os !== "desktop";

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

  /** The finished PNG for a template, rendered once per story + photo. */
  const renderBlob = useCallback(
    (id: StoryTemplate): Promise<Blob> => {
      const key = `${id}|${photoSrc ?? ""}`;
      const cached = blobs.current.get(key);
      if (cached) return cached;
      const pending = (async () => {
        const canvas = document.createElement("canvas");
        await drawStoryCard(canvas, story, id, photoSrc);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/png"),
        );
        if (!blob) throw new Error(t("story.share.makeImageFailed"));
        return blob;
      })();
      blobs.current.set(key, pending);
      pending.catch(() => blobs.current.delete(key));
      return pending;
    },
    [story, photoSrc, t],
  );

  useEffect(() => {
    if (!open) return;
    setCanShareFiles(canShareImageFile());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    blobs.current.clear();
    for (const candidate of templates) {
      const canvas = canvasRefs.current[candidate.id];
      if (!canvas) continue;
      drawStoryCard(canvas, story, candidate.id, photoSrc).catch((err: Error) => {
        if (!cancelled) toast.error(err.message || t("story.share.makeImageFailed"));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, templates, story, photoSrc, t]);

  // Warm the active template's PNG so the first tap does not wait on rendering.
  useEffect(() => {
    if (open) renderBlob(activeId).catch(() => {});
  }, [open, activeId, renderBlob]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const imageName = fileName ?? `joyorogo-${story.kind}-${activeId}.png`;

  const runTarget = async (target: Target) => {
    if (busyTarget) return;
    setBusyTarget(target);
    try {
      if (target === "copy") {
        if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
          toast.error(t("story.share.copyUnsupported"));
          return;
        }
        try {
          // The promise form keeps the user gesture alive while the PNG finishes (Safari).
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": renderBlob(activeId) }),
          ]);
        } catch (err) {
          console.warn("story copy failed", err);
          toast.error(t("story.share.copyFailed"));
          return;
        }
        toast.success(t("story.share.copied"));
      } else if (target === "save") {
        const url = URL.createObjectURL(await renderBlob(activeId));
        const a = document.createElement("a");
        a.href = url;
        a.download = imageName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast.success(t("story.share.saved"), { description: t("story.share.savedWebBody") });
      } else {
        const file = new File([await renderBlob(activeId)], imageName, { type: "image/png" });
        await navigator.share({
          files: [file],
          ...(target === "more" ? { text: text ?? defaultShareText(story) } : {}),
        });
        setOpen(false);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message || t("story.share.shareFailed"));
      }
    } finally {
      setBusyTarget(null);
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
        disabled={disabled}
        aria-label={label ? undefined : (ariaLabel ?? label)}
        onClick={() => {
          // Open on the first template (photo when the story has one).
          setTemplate(templates[0]?.id ?? "brand");
          setOpen(true);
        }}
      >
        <Share2 className="size-4" aria-hidden />
        {label}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("story.share.shareToStory")}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-sm flex-col rounded-3xl bg-card p-4 text-foreground shadow-float"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 pl-1">
              <h2 className="text-lg font-bold">{t("story.share.shareToStory")}</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common:actions.close")}
                onClick={() => setOpen(false)}
              >
                <X aria-hidden />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <Segmented
                label={t("story.share.pickTemplate")}
                value={activeId}
                options={templates.map((candidate) => ({
                  value: candidate.id,
                  label: t(`story.card.template.${candidate.id}.label`),
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
                        className={`aspect-[9/16] h-[min(38dvh,360px)] overflow-hidden rounded-xl ${
                          candidate.id === "sticker" ? STICKER_STAGE : "bg-card"
                        }`}
                      >
                        <canvas
                          ref={(canvas) => {
                            canvasRefs.current[candidate.id] = canvas;
                          }}
                          className="size-full object-contain"
                          aria-label={t("story.share.preview", {
                            name: t(`story.card.template.${candidate.id}.label`),
                          })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                {activeTemplate ? t(`story.card.template.${activeTemplate.id}.hint`) : null}
              </p>

              <label className="mx-auto inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-within:ring-[3px] focus-within:ring-ring/40">
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
                {hasPhoto ? t("story.share.changePhoto") : t("story.share.usePhoto")}
              </label>
            </div>

            <div
              role="group"
              aria-label={t("story.share.targets")}
              className="mt-3 flex justify-center gap-1"
            >
              {showInstagram && (
                <TargetTile
                  label={t("story.share.instagram")}
                  busy={busyTarget === "instagram"}
                  disabled={busyTarget != null}
                  onClick={() => void runTarget("instagram")}
                >
                  <InstagramGlyph className="size-6" />
                </TargetTile>
              )}
              <TargetTile
                label={t("story.share.copy")}
                busy={busyTarget === "copy"}
                disabled={busyTarget != null}
                onClick={() => void runTarget("copy")}
              >
                <Copy className="size-6" aria-hidden />
              </TargetTile>
              <TargetTile
                label={t("story.share.save")}
                busy={busyTarget === "save"}
                disabled={busyTarget != null}
                onClick={() => void runTarget("save")}
              >
                <Download className="size-6" aria-hidden />
              </TargetTile>
              {showMore && (
                <TargetTile
                  label={t("story.share.more")}
                  busy={busyTarget === "more"}
                  disabled={busyTarget != null}
                  onClick={() => void runTarget("more")}
                >
                  <Ellipsis className="size-6" aria-hidden />
                </TargetTile>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
