import { useMemo, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Circle, Line, Path, Svg } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { Text } from "@/components/ui";
import { feedMapPoints, projectRoute, svgPathData } from "@joyorogo/api/lib/feed-route";

const ROUTE_COLOR = "#ff5a1f";
const GRID_STEP = 32;
const DETAIL_MIN_HEIGHT = 240;

/**
 * Route of a JoyoFit workout post, drawn from the shared encoded polyline as a plain SVG on a soft surface:
 * no map tiles and no request. `card` is the compact feed preview, `detail` the larger one on the post screen
 * with start/finish labels and the privacy hint. Renders nothing when the line is unusable.
 */
export function RouteMapPreview({
  line,
  title,
  size,
}: {
  line: string;
  title: string;
  size: "card" | "detail";
}) {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const detail = size === "detail";

  const points = useMemo(() => feedMapPoints(line), [line]);
  const projected = useMemo(
    () => (points && box ? projectRoute(points, box.w, box.h, detail ? 36 : 18) : null),
    [points, box, detail],
  );

  if (!points) return null;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  const route = projected?.points ?? null;
  const start = route?.[0];
  const finish = route?.[route.length - 1];

  const verticals: number[] = [];
  const horizontals: number[] = [];
  if (box) {
    for (let x = GRID_STEP; x < box.w; x += GRID_STEP) verticals.push(x);
    for (let y = GRID_STEP; y < box.h; y += GRID_STEP) horizontals.push(y);
  }

  return (
    <View>
      <View
        accessibilityRole="image"
        accessibilityLabel={t("watch.map.alt", { title })}
        onLayout={onLayout}
        style={[styles.box, detail ? styles.boxDetail : styles.boxCard]}
      >
        {box && route && start && finish ? (
          <Svg width={box.w} height={box.h}>
            {verticals.map((x) => (
              <Line key={`v${x}`} x1={x} y1={0} x2={x} y2={box.h} stroke={theme.colors.hairline} strokeWidth={1} />
            ))}
            {horizontals.map((y) => (
              <Line key={`h${y}`} x1={0} y1={y} x2={box.w} y2={y} stroke={theme.colors.hairline} strokeWidth={1} />
            ))}
            <Path
              d={svgPathData(route)}
              stroke={ROUTE_COLOR}
              strokeWidth={detail ? 4 : 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Circle
              cx={start[0]}
              cy={start[1]}
              r={detail ? 7 : 5}
              fill={theme.colors.primary}
              stroke={theme.colors.card}
              strokeWidth={2}
            />
            <Circle
              cx={finish[0]}
              cy={finish[1]}
              r={detail ? 7 : 5}
              fill={theme.colors.foreground}
              stroke={theme.colors.card}
              strokeWidth={2}
            />
          </Svg>
        ) : null}
        {detail ? (
          <View style={styles.legend} pointerEvents="none">
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
              <Text style={styles.legendText}>{t("watch.map.start")}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: theme.colors.foreground }]} />
              <Text style={styles.legendText}>{t("watch.map.finish")}</Text>
            </View>
          </View>
        ) : null}
      </View>
      {detail ? <Text style={styles.hint}>{t("watch.map.hint")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    width: "100%",
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
    overflow: "hidden",
  },
  boxCard: {
    aspectRatio: 2,
  },
  boxDetail: {
    aspectRatio: 4 / 3,
    minHeight: DETAIL_MIN_HEIGHT,
  },
  legend: {
    position: "absolute",
    left: theme.spacing.md,
    bottom: theme.spacing.md,
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  hint: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
}));
