import "@/unistyles";
import { useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { PanResponder, Pressable, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

export type BarChartDatum = {
  key: string;
  value: number;
  /** Short axis label under the bar; leave empty to skip this bar's label (long ranges label every few bars). */
  label?: string;
  /** What the readout line says while this bar is selected ("Sel 21 Okt: 6 gelas"). */
  readout: string;
  /**
   * Overrides how the bar is coloured: `strong` and `soft` use the two chart colours, `faint` a real but quiet grey,
   * `muted` the empty-bar grey. Default: by `target`.
   */
  tone?: "strong" | "soft" | "faint" | "muted";
};

const LABEL_W = 44;

/**
 * Daily bars with an optional dashed target line and a one-line readout above them. Tap a bar, or drag
 * across the bars, and the readout names that day (a close button clears it); the bars that reach the target carry
 * the strong colour. Horizontal drags scrub and vertical ones still scroll the page. The selection is the chart's
 * own unless `selectedKey` and `onSelect` are passed, which lets a list under the chart follow it.
 */
export function BarChart({
  data,
  target,
  color,
  softColor,
  hint,
  accessibilityLabel,
  height = 112,
  selectedKey,
  onSelect,
}: {
  data: BarChartDatum[];
  /** Bars at or above it are drawn in `color`; the rest in `softColor`. Omit for a single colour. */
  target?: number;
  color: string;
  softColor: string;
  /** Readout text while nothing is selected. */
  hint: string;
  accessibilityLabel: string;
  height?: number;
  /** The selected bar's key (null: none). Pass together with `onSelect` to control the selection. */
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("common");
  const [ownKey, setOwnKey] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const controlled = onSelect !== undefined;
  const key = controlled ? (selectedKey ?? null) : ownKey;
  const found = key === null ? -1 : data.findIndex((d) => d.key === key);
  const selected = found >= 0 ? found : null;
  const select = (next: string | null) => (controlled ? onSelect(next) : setOwnKey(next));

  // Long ranges draw thinner bars: 90 days still leave a few pixels each.
  const gap = data.length <= 10 ? theme.spacing.sm : data.length <= 45 ? 3 : 1;
  const colW = data.length > 0 ? Math.max((width - gap * (data.length - 1)) / data.length, 1) : 1;

  // The responder is created once; it reads the current geometry through this ref.
  const pick = useRef((_x: number) => {});
  pick.current = (x: number) => {
    if (data.length === 0) return;
    select(data[Math.min(Math.max(Math.floor(x / (colW + gap)), 0), data.length - 1)]!.key);
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: (event) => pick.current(event.nativeEvent.locationX),
      onPanResponderMove: (event) => pick.current(event.nativeEvent.locationX),
    }),
  ).current;

  const max = Math.max(target ?? 0, ...data.map((d) => d.value), 1);
  const active = selected !== null ? data[selected] : undefined;

  return (
    <View>
      <View style={styles.readoutRow}>
        <Text style={[styles.readout, active ? styles.readoutActive : null]} numberOfLines={1}>
          {active ? active.readout : hint}
        </Text>
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("range.clearSelection")}
            hitSlop={12}
            onPress={() => select(null)}
            style={styles.clear}
          >
            <Ionicons name="close" size={16} color={theme.colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        style={[styles.area, { height }]}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
        {target !== undefined ? (
          <View
            pointerEvents="none"
            style={[styles.targetLine, { bottom: (target / max) * height, borderColor: theme.colors.mutedForeground }]}
          />
        ) : null}
        <View pointerEvents="none" style={[styles.bars, { gap }]}>
          {data.map((d, i) => {
            const tone =
              d.tone ??
              (d.value === 0
                ? "muted"
                : target === undefined || d.value >= target
                  ? "strong"
                  : "soft");
            return (
              <View
                key={d.key}
                style={{
                  width: colW,
                  height: Math.max((d.value / max) * height, d.value > 0 ? 4 : 2),
                  borderTopLeftRadius: Math.min(colW / 2, 6),
                  borderTopRightRadius: Math.min(colW / 2, 6),
                  backgroundColor:
                    tone === "muted"
                      ? theme.colors.hairline
                      : tone === "faint"
                        ? `${theme.colors.mutedForeground}73`
                        : tone === "strong"
                          ? color
                          : softColor,
                  opacity: selected === null || selected === i ? 1 : 0.45,
                }}
              />
            );
          })}
        </View>
      </View>
      <View style={[styles.labels, { gap }]} importantForAccessibility="no-hide-descendants">
        {data.map((d, i) => (
          <View key={d.key} style={{ width: colW }}>
            {d.label ? (
              <Text
                numberOfLines={1}
                style={[styles.label, { left: (colW - LABEL_W) / 2 }, selected === i && styles.labelActive]}
              >
                {d.label}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  readoutRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  clear: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  readout: {
    flex: 1,
    height: 24,
    lineHeight: 24,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  readoutActive: { color: theme.colors.foreground },
  area: { justifyContent: "flex-end" },
  bars: { flexDirection: "row", alignItems: "flex-end" },
  targetLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
    opacity: 0.5,
  },
  labels: { flexDirection: "row", height: 18, marginTop: theme.spacing.xs },
  label: {
    position: "absolute",
    width: LABEL_W,
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  labelActive: { color: theme.colors.foreground },
}));
