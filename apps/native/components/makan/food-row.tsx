import { Ionicons } from "@expo/vector-icons";
import { foodKind } from "@joyorogo/api/lib/food-kind";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { fmtClock } from "@joyorogo/i18n";
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { DiaryRow } from "@/components/favorit";
import { MacroLine } from "@/components/macro-line";
import { FoodSticker } from "@/components/sticker";
import { EASE_OUT, PressableScale, useEnter } from "@/components/motion";
import { Text } from "@/components/ui";
import { fmtInt, fmtKcalLabel } from "@/utils/format";
import { MacroIcon } from "@/utils/macro-icons";

const KIND_ICON = {
  makanan: "restaurant",
  camilan: "fast-food",
  minuman: "cafe",
  lainnya: "shapes",
} as const satisfies Record<FoodKind, React.ComponentProps<typeof Ionicons>["name"]>;

/**
 * Sticker-first diary row: large cutout on the left, name (2 lines max), kind
 * chip + time, then kkal / gram / macro metadata. The trash button is the only
 * inline control; the rest of the row opens the editor.
 */
export function FoodRow({
  item,
  onEdit,
  onDelete,
  onViewSticker,
}: {
  item: DiaryRow;
  onEdit: () => void;
  onDelete: () => void;
  /** Opens the full-size sticker viewer; only offered when the row has a cutout. */
  onViewSticker?: () => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const kind = foodKind(item.name);
  const created = new Date(item.createdAt);
  const hasMacros = [item.protein, item.carbs, item.fat, item.fiber].some((g) => (g ?? 0) > 0);

  // Only a row the user just added (optimistic temp id) animates in, so the swap to
  // the server id and plain list loads never flash. Delete plays its exit first,
  // then hands over to the optimistic remove.
  const enter = useEnter(0);
  const reduceMotion = useReducedMotion();
  const leave = useSharedValue(0);
  const leaving = useRef(false);
  const leaveStyle = useAnimatedStyle(() => ({
    opacity: 1 - leave.value,
    transform: [{ translateX: -16 * leave.value }],
  }));
  const handleDelete = () => {
    if (leaving.current) return;
    leaving.current = true;
    if (reduceMotion) {
      onDelete();
      return;
    }
    leave.value = withTiming(1, { duration: 160, easing: EASE_OUT });
    setTimeout(onDelete, 160);
  };

  return (
    <Animated.View entering={item.id.startsWith("temp-") ? enter : undefined} style={leaveStyle}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={item.name}
        onPress={onEdit}
        scaleTo={1}
        dimTo={0.7}
        style={styles.row}
      >
        <FoodSticker
          scanId={item.scanId}
          name={item.name}
          size={76}
          onPress={item.scanId ? onViewSticker : undefined}
        />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {item.name}
          </Text>
          <View style={styles.chipLine}>
            <View style={styles.kindChip}>
              <Ionicons name={KIND_ICON[kind]} size={13} color={theme.colors.makanText} />
              <Text style={styles.kindText}>{t(`kind.${kind}`)}</Text>
            </View>
            {Number.isNaN(created.getTime()) ? null : (
              <View style={styles.timeItem}>
                <Ionicons name="time-outline" size={14} color={theme.colors.mutedForeground} />
                <Text style={styles.timeText}>{fmtClock(created)}</Text>
              </View>
            )}
          </View>
          <View style={styles.metaBox}>
            <View style={styles.metaLine}>
              <View style={styles.metaItem}>
                <MacroIcon macro="kcal" size={14} />
                <Text style={[styles.metaText, styles.kcalText]}>{fmtKcalLabel(item.kcal)}</Text>
              </View>
              {item.grams ? (
                <View style={styles.metaItem}>
                  <MacroIcon macro="grams" size={14} />
                  <Text style={[styles.metaText, styles.gramText]}>{fmtInt(item.grams)} g</Text>
                </View>
              ) : null}
            </View>
            {hasMacros ? (
              <MacroLine
                compact
                protein={item.protein}
                carbs={item.carbs}
                fat={item.fat}
                fiber={item.fiber}
              />
            ) : item.source === "ai" ? (
              <Text style={styles.aiText}>{t("foodRow.fromAi")}</Text>
            ) : null}
          </View>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("foodRow.delete", { name: item.name })}
          onPress={handleDelete}
          hitSlop={4}
          scaleTo={0.85}
          style={styles.deleteButton}
        >
          <Ionicons name="trash-outline" size={18} color={theme.colors.destructive} />
        </PressableScale>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  chipLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.md,
    rowGap: 4,
  },
  kindChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.makanSoft,
  },
  kindText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  timeItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
  metaBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.md,
    rowGap: 2,
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: theme.spacing.md,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  kcalText: {
    color: theme.colors.kcalText,
  },
  gramText: {
    color: theme.colors.gramText,
  },
  aiText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
  deleteButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -12,
  },
}));
