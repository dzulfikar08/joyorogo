import Svg, { Path } from "react-native-svg";

import { INSTAGRAM_GLYPH_PATH, INSTAGRAM_GLYPH_VIEWBOX } from "@joyorogo/api/lib/instagram-glyph";

/**
 * Official Instagram glyph in one flat colour, for the Instagram share target.
 * Artwork source and usage terms: packages/api/src/lib/instagram-glyph.ts.
 */
export function InstagramGlyph({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox={INSTAGRAM_GLYPH_VIEWBOX} accessibilityElementsHidden>
      <Path d={INSTAGRAM_GLYPH_PATH} fill={color} />
    </Svg>
  );
}
