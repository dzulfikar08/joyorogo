import { Ionicons } from "@expo/vector-icons";
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
import { Num, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

/**
 * Nutrition diary row: a small thumbnail (plain cutout or food icon), the name,
 * time and grams, the macro line, and the kcal as the right-aligned number.
 * The trash button is the only inline control; the rest of the row opens the
 * editor. `nested` is a component of a plate: the plate header above it holds
 * the thumbnail, time and macros, so the row keeps the name, grams and kcal.
 */
export function FoodRow({
  item,
  onEdit,
  onDelete,
  onViewSticker,
  nested = false,
}: {
  item: DiaryRow;
  onEdit: () => void;
  onDelete: () => void;
  /** Opens the full-size sticker viewer; only offered when the row has a cutout. */
  onViewSticker?: () => void;
  nested?: boolean;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const created = new Date(item.createdAt);
  const hasMacros = [item.protein, item.carbs, item.fat, item.fiber].some((g) => (g ?? 0) > 0);
  // Never filled in (null, not 0 g): the day total counts nothing for it, so say so and let a tap open the editor.
  const macrosMissing = item.protein == null && item.carbs == null && item.fat == null && item.kcal > 0;

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
        style={[styles.row, nested && styles.rowNested]}
      >
        {nested ? null : (
          <FoodSticker
            scanId={item.scanId}
            name={item.name}
            size={48}
            onPress={item.scanId ? onViewSticker : undefined}
          />
        )}
        <View style={styles.body}>
          <Text style={[styles.title, nested && styles.titleNested]} numberOfLines={2}>
            {item.name}
          </Text>
          {(Number.isNaN(created.getTime()) || nested) && !item.grams ? null : (
            <View style={styles.metaLine}>
              {Number.isNaN(created.getTime()) || nested ? null : (
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={13} color={theme.colors.mutedForeground} />
                  <Text style={styles.metaText}>{fmtClock(created)}</Text>
                </View>
              )}
              {item.grams ? <Text style={styles.metaText}>{fmtInt(item.grams)} g</Text> : null}
            </View>
          )}
          {nested ? null : hasMacros ? (
            <MacroLine
              compact
              protein={item.protein}
              carbs={item.carbs}
              fat={item.fat}
              fiber={item.fiber}
            />
          ) : macrosMissing ? (
            <Text style={styles.metaText}>{t("foodRow.noMacros")}</Text>
          ) : item.source === "ai" ? (
            <Text style={styles.metaText}>{t("foodRow.fromAi")}</Text>
          ) : null}
        </View>
        <View style={styles.kcalBox}>
          <Num style={[styles.kcal, nested && styles.kcalNested]}>{fmtInt(item.kcal)}</Num>
          {nested ? null : <Text style={styles.kcalUnit}>{t("diary.summary.unit")}</Text>}
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("foodRow.delete", { name: item.name })}
          onPress={handleDelete}
          hitSlop={4}
          scaleTo={0.85}
          style={nested ? styles.deleteButtonNested : styles.deleteButton}
        >
          <Ionicons name="trash-outline" size={nested ? 16 : 18} color={theme.colors.destructive} />
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
    gap: 3,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: theme.spacing.md,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
  kcalBox: {
    alignItems: "flex-end",
  },
  kcal: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.kcalText,
  },
  kcalUnit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  deleteButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -12,
  },
  // A component inside a plate group: no thumbnail, smaller type, tighter rows; the group's rule indents it.
  rowNested: {
    gap: theme.spacing.sm,
    paddingLeft: 0,
    paddingRight: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  titleNested: {
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    lineHeight: 18,
  },
  kcalNested: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  deleteButtonNested: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -8,
  },
}));
