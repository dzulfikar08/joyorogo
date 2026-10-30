import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { Text } from "@/components/ui";

/** Stands where the comment composer would be on a post whose author turned comments off. */
export function CommentsOffNotice() {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  return (
    <View style={styles.bar} accessibilityRole="text">
      <Ionicons name="lock-closed-outline" size={18} color={theme.colors.mutedForeground} />
      <Text style={styles.text}>{t("comments.off.notice")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    width: "100%",
    maxWidth: 640,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
  },
  text: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
