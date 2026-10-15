import { Ionicons } from "@expo/vector-icons";
import { FOOD_KIND_LABELS, foodKind } from "@joyorogo/api/lib/food-kind";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { DiaryRow } from "@/components/favorit";
import { MacroLine } from "@/components/macro-line";
import { FoodSticker } from "@/components/sticker";
import { Text } from "@/components/ui";
import { fmtKcal } from "@/utils/format";
import { MacroIcon } from "@/utils/macro-icons";

const KIND_ICON = {
  makanan: "restaurant",
  camilan: "fast-food",
  minuman: "cafe",
  lainnya: "shapes",
} as const satisfies Record<FoodKind, React.ComponentProps<typeof Ionicons>["name"]>;

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

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
  const { theme } = useUnistyles();
  const kind = foodKind(item.name);
  const created = new Date(item.createdAt);
  const hasMacros = [item.protein, item.carbs, item.fat, item.fiber].some((g) => (g ?? 0) > 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.name}
      onPress={onEdit}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
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
            <Text style={styles.kindText}>{FOOD_KIND_LABELS[kind]}</Text>
          </View>
          {Number.isNaN(created.getTime()) ? null : (
            <View style={styles.timeItem}>
              <Ionicons name="time-outline" size={14} color={theme.colors.mutedForeground} />
              <Text style={styles.timeText}>{timeFmt.format(created)}</Text>
            </View>
          )}
        </View>
        <View style={styles.metaBox}>
          <View style={styles.metaLine}>
            <View style={styles.metaItem}>
              <MacroIcon macro="kcal" size={14} />
              <Text style={[styles.metaText, styles.kcalText]}>{fmtKcal(item.kcal)} kkal</Text>
            </View>
            {item.grams ? (
              <View style={styles.metaItem}>
                <MacroIcon macro="grams" size={14} />
                <Text style={[styles.metaText, styles.gramText]}>{fmtKcal(item.grams)} g</Text>
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
            <Text style={styles.aiText}>Dari pindai AI</Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Hapus ${item.name}`}
        onPress={onDelete}
        hitSlop={4}
        style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
      >
        <Ionicons name="trash-outline" size={18} color={theme.colors.destructive} />
      </Pressable>
    </Pressable>
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
  pressed: {
    opacity: 0.7,
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
