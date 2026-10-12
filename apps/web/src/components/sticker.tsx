import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { env } from "@/env.public";
import { fmtInt } from "@/lib/format";
import { getServerUrl } from "@/utils/orpc";

export function stickerUrl(scanId: string): string {
  return `${getServerUrl(env.VITE_SERVER_URL)}/sticker/${scanId}`;
}

const DROP_SHADOW = { filter: "drop-shadow(0 3px 4px rgb(0 0 0 / 0.28))" } as const;

type StickerProps = {
  scanId: string;
  name: string;
  kcal?: number;
  className?: string;
};

/**
 * Clickable sticker thumbnail with a full-size lightbox. Used in the diary
 * strip and the meal list — anywhere a sticker appears, tapping opens the
 * cutout at full size with its calorie caption.
 */
export function Sticker({ scanId, name, kcal, className }: StickerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Lihat stiker ${name}`}
        className={`cursor-zoom-in ${className ?? ""}`}
      >
        <img
          src={stickerUrl(scanId)}
          alt={name}
          loading="lazy"
          className="size-full object-contain"
          style={DROP_SHADOW}
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Stiker ${name}`}
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
          onClick={() => setOpen(false)}
        >
          <figure
            className="relative flex max-h-[85vh] max-w-[90vw] flex-col items-center"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={stickerUrl(scanId)}
              alt={name}
              className="max-h-[70vh] max-w-full object-contain"
              style={{ filter: "drop-shadow(0 12px 28px rgb(0 0 0 / 0.45))" }}
            />
            <figcaption className="mt-3 rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-float">
              {name}
              {kcal != null && (
                <span className="text-muted-foreground tabular-nums"> · {fmtInt(kcal)} kcal</span>
              )}
            </figcaption>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Tutup"
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

type MorphItem = { name: string; kcal: number };

/**
 * The scan-reveal moment: the original photo dissolves into its cutout
 * sticker, then per-item calorie chips pop in one by one. The sticker layer
 * activates only after it finishes loading so the crossfade is seamless; a
 * failed cutout keeps the plain photo (feature degrades silently).
 */
export function StickerMorph({
  photoUrl,
  scanId,
  items,
}: {
  photoUrl: string;
  scanId: string | null;
  items: MorphItem[];
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!scanId) return;
    const img = new Image();
    img.onload = () => setReady(true);
    img.onerror = () => setReady(false);
    img.src = stickerUrl(scanId);
  }, [scanId]);

  const morphed = ready && scanId !== null;

  return (
    <figure className="mx-auto w-full max-w-md text-center" aria-label="Foto berubah jadi stiker">
      <div className="relative mx-auto flex max-h-72 items-center justify-center">
        <img
          src={photoUrl}
          alt="Foto makanan"
          className={`max-h-72 max-w-full object-contain transition-[opacity,filter,transform] duration-500 ease-out ${
            morphed ? "sticker-photo-out" : ""
          }`}
        />
        {scanId && (
          <img
            src={stickerUrl(scanId)}
            alt=""
            aria-hidden
            className={`absolute inset-0 m-auto max-h-72 max-w-full object-contain ${
              morphed ? "sticker-morph-in" : "opacity-0"
            }`}
          />
        )}
      </div>
      <figcaption className="sr-only">Stiker potongan makananmu siap</figcaption>
      <ul
        className="mt-3 flex flex-wrap justify-center gap-2"
        aria-label="Rincian kalori per makanan"
      >
        {items.map((item, index) => (
          <li
            key={`${item.name}-${index}`}
            className={`rounded-full border bg-background px-3 py-1 text-xs tabular-nums ${
              morphed ? "chip-pop" : ""
            }`}
            style={morphed ? { animationDelay: `${850 + index * 70}ms` } : undefined}
          >
            {item.name} · <span className="font-medium">{item.kcal} kcal</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
