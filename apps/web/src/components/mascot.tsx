import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

/** Cut-outs in `public/mascot/*.webp`. Sources and notes: `assets/mascot/README.md`. Alt text: `misc:mascot.alt.<pose>`. */
const POSES = [
  "alert",
  "cheer",
  "determined",
  "gas",
  "happy",
  "head",
  "hero",
  "icon",
  "love",
  "mantap",
  "on-it",
  "peek",
  "ready",
  "relax",
  "sleepy",
  "surprised",
  "wink",
  "working",
] as const;

export type MascotPose = (typeof POSES)[number];
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
  const { t } = useTranslation("misc");
  const [width, height] = INTRINSIC[pose] ?? [512, 512];
  const sizeClass = pose === "peek" ? PEEK[size] : pose === "hero" ? TALL[size] : SQUARE[size];
  return (
    <img
      src={`/mascot/${pose}.webp`}
      alt={alt ?? t(`mascot.alt.${pose}`)}
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
