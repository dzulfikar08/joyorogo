import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { hasBone } from "@joyorogo/api/lib/bone-chip";
import { clampCount, MAX_PIECES, pieceUnitKey } from "@joyorogo/api/lib/piece-chip";
import type { Pieces } from "@joyorogo/api/lib/piece-chip";

import { PressableScale } from "@/components/motion";
import { Chip, Text } from "@/components/ui";

/**
 * Under a scan row of separate pieces (eggs, satay, dumplings): "Jumlah", a minus, the count with its unit and a
 * plus. One tap moves the count by one and the row's weight, kcal and macros follow (itemAtCount), so a count the
 * AI misread is fixed without typing.
 */
export function PieceCountChip({
  name,
  pieces,
  onChange,
}: {
  name: string;
  pieces: Pieces;
  onChange: (count: number) => void;
}) {
  const { t } = useTranslation("scan");
  const { theme } = useUnistyles();
  const step = (delta: -1 | 1) => {
    const disabled = delta < 0 ? pieces.count <= 1 : pieces.count >= MAX_PIECES;
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t(delta < 0 ? "result.items.countLess" : "result.items.countMore", {
          name,
        })}
        disabled={disabled}
        hitSlop={6}
        onPress={() => onChange(clampCount(pieces.count + delta))}
        scaleTo={0.94}
        style={[styles.step, disabled && styles.stepOff]}
      >
        <Ionicons name={delta < 0 ? "remove" : "add"} size={18} color={theme.colors.foreground} />
      </PressableScale>
    );
  };
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={t("result.items.countGroup", { name })}
      style={styles.pill}
    >
      <Text style={styles.label}>{t("result.items.count")}</Text>
      {step(-1)}
      <Text style={styles.value}>
        {pieces.count}{" "}
        {t(`result.items.unit.${pieceUnitKey(pieces.unit)}`, { count: pieces.count })}
      </Text>
      {step(1)}
    </View>
  );
}

/**
 * Under a bone-in row (fried chicken, ribs, a whole fish): "Dengan tulang" / "Tanpa tulang" moves the row's
 * weight between the weight with the bone and the edible part (setWithBone). The kcal stay: they are those of
 * the meat that is eaten.
 */
export function BoneChips({
  name,
  item,
  onChange,
}: {
  name: string;
  item: { grams?: number; edibleGrams?: number; grossGrams?: number; withBone?: boolean };
  onChange: (withBone: boolean) => void;
}) {
  const { t } = useTranslation("scan");
  if (!hasBone(item)) return null;
  const withBone = item.withBone ?? true;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("result.items.boneGroup", { name })}
      style={styles.row}
    >
      <Chip
        compact
        label={t("result.items.boneWith")}
        selected={withBone}
        onPress={() => onChange(true)}
      />
      <Chip
        compact
        label={t("result.items.boneWithout")}
        selected={!withBone}
        onPress={() => onChange(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    paddingLeft: 12,
    paddingRight: 2,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  label: {
    marginRight: 4,
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  step: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
  },
  stepOff: {
    opacity: 0.4,
  },
  value: {
    minWidth: 64,
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    color: theme.colors.foreground,
  },
}));
