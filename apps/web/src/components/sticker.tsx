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

type StickerProps = {
  scanId: string;
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

  const src = `${stickerUrl(scanId)}${attempt > 0 ? `?r=${attempt}` : ""}`;

  if (failed) return <>{fallback ?? null}</>;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShowPhoto(false);
          setOpen(true);
        }}
        disabled={!loaded}
        aria-label={t("sticker.view", { name })}
        className={`relative cursor-zoom-in overflow-hidden rounded-2xl bg-makan-soft disabled:cursor-default ${className ?? ""}`}
      >
        {!loaded && fallback ? (
          <span className="absolute inset-0 grid place-items-center">{fallback}</span>
        ) : null}
        <img
          key={src}
          src={src}
          alt={name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={`size-full object-contain p-[8%] ${loaded ? "" : "opacity-0"}`}
        />
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
                src={src}
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
                    scanId,
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

type FoodThumbProps = Pick<
  StickerProps,
  "scanId" | "photoId" | "name" | "kcal" | "protein" | "carbs" | "fat"
> & {
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
}: Omit<FoodThumbProps, "scanId"> & { scanId?: string | null }) {
  const fallback = (
    <span
      className={`flex items-center justify-center rounded-2xl bg-makan-soft ${className}`}
      aria-hidden
    >
      <Utensils className={`${iconClassName} text-makan-ink`} />
    </span>
  );
  if (!scanId) return fallback;
  return <Sticker scanId={scanId} className={`block ${className}`} fallback={fallback} {...sticker} />;
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
  ...sticker
}: Omit<FoodThumbProps, "scanId" | "className" | "iconClassName"> & {
  scanId?: string | null;
}) {
  if (!scanId) return null;
  return (
    <div className="flex justify-center">
      <FoodThumb scanId={scanId} className="size-36" iconClassName="size-10" {...sticker} />
    </div>
  );
}
