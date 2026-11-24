import { useRef } from "react";
import { cn } from "@joyorogo/ui/lib/utils";

/** The 41-second homepage demo (joyorogo-videos/homepage-scan): photo, per-item result, rice halved, Beranda, a colek. */
export const DEMO_VIDEO = {
  landscape: "/landing/demo/scan-16x9.mp4",
  landscapePoster: "/landing/demo/scan-16x9.jpg",
  portrait: "/landing/demo/scan-9x16.mp4",
  portraitPoster: "/landing/demo/scan-9x16.jpg",
  seconds: 41,
} as const;

/**
 * "Tonton demo" button for the hero. The video loads only when the dialog opens (no autoplay on the page, so the hero
 * keeps its LCP and phones on data spend nothing until asked); portrait file below 768 px, landscape from there
 * (picked when it opens).
 * Native <dialog>: Esc, the close button or a tap on the backdrop closes it and the video stops.
 */
export function DemoVideoButton({ className }: { className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const open = () => {
    dialog.current?.showModal();
    const v = video.current;
    if (!v) return;
    if (!v.getAttribute("src")) {
      const wide = window.matchMedia("(min-width: 768px)").matches;
      v.poster = wide ? DEMO_VIDEO.landscapePoster : DEMO_VIDEO.portraitPoster;
      v.src = wide ? DEMO_VIDEO.landscape : DEMO_VIDEO.portrait;
    }
    void v.play().catch(() => {});
  };
  const stop = () => {
    video.current?.pause();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-full text-sm font-semibold text-makan underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-makan",
          className,
        )}
      >
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-makan-soft">
          <svg viewBox="0 0 16 16" className="ml-0.5 size-3.5 fill-current">
            <path d="M4 2.5v11l9-5.5z" />
          </svg>
        </span>
        Tonton demo · {DEMO_VIDEO.seconds} detik
      </button>
      <dialog
        ref={dialog}
        aria-label="Video demo JoyoRogo"
        onClose={stop}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto w-[min(92vw,calc(82svh*9/16))] max-w-none rounded-3xl bg-transparent p-0 backdrop:bg-black/70 md:w-[min(92vw,1100px)]"
      >
        <div className="relative">
          <video
            ref={video}
            controls
            playsInline
            muted
            preload="none"
            className="block aspect-[9/16] w-full rounded-3xl bg-card md:aspect-video"
          />
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="absolute top-3 right-3 grid size-11 place-items-center rounded-full bg-black/55 text-xl font-bold text-white hover:bg-black/70"
            aria-label="Tutup video"
          >
            ×
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-white/80">
          Tampilan asli aplikasi dengan akun dan hasil AI contoh. Angka kalori selalu perkiraan.
        </p>
      </dialog>
    </>
  );
}
