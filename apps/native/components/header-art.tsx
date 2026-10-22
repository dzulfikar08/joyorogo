import "@/unistyles";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

import { HEADER_ART_HEIGHT, HEADER_ART_WIDTH, headerArtPaths } from "@/src/lib/header-art";

/** Crown gold of the mascot, one step darker on the light canvas so the paws stay visible. */
const GOLD_LIGHT = "#B8892B";
const GOLD_DARK = "#D9B25A";
/** A dark canvas lifts a faint motif more than a light one does, so dark draws it a little quieter. */
const DARK_STRENGTH = 0.8;

/**
 * The top-right motif of the main tab screens: a green dot grid and three gold paw prints fading out of the corner. Put it
 * first in a scrolling screen's content: it is absolutely placed, sits behind everything after it, ignores touches, is hidden
 * from screen readers and scrolls away with the header. Static, so reduced-motion settings have nothing to change.
 */
export function HeaderArt() {
  const { theme, rt } = useUnistyles();
  const dark = rt.themeName === "dark";
  const paths = useMemo(() => headerArtPaths(HEADER_ART_WIDTH, HEADER_ART_HEIGHT), []);
  const strength = dark ? DARK_STRENGTH : 1;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.corner}
    >
      <Svg width={HEADER_ART_WIDTH} height={HEADER_ART_HEIGHT}>
        {paths.map((path, index) => (
          <Path
            key={index}
            d={path.d}
            fill={path.tone === "grid" ? theme.colors.primary : dark ? GOLD_DARK : GOLD_LIGHT}
            fillOpacity={path.opacity * strength}
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  corner: {
    position: "absolute",
    top: 0,
    right: 0,
    width: HEADER_ART_WIDTH,
    height: HEADER_ART_HEIGHT,
    overflow: "hidden",
  },
});
