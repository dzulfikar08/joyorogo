import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { LiveRow } from "@joyorogo/api/lib/scan-live";

import { Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

/** Skeleton rows shown before the first name arrives. */
const SKELETON_ROWS = 2;

function SkeletonBar({ pulse, width }: { pulse: Animated.Value; width: number }) {
  return <Animated.View style={[styles.skeleton, { width, opacity: pulse }]} />;
}

/** One finished or in-progress item; fades in when the model first writes it. */
function Row({ row, pulse }: { row: LiveRow; pulse: Animated.Value }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [enter]);
  return (
    <Animated.View
      style={[
        styles.row,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      <Text style={styles.name} numberOfLines={1}>
        {row.name}
      </Text>
      {row.item ? (
        <Text style={styles.kcal}>{`${fmtInt(row.item.kcal)} kcal`}</Text>
      ) : (
        <SkeletonBar pulse={pulse} width={48} />
      )}
    </Animated.View>
  );
}

/**
 * What the model has found so far while the scan runs (ai.analyzeFoodStream):
 * skeleton bars first, then one row per item, name first and kcal once the
 * item is complete. A trailing skeleton row says more may follow. The final
 * list comes from the finished result, not from these rows.
 */
export function LiveRows({ rows }: { rows: LiveRow[] }) {
  const pulse = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);
  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <Row key={row.index} row={row} pulse={pulse} />
      ))}
      {Array.from({ length: rows.length === 0 ? SKELETON_ROWS : 1 }, (_, i) => (
        <View key={`skeleton-${i}`} style={styles.row}>
          <SkeletonBar pulse={pulse} width={120 - i * 24} />
          <SkeletonBar pulse={pulse} width={48} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    alignSelf: "stretch",
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.card,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  name: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  kcal: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  skeleton: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
}));
