import "@/unistyles";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { BadgeMedal } from "@/components/badges/badge-medal";
import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";
import { badgeKey, type BadgeLike } from "@/src/lib/badges";

/** Grid of every badge, locked ones greyed. Tap opens the detail. */
export function BadgeShelf({ badges, onOpen }: { badges: BadgeLike[]; onOpen: (badge: BadgeLike) => void }) {
  const { t } = useTranslation("badges");
  return (
    <View style={styles.grid}>
      {badges.map((badge) => (
        <PressableScale
          key={badge.id}
          accessibilityRole="button"
          accessibilityLabel={t(badgeKey(badge.id, "name"))}
          onPress={() => onOpen(badge)}
          scaleTo={0.95}
          style={styles.cell}
        >
          <BadgeMedal badge={badge} size={76} />
          <Text style={[styles.name, badge.tier <= 0 && styles.nameLocked]} numberOfLines={2}>
            {t(badgeKey(badge.id, "name"))}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: theme.spacing.lg },
  cell: { width: "33.333%", alignItems: "center", gap: theme.spacing.sm, paddingHorizontal: 4 },
  name: { fontSize: theme.fontSize.xs, fontWeight: "700", color: theme.colors.foreground, textAlign: "center" },
  nameLocked: { color: theme.colors.mutedForeground },
}));
