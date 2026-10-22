import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Segmented, Text } from "@/components/ui";

/**
 * The range chrome the metric screens share (Berat, Air, Rekap): the range picker, then the period it shows with
 * previous / next arrows. Off the newest period a "Terbaru" chip jumps back. `onPrev` / `onNext` null disables the arrow.
 */
export function RangeNav<T extends string>({
  options,
  value,
  onChange,
  label,
  onPrev,
  onNext,
  onReset,
  compact,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** The period on screen: "16–22 Okt". */
  label: string;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** Given when the period is not the newest: shows the jump-back chip. */
  onReset?: (() => void) | null;
  compact?: boolean;
}) {
  const { t } = useTranslation("common");
  const { theme } = useUnistyles();
  return (
    <View style={styles.wrap}>
      <Segmented options={options} value={value} onChange={onChange} compact={compact} />
      <View style={styles.row}>
        <Arrow
          icon="chevron-back"
          label={t("range.prev")}
          onPress={onPrev}
          color={theme.colors.foreground}
        />
        <Text style={styles.label} numberOfLines={1} accessibilityLiveRegion="polite">
          {label}
        </Text>
        {onReset ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("range.resetLabel")}
            onPress={onReset}
            hitSlop={6}
            scaleTo={0.96}
            style={styles.reset}
          >
            <Text style={styles.resetText}>{t("range.reset")}</Text>
          </PressableScale>
        ) : null}
        <Arrow
          icon="chevron-forward"
          label={t("range.next")}
          onPress={onNext}
          color={theme.colors.foreground}
        />
      </View>
    </View>
  );
}

function Arrow({
  icon,
  label,
  onPress,
  color,
}: {
  icon: "chevron-back" | "chevron-forward";
  label: string;
  onPress: (() => void) | null;
  color: string;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: onPress === null }}
      disabled={onPress === null}
      onPress={onPress ?? undefined}
      scaleTo={0.92}
      style={[styles.arrow, onPress === null && styles.arrowOff]}
    >
      <Ionicons name={icon} size={20} color={color} />
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  label: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  arrowOff: { opacity: 0.35 },
  reset: {
    minHeight: 36,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  resetText: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.makanText },
}));
