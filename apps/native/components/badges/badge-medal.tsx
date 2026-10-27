import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Image, type ImageSourcePropType, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { badgeKey, RING_COLORS, ringFor, starsFor, type BadgeLike } from "@/src/lib/badges";

// Metro bundles exactly these: one 512px medallion per badge id.
const ART: Record<string, ImageSourcePropType> = {
  "air-putih": require("@/assets/badge/air-putih.webp"),
  "catatan-pertama": require("@/assets/badge/catatan-pertama.webp"),
  "jejak-tim": require("@/assets/badge/jejak-tim.webp"),
  konsisten: require("@/assets/badge/konsisten.webp"),
  "latihan-10": require("@/assets/badge/latihan-10.webp"),
  "latihan-pertama": require("@/assets/badge/latihan-pertama.webp"),
  "minggu-sempurna": require("@/assets/badge/minggu-sempurna.webp"),
  "pemindai-pertama": require("@/assets/badge/pemindai-pertama.webp"),
  "perbaikan-pertama": require("@/assets/badge/perbaikan-pertama.webp"),
  "protein-target": require("@/assets/badge/protein-target.webp"),
  "ramadan-konsisten": require("@/assets/badge/ramadan-konsisten.webp"),
  "tantangan-selesai": require("@/assets/badge/tantangan-selesai.webp"),
};

export function badgeArt(id: string): ImageSourcePropType | undefined {
  return ART[id];
}

/** Medallion art inside a tier ring, `tier` small stars under it. Locked badges are greyed out with no ring. */
export function BadgeMedal({ badge, size = 72, stars = true }: { badge: BadgeLike; size?: number; stars?: boolean }) {
  const { t } = useTranslation("badges");
  const ring = ringFor(badge);
  const count = stars ? starsFor(badge) : 0;
  const ringWidth = Math.max(2, Math.round(size / 24));
  const starSize = Math.max(8, Math.round(size / 6));
  const locked = badge.tier <= 0;
  const art = ART[badge.id];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={locked ? `${t(badgeKey(badge.id, "name"))}, ${t("board.locked")}` : t(badgeKey(badge.id, "name"))}
      style={styles.wrap}
    >
      <View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: ringWidth,
            borderColor: ring ? RING_COLORS[ring] : "transparent",
          },
        ]}
      >
        {art ? (
          <Image
            source={art}
            resizeMode="cover"
            style={[
              { width: size - ringWidth * 2, height: size - ringWidth * 2, borderRadius: size / 2 },
              locked && styles.locked,
            ]}
          />
        ) : null}
      </View>
      {count > 0 ? (
        <View style={styles.stars}>
          {Array.from({ length: count }, (_, i) => (
            <Ionicons key={i} name="star" size={starSize} color={RING_COLORS[ring ?? "gold"]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  wrap: { alignItems: "center", gap: 4 },
  ring: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  // No desaturate filter in RN core: heavy fade over the card reads as greyed out.
  locked: { opacity: 0.28 },
  stars: { flexDirection: "row", gap: 1 },
}));
