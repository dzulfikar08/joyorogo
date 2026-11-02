import { useState } from "react";
import { useWindowDimensions } from "react-native";
import type { LayoutChangeEvent } from "react-native";

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

/**
 * Width of the box the caller attaches `onLayout` to, for drawings (charts) sized in pixels. The window width is no
 * guide where the app's scene is narrower than the window (iPhone Duo's outer display keeps a system column beside it),
 * so the chart follows the box it sits in. `fallback` is used until the first layout.
 */
export function useFillWidth(fallback: number): [number, (e: LayoutChangeEvent) => void] {
  const [measured, setMeasured] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.floor(e.nativeEvent.layout.width);
    if (next > 0) setMeasured((prev) => (prev === next ? prev : next));
  };
  return [measured ?? fallback, onLayout];
}
