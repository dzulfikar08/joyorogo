import "@/unistyles";
import { Image, Platform, View } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * Third-party brand tile for settings rows and section heads. One component so each mark follows
 * its owner's rules (docs/brand-marks.md): Strava symbol on its orange, Google's Health Connect
 * icon unmodified, Apple's Health icon unmasked and only on iOS.
 */
export type BrandName = "strava" | "healthConnect" | "appleHealth";

/** The health platform of this build: Apple Health on iOS, Health Connect elsewhere (Apple's mark never leaves iOS). */
export const HEALTH_BRAND: BrandName = Platform.OS === "ios" ? "appleHealth" : "healthConnect";

const STRAVA_ORANGE = "#FC5200";
const STRAVA_SYMBOL =
  "M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169";

export function BrandMark({ brand, size = 36 }: { brand: BrandName; size?: number }) {
  if (brand === "strava") {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 9,
          backgroundColor: STRAVA_ORANGE,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24">
          <Path fill="#FFFFFF" d={STRAVA_SYMBOL} />
        </Svg>
      </View>
    );
  }
  if (brand === "appleHealth") {
    // Apple Design Resources icon: square with its own rounded corners. No mask, border,
    // shadow or tint, and never rendered off iOS.
    return (
      <Image
        source={require("@/assets/images/brand/apple-health.png")}
        style={{ width: size, height: size }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  // Health Connect's icon is transparent with a dark teal half; a white tile keeps it readable
  // in dark mode without altering the artwork.
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        backgroundColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
        source={require("@/assets/images/health-connect.png")}
        style={{ width: size * 0.8, height: size * 0.8 }}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
