import { cn } from "@joyorogo/ui/lib/utils";

/**
 * Third-party brand tiles for rows. One component per app, inline SVG, 36px
 * rounded square (radius 9). Always render the brand name next to it as the
 * row title. Rules: docs/brand-marks.md.
 *
 * Strava: the symbol (chevron mark) white on #FC5200. Strava's API kit ships
 * only wordmark lockups and no stand-alone symbol, so this is a factual
 * feature-row reference to the service, not an app icon.
 */
const BRANDS = {
  strava: {
    bg: "#FC5200",
    viewBox: "0 0 24 24",
    path: "M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169",
  },
} as const;

export type Brand = keyof typeof BRANDS;

export function BrandMark({
  brand,
  size = 36,
  className,
}: {
  brand: Brand;
  size?: number;
  className?: string;
}) {
  const spec = BRANDS[brand];
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size, borderRadius: 9, backgroundColor: spec.bg }}
    >
      <svg viewBox={spec.viewBox} fill="#fff" style={{ width: "58%", height: "58%" }}>
        <path d={spec.path} />
      </svg>
    </span>
  );
}
