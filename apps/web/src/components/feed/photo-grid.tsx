import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@joyorogo/ui/lib/utils";

import { postPhotoUrl } from "@/components/sticker";

/** URL foto ke-i milik satu post; lewat pemeriksaan visibility server. */
function photoAt(postId: string, index: number): string {
  return `${postPhotoUrl(postId)}/${index}`;
}

/**
 * Penampil layar penuh: klik latar/X menutup, panah + tombol keyboard
 * (kiri/kanan/Esc) pindah foto. Swipe mengikuti native? Di web pakai panah.
 */
function Viewer({
  postId,
  count,
  index,
  onClose,
  onMove,
}: {
  postId: string;
  count: number;
  index: number;
  onClose: () => void;
  onMove: (next: number) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onMove(Math.min(count - 1, index + 1));
      if (event.key === "ArrowLeft") onMove(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, index, onClose, onMove]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${index + 1} dari ${count}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Tutup penampil"
        className="absolute top-3 right-3 grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-[3px] focus-visible:ring-white/50 focus-visible:outline-none"
        onClick={onClose}
      >
        <X className="size-5" aria-hidden />
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Foto sebelumnya"
            disabled={index === 0}
            className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30 focus-visible:ring-[3px] focus-visible:ring-white/50 focus-visible:outline-none"
            onClick={(event) => {
              event.stopPropagation();
              onMove(index - 1);
            }}
          >
            <ChevronLeft className="size-6" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Foto berikutnya"
            disabled={index === count - 1}
            className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30 focus-visible:ring-[3px] focus-visible:ring-white/50 focus-visible:outline-none"
            onClick={(event) => {
              event.stopPropagation();
              onMove(index + 1);
            }}
          >
            <ChevronRight className="size-6" aria-hidden />
          </button>
        </>
      )}
      <img
        src={photoAt(postId, index)}
        alt={`Foto ${index + 1} dari ${count}`}
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(event) => event.stopPropagation()}
      />
      {count > 1 && (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white tabular-nums">
          {index + 1}/{count}
        </span>
      )}
    </div>
  );
}

/**
 * Grid foto post 'cerita': 1 foto penuh, 2 berdampingan, 3-4 grid dua kolom
 * (foto pertama melebar saat ganjil). Klik membuka penampil layar penuh.
 */
export function PhotoGrid({ postId, count }: { postId: string; count: number }) {
  const [open, setOpen] = useState<number | null>(null);
  if (count <= 0) return null;

  const cells =
    count === 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-2"
        : "grid-cols-2 [&>figure:first-child]:col-span-2";

  return (
    <>
      <div className={cn("grid gap-1 overflow-hidden rounded-2xl", cells)}>
        {Array.from({ length: Math.min(count, 4) }, (_, index) => (
          <figure key={index} className="m-0">
            <button
              type="button"
              aria-label={`Buka foto ${index + 1}`}
              className="block w-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              onClick={() => setOpen(index)}
            >
              <img
                src={photoAt(postId, index)}
                alt={`Foto ${index + 1} dari post`}
                loading="lazy"
                className={cn(
                  "w-full bg-muted object-cover",
                  count === 1 ? "max-h-96 aspect-[4/3]" : "aspect-square",
                )}
              />
            </button>
          </figure>
        ))}
      </div>
      {open !== null && (
        <Viewer
          postId={postId}
          count={count}
          index={open}
          onClose={() => setOpen(null)}
          onMove={setOpen}
        />
      )}
    </>
  );
}
