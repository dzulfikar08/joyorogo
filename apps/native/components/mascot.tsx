import { useTranslation } from "react-i18next";
import { Image, type ImageSourcePropType, type StyleProp, type ImageStyle } from "react-native";

// Metro bundles exactly the poses listed here, so add a pose only when a
// screen uses it. Sources and notes: assets/mascot/README.md. Captions:
// `misc:mascot.alt.<pose>`.
const POSES = {
  cheer: { source: require("@/assets/mascot/cheer.webp") },
  determined: { source: require("@/assets/mascot/determined.webp") },
  hero: { source: require("@/assets/mascot/hero.webp") },
  mantap: { source: require("@/assets/mascot/mantap.webp") },
  peek: { source: require("@/assets/mascot/peek.webp") },
  ready: { source: require("@/assets/mascot/ready.webp") },
  relax: { source: require("@/assets/mascot/relax.webp") },
  sleepy: { source: require("@/assets/mascot/sleepy.webp") },
  surprised: { source: require("@/assets/mascot/surprised.webp") },
} as const satisfies Record<string, { source: ImageSourcePropType }>;

export type MascotPose = keyof typeof POSES;
export type MascotSize = "sm" | "md" | "lg" | "xl";

const SQUARE: Record<MascotSize, number> = { sm: 72, md: 120, lg: 176, xl: 240 };
// `peek` is a wide strip (881x384): its size steps are widths.
const PEEK_WIDTH: Record<MascotSize, number> = { sm: 120, md: 200, lg: 260, xl: 320 };
// `hero` is tall (560x875): its size steps are heights.
const HERO_HEIGHT: Record<MascotSize, number> = { sm: 96, md: 160, lg: 240, xl: 320 };

function dimensions(pose: MascotPose, size: MascotSize) {
  if (pose === "peek") {
    const width = PEEK_WIDTH[size];
    return { width, height: Math.round((width * 384) / 881) };
  }
  if (pose === "hero") {
    const height = HERO_HEIGHT[size];
    return { width: Math.round((height * 560) / 875), height };
  }
  return { width: SQUARE[size], height: SQUARE[size] };
}

/** Joyo cut-out, bundled. Announced as an image; pass `label` to override the pose caption. */
export function Mascot({
  pose,
  size = "md",
  label,
  style,
}: {
  pose: MascotPose;
  size?: MascotSize;
  label?: string;
  style?: StyleProp<ImageStyle>;
}) {
  const { t } = useTranslation("misc");
  const entry = POSES[pose];
  return (
    <Image
      source={entry.source}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ?? t(`mascot.alt.${pose}`)}
      resizeMode="contain"
      style={[dimensions(pose, size), { maxWidth: "100%" }, style]}
    />
  );
}
