import { cn } from "@joyorogo/ui/lib/utils";

/*
 * Real screenshots of the app (apps/web/public/landing/*.webp, 600 px wide,
 * 2x of a 390 px phone). Width and height are set so the frame reserves its
 * space before the image arrives. Numbers inside are demo data.
 */

export type LandingShot = "beranda" | "scan" | "makan" | "rekap" | "tidur" | "berat" | "grup";

const SHOT_W = 600;
const SHOT_H = 1298;

export function PhoneShot({
  shot,
  alt,
  priority = false,
  className,
}: {
  shot: LandingShot;
  alt: string;
  /** Above the fold: load eagerly and at high priority. */
  priority?: boolean;
  className?: string;
}) {
  const height = SHOT_H;
  return (
    <div
      className={cn(
        "mx-auto w-[min(100%,16.5rem)] rounded-[2.6rem] bg-[oklch(0.22_0.01_85)] p-[7px] shadow-float",
        className,
      )}
    >
      <div className="overflow-hidden rounded-[2.2rem] bg-background">
        <img
          src={`/landing/${shot}.webp`}
          alt={alt}
          width={SHOT_W}
          height={height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          className="block h-auto w-full"
        />
      </div>
    </div>
  );
}

/** Desktop capture in a plain browser frame. */
export function BrowserShot({ alt, className }: { alt: string; className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-float",
        className,
      )}
    >
      <div aria-hidden className="flex items-center gap-1.5 border-b border-border/70 px-4 py-3">
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="ml-3 rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground">
          joyorogo.com/beranda
        </span>
      </div>
      <img
        src="/landing/web-beranda.webp"
        alt={alt}
        width={1400}
        height={875}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
      />
    </div>
  );
}

/**
 * Hero: the scan result (photo → kcal, grams and macros per item) in a phone on a solid stage, real food cutouts
 * peeking from the corners (decorative). On phones the shot sits between the headline and the buttons, so it is
 * cropped to its top (total and first item) and fades out instead of pushing the buttons below the fold.
 */
export function HeroShot({ className }: { className?: string }) {
  return (
    <figure className={cn("reveal-in relative mx-auto w-full max-w-[22rem] md:max-w-[26rem]", className)}>
      <div
        aria-hidden
        className="absolute inset-x-4 top-10 bottom-6 rounded-[2.5rem] bg-makan-soft md:inset-x-0"
      />
      <img
        src="/food/nasi.webp"
        alt=""
        width={320}
        height={308}
        decoding="async"
        className="absolute -top-3 right-3 z-10 w-16 rotate-6 md:-right-4 md:top-6 md:w-28"
      />
      <img
        src="/food/ayam-bumbu-kuning.webp"
        alt=""
        width={320}
        height={300}
        decoding="async"
        className="absolute -right-2 bottom-16 z-10 hidden w-24 -rotate-6 md:-right-14 md:bottom-24 md:block md:w-32 md:animate-drift"
      />
      <div className="relative max-h-[22rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)] md:max-h-none md:overflow-visible md:[mask-image:none]">
        <PhoneShot
          shot="scan"
          priority
          alt="Hasil scan foto di JoyoRogo: total 400 kkal, soto daging 350 kkal (1 mangkuk, ±400 g, protein 20 g, karbo 25 g, lemak 18 g) dan bawang goreng 50 kkal"
          className="mt-4 w-[min(100%,13.5rem)] md:my-8 md:w-[min(100%,17.5rem)]"
        />
      </div>
      <figcaption className="relative pb-2 text-center text-xs text-muted-foreground">
        Tampilan asli aplikasi, dengan data contoh.
      </figcaption>
    </figure>
  );
}
