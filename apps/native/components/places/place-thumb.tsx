import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { StickerMini } from "@/components/sticker";

/** Plain (non-interactive) sticker cutout, so it can sit inside a tappable card. */
export function PlaceThumb({ scanId, size = 72 }: { scanId: string | null; size?: number }) {
  const { theme } = useUnistyles();
  const [failed, setFailed] = useState(false);
  if (!scanId || failed) {
    return (
      <View style={[styles.fallback, { width: size, height: size }]}>
        <Ionicons name="restaurant" size={size / 3} color={theme.colors.makanText} />
      </View>
    );
  }
  return <StickerMini scanId={scanId} size={size} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create((theme) => ({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
}));
