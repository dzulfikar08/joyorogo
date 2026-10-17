import { INSTAGRAM_GLYPH_PATH, INSTAGRAM_GLYPH_VIEWBOX } from "@joyorogo/api/lib/instagram-glyph";

/**
 * Official Instagram glyph in one flat colour (currentColor), for the Instagram share target.
 * Artwork source and usage terms: packages/api/src/lib/instagram-glyph.ts.
 */
export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox={INSTAGRAM_GLYPH_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path fill="currentColor" d={INSTAGRAM_GLYPH_PATH} />
    </svg>
  );
}
