import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Ellipsis, ImagePlus, Loader2, Share2, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DEFAULT_LOCALE, matchLocale } from "@joyorogo/i18n";

import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import { Button } from "@joyorogo/ui/components/button";
import {
  availableTemplates,
  renderSticker,
  rogoWebFonts,
  selectTemplates,
  templateShowsName,
  type CanvasKind,
  type StickerPrefs,
} from "@joyorogo/sticker";

import { Segmented } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { InstagramGlyph } from "@/components/story/instagram-glyph";
import {
  drawScene,
  ensureStickerFonts,
  loadBitmap,
  loadSceneImages,
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
 *   Save downloads it. Both are always shown.
 *
 * Renders are cached per template, photo and options, and the active one is prepared
 * while the sheet is open, so a tap reaches navigator.share / clipboard.write while the
 * user gesture is still alive (Safari is strict about that).
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

  const scene = useMemo(
    () =>
      active
        ? renderSticker({ template: active, spec, prefs: stickerPrefs, locale, mode, fonts: rogoWebFonts })
        : null,
    [active, spec, stickerPrefs, locale, mode],
  );

  const showMore = canShareFiles;
  const showInstagram = canShareFiles && os !== "desktop";
  const showsName = active !== null && templateShowsName(active);
  const hasWeight = story.kind === "progress" && !story.maternal && story.weightGoalProgress != null;
  const periodHasWeight = story.kind === "period" && story.weight != null;
  const periodHasEnergy = story.kind === "period" && (story.energy?.countedDays ?? 0) > 0;

  const cacheKey = scene && active ? `${active.id}|${mode}|${locale}|${JSON.stringify(stickerPrefs)}` : "";

  /** The finished PNG, rendered once per template, photo and options. */
  const renderBlob = useCallback((): Promise<Blob> => {
    const cached = blobs.current.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      if (!scene) throw new Error(t("story.share.makeImageFailed"));
      await ensureStickerFonts();
      await loadSceneImages(scene, images.current);
      const canvas = document.createElement("canvas");
      drawScene(canvas, scene, images.current);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
      if (!blob) throw new Error(t("story.share.makeImageFailed"));
      return blob;
    })();
    blobs.current.set(cacheKey, pending);
    pending.catch(() => blobs.current.delete(cacheKey));
    return pending;
  }, [cacheKey, scene, t]);

  useEffect(() => {
    if (!open) return;
    setCanShareFiles(canShareImageFile());
    setPrefs(loadPrefs());
  }, [open]);

  // Draw the live preview (same painter as the export) once fonts and images are ready.
  useEffect(() => {
    if (!open || !scene) return;
    let cancelled = false;
    setStatus("loading");
    (async () => {
      await ensureStickerFonts();
      await loadSceneImages(scene, images.current);
      const canvas = previewRef.current;
      if (cancelled || !canvas) return;
      drawScene(canvas, scene, images.current);
      setStatus("ready");
      // Warm the PNG so the first tap does not wait on rendering.
      renderBlob().catch(() => {});
    })().catch((err: unknown) => {
      console.warn("sticker preview failed", err);
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [open, scene, renderBlob, attempt]);

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
  const ready = status === "ready" && scene !== null;

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
        const url = URL.createObjectURL(await renderBlob());
        const a = document.createElement("a");
        a.href = url;
        a.download = imageName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast.success(t("story.share.saved"), { description: t("story.share.savedWebBody") });
      } else {
        const file = new File([await renderBlob()], imageName, { type: "image/png" });
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

  const stage = scene?.transparent ? (mode === "light" ? STICKER_STAGE_LIGHT : STICKER_STAGE_DARK) : "bg-card";

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

              <div className="flex h-[calc(min(38dvh,360px)+1.5rem)] shrink-0 items-center justify-center rounded-2xl bg-muted">
                {scene ? (
                  <div
                    className={`relative max-h-full max-w-full overflow-hidden rounded-xl ${stage}`}
                    style={{ aspectRatio: `${scene.width} / ${scene.height}`, height: "min(38dvh, 360px)" }}
                  >
                    <canvas
                      ref={previewRef}
                      className="size-full object-contain"
                      aria-label={t("story.share.preview", {
                        name: active ? t(`sticker:style.${active.style}`, { defaultValue: active.name }) : "",
                      })}
                    />
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
                  </div>
                ) : (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("sticker:sheet.empty")}</p>
                )}
              </div>

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
              <TargetTile
                label={t("story.share.copy")}
                busy={busyTarget === "copy"}
                disabled={busyTarget != null || !ready}
                onClick={() => void runTarget("copy")}
              >
                <Copy className="size-6" aria-hidden />
              </TargetTile>
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
