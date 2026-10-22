import { mealStickerTarget } from "@joyorogo/api/lib/meal-sticker";
import type { StickerRowLike } from "@joyorogo/api/lib/meal-sticker";
import { cn } from "@joyorogo/ui/lib/utils";
import { Utensils, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { MetaLine } from "@/components/meta-line";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { env } from "@/env.public";
import { fmtKcalLabel } from "@/lib/format";
import { getServerUrl } from "@/utils/orpc";

export function stickerUrl(scanId: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}/sticker/${scanId}`;
}

/** Original scan photo; the server only serves it to its owner's session. */
export function photoUrl(photoId: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}/photo/${photoId}`;
}

/** Photo of a shared feed post; the server checks the post's visibility.
 * Photos of a 'cerita' post append /{index} (0-3). */
export function postPhotoUrl(postId: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}/post-photo/${postId}`;
}

/** Photo of a comment attachment (an uploaded photo, or the photo of an attached meal); follows the post's visibility. */
export function commentPhotoUrl(commentId: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}/comment-photo/${commentId}`;
}

/** Die-cut look: thin white outline (four 1px hard shadows) over a soft drop shadow. Only the scan reveal and the full-size viewer/share use it; thumbnails stay plain. */
export const STICKER_FILTER = {
  filter:
    "drop-shadow(1px 0 0 #fff) drop-shadow(-1px 0 0 #fff) drop-shadow(0 1px 0 #fff) drop-shadow(0 -1px 0 #fff) drop-shadow(0 3px 4px rgb(0 0 0 / 0.28))",
} as const;

/** Same die-cut look at lightbox size: a ~4px outline (axes + diagonals) and a deeper shadow. */
const STICKER_FILTER_LARGE = {
  filter:
    "drop-shadow(4px 0 0 #fff) drop-shadow(-4px 0 0 #fff) drop-shadow(0 4px 0 #fff) drop-shadow(0 -4px 0 #fff) drop-shadow(3px 3px 0 #fff) drop-shadow(-3px 3px 0 #fff) drop-shadow(3px -3px 0 #fff) drop-shadow(-3px -3px 0 #fff) drop-shadow(0 12px 24px rgb(0 0 0 / 0.45))",
} as const;

/** Cutouts are made in the background after saving: retry briefly, then give up. */
const RETRY_DELAYS_MS = [3000, 6000, 12000];

function preload(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** Resolves true once the sticker loads (retrying while it is still being cut), false when it never does. */
export async function stickerReady(scanId: string, cancelled: () => boolean = () => false): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    if (await preload(`${stickerUrl(scanId)}${attempt > 0 ? `?r=${attempt}` : ""}`)) return true;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined || cancelled()) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (cancelled()) return false;
  }
}

/** The plate sticker once it loads, the component cutout until then (and for good if it never does). */
function useResolvedSticker(
  id: string | null,
  fallbackId: string | null | undefined,
  enabled: boolean,
): string | null {
  const [readyId, setReadyId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !id || !fallbackId) return;
    let cancelled = false;
    void stickerReady(id, () => cancelled).then((ok) => {
      if (ok && !cancelled) setReadyId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, id, fallbackId]);
  return fallbackId && readyId !== id ? fallbackId : id;
}

type StickerProps = {
  /** Thumbnail cutout; null for a row that only has a plate sticker (it still opens the viewer). */
  scanId: string | null;
  /** What the viewer shows and shares instead of `scanId`: the whole-plate sticker. */
  viewScanId?: string | null;
  /** Component cutout the viewer shows until the plate sticker loads, or for good if it cannot. */
  fallbackScanId?: string | null;
  /** The thumbnail shows the viewer's sticker too (plate header). */
  viewThumb?: boolean;
  photoId?: string | null;
  name: string;
  kcal?: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  className?: string;
  /** Shown while the cutout is not ready, or if it never arrives. */
  fallback?: ReactNode;
};

/**
 * Clickable sticker thumbnail with a full-size lightbox. Used in the diary
 * strip and the meal list — anywhere a sticker appears, tapping opens the
 * cutout at full size with its calorie caption, and the original photo of
 * the scan when it was kept. With macros passed, the lightbox also offers
 * the story share for that meal.
 */
export function Sticker({
  scanId,
  viewScanId,
  fallbackScanId,
  viewThumb,
  photoId,
  name,
  kcal,
  protein,
  carbs,
  fat,
  className,
  fallback,
}: StickerProps) {
  const { t } = useTranslation(["feed", "common"]);
  const [open, setOpen] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const viewId = useResolvedSticker(viewScanId ?? null, fallbackScanId, !!viewScanId && (!!viewThumb || open));
  const thumbId = viewThumb && viewScanId ? viewId : scanId;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onError = () => {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      setFailed(true);
      return;
    }
    setTimeout(() => setAttempt((n) => n + 1), delay);
  };

  const src = thumbId ? `${stickerUrl(thumbId)}${attempt > 0 ? `?r=${attempt}` : ""}` : "";
  const lightboxSrc = viewScanId && viewId ? stickerUrl(viewId) : src;

  if (failed) return <>{fallback ?? null}</>;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShowPhoto(false);
          setOpen(true);
        }}
        disabled={!!thumbId && !loaded}
        aria-label={t("sticker.view", { name })}
        className={`relative cursor-zoom-in overflow-hidden rounded-2xl bg-makan-soft disabled:cursor-default ${className ?? ""}`}
      >
        {(!thumbId || !loaded) && fallback ? (
          <span className="absolute inset-0 grid place-items-center">{fallback}</span>
        ) : null}
        {thumbId ? (
          <img
            key={src}
            src={src}
            alt={name}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={onError}
            className={`size-full object-contain p-[8%] ${loaded ? "" : "opacity-0"}`}
          />
        ) : null}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={showPhoto ? t("sticker.photo", { name }) : t("sticker.sticker", { name })}
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
          onClick={() => setOpen(false)}
        >
          <figure
            className="relative flex max-h-[85vh] max-w-[90vw] flex-col items-center"
            onClick={(event) => event.stopPropagation()}
          >
            {showPhoto && photoId ? (
              <img
                src={photoUrl(photoId)}
                alt={t("sticker.photo", { name })}
                className="max-h-[70vh] max-w-full rounded-2xl object-contain"
              />
            ) : (
              <img
                src={lightboxSrc}
                alt={name}
                className="max-h-[70vh] max-w-full object-contain"
                style={STICKER_FILTER_LARGE}
              />
            )}
            <figcaption className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-float">
                <MetaLine items={[name, kcal != null ? fmtKcalLabel(kcal) : null]} />
              </span>
              {photoId && (
                <button
                  type="button"
                  onClick={() => setShowPhoto((v) => !v)}
                  className="min-h-11 rounded-full bg-card px-4 text-sm font-semibold text-primary shadow-float focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  {showPhoto ? t("sticker.toSticker") : t("sticker.toPhoto")}
                </button>
              )}
              {kcal != null && (
                <ShareStoryButton
                  size="sm"
                  story={{
                    kind: "meal",
                    name,
                    kcal,
                    protein,
                    carbs,
                    fat,
                    scanId: viewScanId ? viewId : scanId,
                    photoId,
                  }}
                />
              )}
            </figcaption>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("common:actions.close")}
              className="absolute -right-2 -top-2 flex size-10 cursor-pointer items-center justify-center rounded-full bg-card shadow-float transition-transform duration-150 ease-out active:scale-95 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden />
            </button>
          </figure>
        </div>
      )}
    </>
  );
}

type FoodThumbProps = Omit<StickerProps, "scanId" | "className" | "fallback"> & {
  scanId?: string | null;
  /** Tailwind size class pair, e.g. "size-16". */
  className?: string;
  iconClassName?: string;
};

/**
 * Sticker-first leading visual for food rows and cards: the cutout when there is
 * one, otherwise a soft makan-tinted tile with a utensils icon.
 */
export function FoodThumb({
  scanId,
  className = "size-16",
  iconClassName = "size-6",
  ...sticker
}: FoodThumbProps) {
  const fallback = (
    <span
      className={`flex items-center justify-center rounded-2xl bg-makan-soft ${className}`}
      aria-hidden
    >
      <Utensils className={`${iconClassName} text-makan-ink`} />
    </span>
  );
  if (!scanId && !sticker.viewScanId) return fallback;
  return (
    <Sticker scanId={scanId ?? null} className={`block ${className}`} fallback={fallback} {...sticker} />
  );
}

type StickerTargetProps = Pick<
  StickerProps,
  "viewScanId" | "fallbackScanId" | "name" | "kcal" | "protein" | "carbs" | "fat" | "photoId"
>;

/**
 * Props, spread after the row's own, that make its sticker open and share the whole plate
 * when the scan has a plate sticker (name and numbers summed over the scan's rows in `rows`).
 * Empty for a row without one: its own cutout and numbers apply, as before plate stickers.
 */
export function useStickerTarget(): (
  anchor: StickerRowLike,
  rows: readonly StickerRowLike[],
  plateName?: string | null,
) => Partial<StickerTargetProps> {
  const { t } = useTranslation("scan");
  return (anchor, rows, plateName) => {
    const target = mealStickerTarget(
      anchor,
      rows,
      (first, count) => t("result.names.more", { first, count }),
      plateName,
    );
    if (!target?.plate) return {};
    return {
      viewScanId: target.scanId,
      fallbackScanId: target.fallbackScanId,
      name: target.name,
      kcal: target.kcal,
      protein: target.protein,
      carbs: target.carbs,
      fat: target.fat,
      photoId: target.photoId,
    };
  };
}

/**
 * Plain cutout on a makan-soft tile, no viewer: for places that already sit
 * inside a button (photo grid, chips). Falls back to the utensils icon.
 */
export function CutoutTile({
  scanId,
  className = "size-14",
  iconClassName = "size-5",
}: {
  scanId: string;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-makan-soft",
        className,
      )}
      aria-hidden
    >
      {failed ? (
        <Utensils className={cn("text-makan-ink", iconClassName)} />
      ) : (
        <img
          src={stickerUrl(scanId)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-contain p-[8%]"
        />
      )}
    </span>
  );
}

/**
 * Large plain cutout on a makan-soft tile at the top of a detail sheet. Tapping opens the
 * lightbox (cutout first; "Lihat foto asli" stays secondary there). Renders
 * nothing without a cutout so sheets without one keep their layout.
 */
export function StickerHero({
  scanId,
  viewScanId,
  ...sticker
}: Omit<FoodThumbProps, "scanId" | "className" | "iconClassName"> & {
  scanId?: string | null;
}) {
  if (!scanId && !viewScanId) return null;
  return (
    <div className="flex justify-center">
      <FoodThumb
        scanId={scanId}
        viewScanId={viewScanId}
        className="size-36"
        iconClassName="size-10"
        {...sticker}
      />
    </div>
  );
}
