import { useWindowDimensions } from "react-native";

/** Widest a reading column gets on big screens (foldables unfolded, iPad); content centres inside the window. */
export const CONTENT_MAX_WIDTH = 640;
/** Widest a bottom sheet or dialog gets; centred on big screens instead of spanning the window. */
export const SHEET_MAX_WIDTH = 560;
/** Android's large-screen class: shortest side of 600dp or more (Galaxy Z Fold inner screen, tablets, iPad). */
const LARGE_MIN_DP = 600;
/** Below this height a screen is "short": Z Flip cover screen, a phone or foldable in landscape. */
const SHORT_MAX_DP = 600;

export type Layout = {
  width: number;
  height: number;
  /** Shortest side ≥ 600dp: foldable inner screen, tablet, iPad. */
  large: boolean;
  landscape: boolean;
  /** Little vertical room: sheets and fixed headers must scroll instead of assuming a tall phone. */
  short: boolean;
  /** Width of the centred content column: the window width, capped at CONTENT_MAX_WIDTH. */
  contentWidth: number;
};

export function layoutFor(width: number, height: number): Layout {
  return {
    width,
    height,
    large: Math.min(width, height) >= LARGE_MIN_DP,
    landscape: width > height,
    short: height < SHORT_MAX_DP,
    contentWidth: Math.min(width, CONTENT_MAX_WIDTH),
  };
}

/** Window-size facts for layout decisions; re-renders on fold/unfold, rotation and split screen. */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return layoutFor(width, height);
}
