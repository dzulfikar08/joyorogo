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

/** Hero: Beranda in a phone on a solid stage, real food cutouts peeking from the corners (decorative). */
export function HeroShot() {
  return (
    <figure className="reveal-in relative mx-auto w-full max-w-[22rem] md:max-w-[26rem]">
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
        className="absolute -top-5 right-1 z-10 w-20 rotate-6 md:-right-4 md:top-6 md:w-28"
      />
      <img
        src="/food/ayam-bumbu-kuning.webp"
        alt=""
        width={320}
        height={300}
        decoding="async"
        className="absolute -right-2 bottom-16 z-10 hidden w-24 -rotate-6 md:-right-14 md:bottom-24 md:block md:w-32 md:animate-drift"
      />
      <PhoneShot
        shot="beranda"
        priority
        alt="Beranda JoyoRogo: sisa 735 kkal hari ini dari target 1.635, protein, aktivitas, tidur, air, dan berat"
        className="relative my-8 w-[min(100%,17.5rem)]"
      />
      <figcaption className="relative pb-2 text-center text-xs text-muted-foreground">
        Tampilan asli aplikasi, dengan data contoh.
      </figcaption>
    </figure>
  );
}
