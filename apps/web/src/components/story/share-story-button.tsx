import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Ellipsis, ImagePlus, Loader2, Share2, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DEFAULT_LOCALE, matchLocale } from "@joyorogo/i18n";

import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import {
  availableTemplates,
  renderSlides,
  rogoWebFonts,
  selectTemplates,
  templateShowsName,
  type CanvasKind,
  type Scene,
  type StickerPrefs,
} from "@joyorogo/sticker";

import { Segmented } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { InstagramGlyph } from "@/components/story/instagram-glyph";
import {
  drawScene,
  ensureStickerFonts,
  loadBitmap,
  loadScenesImages,
  type SceneImages,
} from "@/components/story/paint";
import { defaultShareText, toRogoSpec, type StorySpec } from "@/components/story/story-spec";
import { useSession } from "@/lib/auth-client";
import { STORY_PREFS_KEY } from "@/lib/story-prefs";
import { usePlatform } from "@/lib/platform";
import { orpc } from "@/utils/orpc";

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
  /** Open on this kind (e.g. "streak") instead of the first one. */
  initialKind?: string;
  /** Offer only these kinds (e.g. the weight screen offers just "weight"). */
  kinds?: string[];
  /** Replaces the default button; call `open` to show the sheet. */
  renderTrigger?: (open: () => void) => ReactNode;
};

type Canvas = CanvasKind;

type Target = "instagram" | "copy" | "save" | "more";

type Prefs = { hideNumbers: boolean; showName: boolean; watermark: boolean };

const DEFAULT_PREFS: Prefs = { hideNumbers: true, showName: false, watermark: true };

function loadPrefs(): Prefs {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORY_PREFS_KEY) ?? "null");
    if (parsed === null || typeof parsed !== "object") return DEFAULT_PREFS;
    const read = (key: keyof Prefs) => {
      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === "boolean" ? value : DEFAULT_PREFS[key];
    };
    return { hideNumbers: read("hideNumbers"), showName: read("showName"), watermark: read("watermark") };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Checkerboard stage: a transparent sticker needs a backdrop that shows its transparency. */
const STICKER_STAGE_DARK =
  "bg-[conic-gradient(#1a1d1b_25%,#262a28_0_50%,#1a1d1b_0_75%,#262a28_0)] bg-[length:20px_20px]";
const STICKER_STAGE_LIGHT =
  "bg-[conic-gradient(#d9d6cf_25%,#eceae4_0_50%,#d9d6cf_0_75%,#eceae4_0)] bg-[length:20px_20px]";

/** Whether this browser can hand `count` PNGs to the OS share sheet (Web Share API level 2). */
function canShareImageFile(count = 1): boolean {
  try {
    return (
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({
        files: Array.from({ length: count }, (_, i) => new File([""], `story-${i + 1}.png`, { type: "image/png" })),
      })
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
 * The share sheet. A story is turned into a Scene by the sticker engine (packages/sticker)
 * for every template that fits the data; one canvas painter draws it at a fixed
 * 1080 px width whatever the screen is. Canvas switch (Story, Kotak, Stiker transparan),
 * a row of styles, options (hide weight numbers, show my name, the JoyoRogo mark that Pro
 * can remove, light or dark ink), "Pakai fotoku", then the targets.
 *
 * - Instagram and More hand the PNG to the OS share sheet via the Web Share API with the
 *   file. A browser cannot aim at one app, so Instagram only differs from More by leaving
 *   the caption out; it is hidden on desktop, and both hide where the browser cannot
 *   share files.
 * - Copy writes the PNG to the clipboard (a fallback message where the browser cannot),
 *   Save downloads it. Both are always shown, except that a carousel (several images, one
 *   per slide) has no Copy: the clipboard takes one image. Its Save downloads every slide
 *   as <name>-<n>.png, and Instagram / More hand all slides to one share call.
 *
 * Renders are cached per slide, template, photo and options, and the active ones are
 * prepared while the sheet is open, so a tap reaches navigator.share / clipboard.write
 * while the user gesture is still alive (Safari is strict about that).
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
  initialKind,
  kinds: onlyKinds,
  renderTrigger,
}: ShareStoryButtonProps) {
  const { t, i18n } = useTranslation(["makan", "common", "sticker"]);
  const { os } = usePlatform();
  const label = labelProp ?? t("story.share.shareToStory");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [canvasKind, setCanvasKind] = useState<Canvas | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ink, setInk] = useState<"dark" | "light" | null>(null);
  const [busyTarget, setBusyTarget] = useState<Target | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const pageRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const images = useRef<SceneImages>(new Map());
  const blobs = useRef(new Map<string, Promise<Blob>>());

  const session = useSession();
  const profile = useQuery({ ...orpc.profile.myProfile.queryOptions(), enabled: open });
  const isPro = profile.data?.tier === "founder";
  const firstName = session.data?.user.name?.trim().split(/\s+/)[0] || null;
  const locale = matchLocale(i18n.language) ?? DEFAULT_LOCALE;
  const mode = ink ?? (document.documentElement.classList.contains("dark") ? "dark" : "light");
  const watermark = isPro ? prefs.watermark : true;

  // The period card's own switch: not remembered between shares, the deficit shows unless this share hides it.
  const [hideDeficit, setHideDeficit] = useState(false);
  const { spec: baseSpec, images: storyImages } = useMemo(() => toRogoSpec(story), [story]);
  const spec = useMemo(
    () => (baseSpec.kind === "period" ? { ...baseSpec, hideDeficit } : baseSpec),
    [baseSpec, hideDeficit],
  );

  const stickerPrefs: StickerPrefs = useMemo(
    () => ({
      userName: prefs.showName ? firstName : null,
      photo: photoSrc ?? storyImages.photo ? { uri: (photoSrc ?? storyImages.photo)! } : null,
      cutout: storyImages.cutout ? { uri: storyImages.cutout } : null,
      options: { hideNumbers: prefs.hideNumbers, showName: prefs.showName && firstName !== null, watermark },
    }),
    [prefs.hideNumbers, prefs.showName, firstName, watermark, photoSrc, storyImages],
  );

  const templates = useMemo(() => (open ? availableTemplates(spec, stickerPrefs) : []), [open, spec, stickerPrefs]);
  // Kind first (Hari ini, Beruntun, ...), then its format, then its styles; see selectTemplates.
  const selection = useMemo(
    () => selectTemplates(templates, { kind, canvas: canvasKind, templateId }, onlyKinds),
    [templates, kind, canvasKind, templateId, onlyKinds],
  );
  const { kinds, activeKind, canvases, activeCanvas, styles: inCanvas, active } = selection;

  // One scene per image: a carousel template draws one per page, every other template exactly one.
  const scenes = useMemo(
    () =>
      active
        ? renderSlides({ template: active, spec, prefs: stickerPrefs, locale, mode, fonts: rogoWebFonts })
        : [],
    [active, spec, stickerPrefs, locale, mode],
  );
  const scene = scenes[0] ?? null;
  const isCarousel = scenes.length > 1;

  const showMore = canShareFiles;
  const showInstagram = canShareFiles && os !== "desktop";
  const showsName = active !== null && templateShowsName(active);
  const hasWeight = story.kind === "progress" && !story.maternal && story.weightGoalProgress != null;
  const periodHasWeight = story.kind === "period" && story.weight != null;
  const periodHasEnergy = story.kind === "period" && (story.energy?.countedDays ?? 0) > 0;

  // A day share's content changes with the diary and its failed cutouts, so it is part of the key.
  const cacheKey = scene && active
    ? `${active.id}|${mode}|${locale}|${JSON.stringify(stickerPrefs)}${spec.kind === "dayfood" ? `|${JSON.stringify(spec)}` : ""}`
    : "";

  /** One finished PNG, rendered once per slide, template, photo and options. */
  const renderBlob = useCallback(
    (index = 0): Promise<Blob> => {
      const key = `${cacheKey}#${index}`;
      const cached = blobs.current.get(key);
      if (cached) return cached;
      const pending = (async () => {
        const slide = scenes[index];
        if (!slide) throw new Error(t("story.share.makeImageFailed"));
        await ensureStickerFonts();
        await loadScenesImages([slide], images.current);
        const canvas = document.createElement("canvas");
        drawScene(canvas, slide, images.current);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
        if (!blob) throw new Error(t("story.share.makeImageFailed"));
        return blob;
      })();
      blobs.current.set(key, pending);
      pending.catch(() => blobs.current.delete(key));
      return pending;
    },
    [cacheKey, scenes, t],
  );

  /** Every slide's PNG in swipe order (a single-image template yields one). */
  const renderAll = () => Promise.all(scenes.map((_, index) => renderBlob(index)));

  useEffect(() => {
    if (!open) return;
    setCanShareFiles(canShareImageFile(Math.max(scenes.length, 1)));
    setPrefs(loadPrefs());
  }, [open, scenes.length]);

  // Draw the live preview (same painter as the export) once fonts and every slide's images are ready.
  useEffect(() => {
    if (!open || scenes.length === 0) return;
    let cancelled = false;
    setStatus("loading");
    (async () => {
      await ensureStickerFonts();
      await loadScenesImages(scenes, images.current);
      const canvases = scenes.length > 1 ? pageRefs.current.slice(0, scenes.length) : [previewRef.current];
      if (cancelled || canvases.length !== scenes.length || canvases.some((canvas) => !canvas)) return;
      scenes.forEach((slide, index) => drawScene(canvases[index]!, slide, images.current));
      setStatus("ready");
      // Warm the PNGs so the first tap does not wait on rendering.
      scenes.forEach((_, index) => renderBlob(index).catch(() => {}));
    })().catch((err: unknown) => {
      console.warn("sticker preview failed", err);
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [open, scenes, renderBlob, attempt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(STORY_PREFS_KEY, JSON.stringify(next));
    } catch {
      // Best-effort: the session keeps the choice either way.
    }
    void notePrefChanged("sticker", next);
  };

  const imageName = fileName ?? `joyorogo-${spec.kind}-${active?.id ?? "sticker"}.png`;
  // A carousel's files are numbered in swipe order: <name>-1.png, <name>-2.png, ...
  const slideFileName = (index: number) =>
    isCarousel ? `${imageName.replace(/\.png$/i, "")}-${index + 1}.png` : imageName;
  const ready = status === "ready" && scenes.length > 0;

  const runTarget = async (target: Target) => {
    if (busyTarget || !ready) return;
    setBusyTarget(target);
    try {
      if (target === "copy") {
        if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
          toast.error(t("story.share.copyUnsupported"));
          return;
        }
        try {
          // The promise form keeps the user gesture alive while the PNG finishes (Safari).
          await navigator.clipboard.write([new ClipboardItem({ "image/png": renderBlob() })]);
        } catch (err) {
          console.warn("story copy failed", err);
          toast.error(t("story.share.copyFailed"));
          return;
        }
        toast.success(t("story.share.copied"));
      } else if (target === "save") {
        const all = await renderAll();
        for (const [index, blob] of all.entries()) {
          // Browsers treat a burst of downloads as one gesture only when they are spaced a little.
          if (index > 0) await new Promise<void>((resolve) => setTimeout(resolve, 250));
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = slideFileName(index);
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
        toast.success(isCarousel ? t("story.share.savedMany", { count: all.length }) : t("story.share.saved"), {
          description: t("story.share.savedWebBody"),
        });
      } else {
        const files = (await renderAll()).map(
          (blob, index) => new File([blob], slideFileName(index), { type: "image/png" }),
        );
        if (isCarousel && !navigator.canShare?.({ files })) {
          toast.error(t("story.share.shareFailed"));
          return;
        }
        await navigator.share({
          files,
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

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      // Fail early (not at export time) for files the browser cannot decode.
      (await loadBitmap(url)).close();
    } catch {
      URL.revokeObjectURL(url);
      toast.error(t("story.share.photoFailedTitle"), { description: t("story.share.photoFailedBody") });
      return;
    }
    if (photoSrc) URL.revokeObjectURL(photoSrc);
    setPhotoSrc(url);
    setCanvasKind("story");
    setTemplateId(null);
    setKind(null);
  };

  const openSheet = () => {
    setKind(initialKind ?? null);
    setCanvasKind(null);
    setTemplateId(null);
    setHideDeficit(false);
    setOpen(true);
  };

  const stageOf = (slide: Scene) =>
    slide.transparent ? (mode === "light" ? STICKER_STAGE_LIGHT : STICKER_STAGE_DARK) : "bg-card";
  const stage = scene ? stageOf(scene) : "bg-card";
  const previewLabel = t("story.share.preview", {
    name: active ? t(`sticker:style.${active.style}`, { defaultValue: active.name }) : "",
  });
  // Loading veil and retry, drawn over each preview frame.
  const previewOverlay = (
    <>
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-black/40">
          <Loader2 className="size-7 animate-spin text-white motion-reduce:animate-none" aria-hidden />
        </div>
      )}
      {status === "error" && (
        <div role="alert" className="absolute inset-0 grid place-items-center gap-2 bg-black/60 p-4 text-center text-sm text-white">
          <p>{t("story.share.photoFailedBody")}</p>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {t("common:actions.retry")}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openSheet)
      ) : (
        <Button
          variant={variant}
          size={size}
          className={className}
          disabled={disabled}
          aria-label={label ? undefined : (ariaLabel ?? label)}
          onClick={openSheet}
        >
          <Share2 className="size-4" aria-hidden />
          {label}
        </Button>
      )}

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
              {kinds.length > 1 && (
                <Segmented
                  label={t("sticker:sheet.kind")}
                  value={activeKind}
                  options={kinds.map((k) => ({ value: k, label: t(`sticker:kind.${k}`, { defaultValue: k }) }))}
                  onChange={(next) => {
                    setKind(next);
                    setTemplateId(null);
                  }}
                />
              )}

              {canvases.length > 0 && (
                <Segmented
                  label={t("sticker:sheet.format")}
                  value={activeCanvas}
                  options={canvases.map((c) => ({ value: c, label: t(`sticker:canvas.${c}`) }))}
                  onChange={(next) => {
                    setCanvasKind(next);
                    setTemplateId(null);
                  }}
                />
              )}

              {isCarousel ? (
                <CarouselPager
                  key={active?.id}
                  scenes={scenes}
                  stageOf={stageOf}
                  canvasRefs={pageRefs}
                  label={(index) => `${previewLabel} ${index + 1} / ${scenes.length}`}
                  overlay={previewOverlay}
                />
              ) : (
                <div className="flex h-[calc(min(38dvh,360px)+1.5rem)] shrink-0 items-center justify-center rounded-2xl bg-muted">
                  {scene ? (
                    <div
                      className={`relative max-h-full max-w-full overflow-hidden rounded-xl ${stage}`}
                      style={{ aspectRatio: `${scene.width} / ${scene.height}`, height: "min(38dvh, 360px)" }}
                    >
                      <canvas ref={previewRef} className="size-full object-contain" aria-label={previewLabel} />
                      {previewOverlay}
                    </div>
                  ) : (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("sticker:sheet.empty")}</p>
                  )}
                </div>
              )}

              {inCanvas.length > 0 && (
                <Segmented
                  label={t("sticker:sheet.style")}
                  value={active?.id ?? ""}
                  options={inCanvas.map((tpl) => ({
                    value: tpl.id,
                    label: t(`sticker:style.${tpl.style}`, { defaultValue: tpl.name }),
                  }))}
                  onChange={setTemplateId}
                />
              )}

              <div className="flex flex-col gap-3">
                <Segmented
                  label={t("sticker:sheet.inkDark")}
                  value={mode}
                  options={[
                    { value: "dark", label: t("sticker:sheet.inkDark") },
                    { value: "light", label: t("sticker:sheet.inkLight") },
                  ]}
                  onChange={setInk}
                />
                {hasWeight && (
                  <OptionRow label={t("sticker:sheet.hideNumbers")}>
                    <Switch
                      label={t("sticker:sheet.hideNumbers")}
                      checked={prefs.hideNumbers}
                      onCheckedChange={(value) => updatePrefs({ hideNumbers: value })}
                    />
                  </OptionRow>
                )}
                {periodHasWeight && (
                  <OptionRow label={t("sticker:sheet.hideWeight")} hint={t("sticker:sheet.hideWeightHint")}>
                    <Switch
                      label={t("sticker:sheet.hideWeight")}
                      checked={prefs.hideNumbers}
                      onCheckedChange={(value) => updatePrefs({ hideNumbers: value })}
                    />
                  </OptionRow>
                )}
                {periodHasEnergy && (
                  <OptionRow label={t("sticker:sheet.hideDeficit")}>
                    <Switch
                      label={t("sticker:sheet.hideDeficit")}
                      checked={hideDeficit}
                      onCheckedChange={setHideDeficit}
                    />
                  </OptionRow>
                )}
                {firstName && (
                  <OptionRow
                    label={t("sticker:sheet.showName")}
                    hint={showsName ? undefined : t("sticker:sheet.nameUnavailable")}
                  >
                    <Switch
                      label={t("sticker:sheet.showName")}
                      disabled={!showsName}
                      checked={prefs.showName}
                      onCheckedChange={(value) => updatePrefs({ showName: value })}
                    />
                  </OptionRow>
                )}
                <OptionRow label={t("sticker:sheet.watermark")} hint={isPro ? undefined : t("sticker:sheet.proOnly")}>
                  <Switch
                    label={t("sticker:sheet.watermark")}
                    checked={watermark}
                    disabled={!isPro}
                    onCheckedChange={(value) => updatePrefs({ watermark: value })}
                  />
                </OptionRow>
              </div>

              {spec.kind !== "dayfood" && (
                <label className="mx-auto inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-within:ring-[3px] focus-within:ring-ring/40">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      void pickPhoto(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <ImagePlus className="size-4" aria-hidden />
                  {photoSrc ? t("story.share.changePhoto") : t("story.share.usePhoto")}
                </label>
              )}
            </div>

            <div role="group" aria-label={t("story.share.targets")} className="mt-3 flex justify-center gap-1">
              {showInstagram && (
                <TargetTile
                  label={t("story.share.instagram")}
                  busy={busyTarget === "instagram"}
                  disabled={busyTarget != null || !ready}
                  onClick={() => void runTarget("instagram")}
                >
                  <InstagramGlyph className="size-6" />
                </TargetTile>
              )}
              {!isCarousel && (
                <TargetTile
                  label={t("story.share.copy")}
                  busy={busyTarget === "copy"}
                  disabled={busyTarget != null || !ready}
                  onClick={() => void runTarget("copy")}
                >
                  <Copy className="size-6" aria-hidden />
                </TargetTile>
              )}
              <TargetTile
                label={t("story.share.save")}
                busy={busyTarget === "save"}
                disabled={busyTarget != null || !ready}
                onClick={() => void runTarget("save")}
              >
                <Download className="size-6" aria-hidden />
              </TargetTile>
              {showMore && (
                <TargetTile
                  label={t("story.share.more")}
                  busy={busyTarget === "more"}
                  disabled={busyTarget != null || !ready}
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

/**
 * The carousel preview: every slide as a frame in a scroll-snap row, swiped (or scrolled, or picked by its dot) one
 * page at a time. The dots mirror the page in view, so they are state, not decoration. Native scrolling needs no
 * animation, and the dot jump skips its smooth scroll under reduced motion.
 */
function CarouselPager({
  scenes,
  stageOf,
  canvasRefs,
  label,
  overlay,
}: {
  scenes: readonly Scene[];
  stageOf: (scene: Scene) => string;
  canvasRefs: { current: Array<HTMLCanvasElement | null> };
  label: (index: number) => string;
  overlay: ReactNode;
}) {
  const { t } = useTranslation(["sticker"]);
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const goTo = (index: number) => {
    const el = scroller.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: index * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
  };
  return (
    <>
      <div className="h-[calc(min(38dvh,360px)+1.5rem)] shrink-0 overflow-hidden rounded-2xl bg-muted">
        <div
          ref={scroller}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${page + 1} / ${scenes.length}`}
          tabIndex={0}
          onScroll={(event) => {
            const el = event.currentTarget;
            setPage(Math.min(scenes.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
          }}
          className="flex size-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain outline-none [scrollbar-width:none] focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset [&::-webkit-scrollbar]:hidden"
        >
          {scenes.map((slide, index) => (
            <div
              key={index}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} / ${scenes.length}`}
              className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center"
            >
              <div
                className={`relative max-h-full max-w-full overflow-hidden rounded-xl ${stageOf(slide)}`}
                style={{ aspectRatio: `${slide.width} / ${slide.height}`, height: "min(38dvh, 360px)" }}
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[index] = el;
                  }}
                  className="size-full object-contain"
                  aria-label={label(index)}
                />
                {overlay}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="-my-1 flex shrink-0 justify-center">
        {scenes.map((_, index) => (
          <button
            key={index}
            type="button"
            aria-label={`${index + 1} / ${scenes.length}`}
            aria-current={index === page ? "true" : undefined}
            onClick={() => goTo(index)}
            className="group grid h-6 w-5 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <span
              className={cn(
                "block h-1.5 rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none",
                index === page ? "w-4 bg-foreground" : "w-1.5 bg-foreground/25 group-hover:bg-foreground/50",
              )}
            />
          </button>
        ))}
      </div>
      <p className="-mt-1 shrink-0 text-center text-xs text-muted-foreground">
        {t("sticker:sheet.carouselHint", { count: scenes.length })}
      </p>
    </>
  );
}

function OptionRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-1">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
