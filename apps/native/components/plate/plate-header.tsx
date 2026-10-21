import { Ionicons } from "@expo/vector-icons";
import { fmtClock } from "@joyorogo/i18n";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MacroLine } from "@/components/macro-line";
import { FoodSticker } from "@/components/sticker";
import { Num, Text } from "@/components/ui";
import { fmtIdr, fmtInt } from "@/utils/format";

/**
 * Header of a diary plate group: the cutout of its first component (or the food tile), "Piring: Nasi
 * padang", time and price, the plate's total kcal on the right and its macros underneath. The components
 * follow it indented under a left rule (PlateGroup). Tapping the header opens the plate edit sheet
 * (PlateEditSheet); the thumbnail opens the full-size cutout.
 */
export function PlateHeader({
  name,
  priceIdr,
  kcal,
  protein,
  carbs,
  fat,
  fiber,
  scanId,
  eatenAt,
  onEdit,
  onViewSticker,
  disabled,
}: {
  name: string;
  priceIdr: number | null;
  /** Component totals summed by the diary, shown in the header. */
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  /** Cutout of the first component that has one. */
  scanId: string | null;
  /** When the plate was logged (its first component). */
  eatenAt: Date | null;
  onEdit: () => void;
  onViewSticker?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const validTime = eatenAt !== null && !Number.isNaN(eatenAt.getTime());
  return (
    <View style={styles.header}>
      <FoodSticker
        scanId={scanId}
        name={name}
        size={48}
        onPress={scanId ? onViewSticker : undefined}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("plate.header.editAria", { name })}
        disabled={disabled}
        onPress={onEdit}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {t("plate.header.title", { name })}
          </Text>
          <Ionicons name="pencil" size={12} color={theme.colors.mutedForeground} />
        </View>
        {validTime || priceIdr !== null ? (
          <View style={styles.metaLine}>
            {validTime ? (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={13} color={theme.colors.mutedForeground} />
                <Text style={styles.metaText}>{fmtClock(eatenAt)}</Text>
              </View>
            ) : null}
            {priceIdr !== null ? <Text style={styles.metaText}>{fmtIdr(priceIdr)}</Text> : null}
          </View>
        ) : null}
        {kcal > 0 ? <MacroLine compact protein={protein} carbs={carbs} fat={fat} fiber={fiber} /> : null}
      </Pressable>
      <View style={styles.kcalBox}>
        <Num style={styles.kcal}>{fmtInt(kcal)}</Num>
        <Text style={styles.kcalUnit}>{t("diary.summary.unit")}</Text>
      </View>
    </View>
  );
}

/**
 * One plate in the diary: the header, then its components inset under a rule that starts below the
 * thumbnail's centre, so they read as part of the plate and not as more top-level rows. Breathing room
 * above and below keeps two plates apart.
 */
export function PlateGroup({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.group}>
      {header}
      <View style={styles.components}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  group: {
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.md,
  },
  header: {
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
  pressed: {
    opacity: 0.7,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
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
  // Rule x = gutter + half the 48px thumbnail; components start just right of it.
  components: {
    marginLeft: theme.spacing.lg + 23,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.hairline,
    paddingLeft: theme.spacing.md,
  },
}));
