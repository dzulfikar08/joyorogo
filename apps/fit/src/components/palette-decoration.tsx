import { useTheme } from "@joyorogo/ui/hooks/use-theme";
import { useMemo } from "react";

import { KAWUNG_HEIGHT, KAWUNG_WIDTH, kawungPaths } from "@/lib/kawung";
import { usePalette } from "@/lib/palette";

/** A dark canvas lifts a faint motif more than a light one does, so dark draws it a little quieter (as the app does). */
const DARK_STRENGTH = 0.8;

/**
 * The Sogan palette's batik kawung, or the Titik palette's dot grid, in the top-right corner of the page, behind the content.
 * Static (they never animate) and decorative: hidden from assistive technology and from the pointer. Other palettes draw
 * nothing.
 */
export function PaletteDecoration() {
  const { id } = usePalette();
  const { resolvedTheme } = useTheme();
  const paths = useMemo(() => (id === "sogan" ? kawungPaths() : []), [id]);
  if (id === "titik") {
    // The dot-matrix of a display: grey dots 13 px apart, fading out toward the content (the app's `dots` motif).
    return (
      <div
        aria-hidden
        className="titik-dots pointer-events-none absolute top-0 right-0 z-0 h-44 w-[min(100%,20rem)]"
      />
    );
  }
  if (id !== "sogan") return null;
  const strength = resolvedTheme === "dark" ? DARK_STRENGTH : 1;
  return (
    <svg
      aria-hidden
      focusable="false"
      width={KAWUNG_WIDTH}
      height={KAWUNG_HEIGHT}
      viewBox={`0 0 ${KAWUNG_WIDTH} ${KAWUNG_HEIGHT}`}
      className="pointer-events-none absolute top-0 right-0 z-0 max-w-full"
    >
      {paths.map((path, index) => {
        const color = path.tone === "a" ? "var(--primary)" : "var(--bakar)";
        return path.kind === "fill" ? (
          <path key={index} d={path.d} fill={color} fillOpacity={path.opacity * strength} />
        ) : (
          <path
            key={index}
            d={path.d}
            fill="none"
            stroke={color}
            strokeWidth={path.strokeWidth}
            strokeOpacity={path.opacity * strength}
          />
        );
      })}
    </svg>
  );
}
