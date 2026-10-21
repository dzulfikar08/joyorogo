import "@/unistyles";
import { useRef, useState } from "react";
import { PanResponder, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

export type BarChartDatum = {
  key: string;
  value: number;
  /** Short axis label under the bar; leave empty to skip this bar's label (long ranges label every few bars). */
  label?: string;
  /** What the readout line says while this bar is selected ("Sel 21 Okt: 6 gelas"). */
  readout: string;
};

const LABEL_W = 44;

/**
 * Daily bars with an optional dashed target line and a one-line readout above them. Tap a bar, or drag
 * across the bars, and the readout names that day; the bars that reach the target carry the strong colour.
 * Horizontal drags scrub and vertical ones still scroll the page.
 */
export function BarChart({
  data,
  target,
  color,
  softColor,
  hint,
  accessibilityLabel,
  height = 112,
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
}) {
  const { theme } = useUnistyles();
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(0);

  const gap = data.length <= 10 ? theme.spacing.sm : 3;
  const colW = data.length > 0 ? Math.max((width - gap * (data.length - 1)) / data.length, 1) : 1;

  // The responder is created once; it reads the current geometry through this ref.
  const pick = useRef((_x: number) => {});
  pick.current = (x: number) => {
    if (data.length === 0) return;
    setSelected(Math.min(Math.max(Math.floor(x / (colW + gap)), 0), data.length - 1));
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
      <Text style={[styles.readout, active ? styles.readoutActive : null]} numberOfLines={1}>
        {active ? active.readout : hint}
      </Text>
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
            const reached = target === undefined || d.value >= target;
            return (
              <View
                key={d.key}
                style={{
                  width: colW,
                  height: Math.max((d.value / max) * height, d.value > 0 ? 4 : 2),
                  borderTopLeftRadius: Math.min(colW / 2, 6),
                  borderTopRightRadius: Math.min(colW / 2, 6),
                  backgroundColor: d.value === 0 ? theme.colors.hairline : reached ? color : softColor,
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
  readout: {
    height: 24,
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
