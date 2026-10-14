import { cn } from "@joyorogo/ui/lib/utils";

/** Cut-outs in `public/mascot/*.webp`. Sources and notes: `assets/mascot/README.md`. */
const ALT = {
  alert: "Joyo kaget dengan mata terbelalak",
  cheer: "Joyo mengepalkan tangan, semangat",
  determined: "Joyo dengan tatapan penuh tekad",
  gas: "Joyo mengepal tangan dengan tulisan Gas",
  happy: "Joyo tertawa senang",
  head: "Kepala Joyo",
  hero: "Joyo berdiri gagah",
  icon: "Ikon JoyoRogo",
  love: "Joyo memeluk hati",
  mantap: "Joyo mengacungkan jempol dengan tulisan Mantap",
  "on-it": "Joyo mengetik di laptop dengan tulisan On it",
  peek: "Joyo mengintip dari bawah",
  ready: "Joyo berdiri siap beraksi",
  relax: "Joyo bersantai",
  sleepy: "Joyo tidur meringkuk",
  surprised: "Joyo terkejut",
  wink: "Joyo mengedip",
  working: "Joyo bekerja dengan laptop",
} as const;

export type MascotPose = keyof typeof ALT;
export type MascotSize = "sm" | "md" | "lg" | "xl";

// Fixed class maps: Tailwind only emits classes it can see as literals.
const SQUARE: Record<MascotSize, string> = {
  sm: "size-[72px]",
  md: "size-[120px]",
  lg: "size-44",
  xl: "size-60 md:size-72",
};

// `peek` is a wide strip (881x384), so its size steps are widths.
const PEEK: Record<MascotSize, string> = {
  sm: "w-[120px]",
  md: "w-[200px]",
  lg: "w-[260px]",
  xl: "w-[260px] md:w-[360px]",
};

// `hero` is tall (560x875): size steps are heights.
const TALL: Record<MascotSize, string> = {
  sm: "h-24",
  md: "h-40",
  lg: "h-60",
  xl: "h-72 md:h-96",
};

const INTRINSIC: Partial<Record<MascotPose, [number, number]>> = {
  peek: [881, 384],
  hero: [560, 875],
};

/** Joyo cut-out. Lazy by default; pass `eager` for above-the-fold art.
 * Renders provider-free so it also works inside the error screens. */
export function Mascot({
  pose,
  size = "md",
  alt,
  eager = false,
  className,
}: {
  pose: MascotPose;
  size?: MascotSize;
  alt?: string;
  eager?: boolean;
  className?: string;
}) {
  const [width, height] = INTRINSIC[pose] ?? [512, 512];
  const sizeClass = pose === "peek" ? PEEK[size] : pose === "hero" ? TALL[size] : SQUARE[size];
  return (
    <img
      src={`/mascot/${pose}.webp`}
      alt={alt ?? ALT[pose]}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={cn(
        "mx-auto max-w-full shrink-0 select-none object-contain",
        pose === "peek" ? "h-auto" : pose === "hero" ? "w-auto" : "",
        sizeClass,
        className,
      )}
    />
  );
}
