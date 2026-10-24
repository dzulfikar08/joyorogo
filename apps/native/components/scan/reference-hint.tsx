import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

// Closed on this phone for good; not tied to the account (the tip is about a habit with the camera).
const STORE_KEY = "joyorogo.scanReferenceHint";

/** One line over the camera: put a card or a kitchen scale beside the food (the scale only where no card is read). */
export function ReferenceHint() {
  const { t } = useTranslation("scan");
  const hint = useQuery(orpc.dishware.scanHint.queryOptions());
  // Hidden until the stored answer is known, so a closed tip never flashes.
  const [closed, setClosed] = useState(true);
  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY).then(
      (value) => setClosed(value === "1"),
      () => setClosed(false),
    );
  }, []);
  if (!hint.data || !(hint.data.show || hint.data.scale) || closed) return null;
  return (
    <View style={styles.pill}>
      <Text style={styles.text}>{t(hint.data.show ? "idle.referenceHint" : "idle.referenceHintScale")}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("idle.referenceHintClose")}
        hitSlop={10}
        onPress={() => {
          setClosed(true);
          SecureStore.setItemAsync(STORE_KEY, "1").catch(() => {
            // Best-effort: the tip only comes back.
          });
        }}
      >
        <Ionicons name="close" size={14} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.tile,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  text: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    textAlign: "center",
  },
}));
