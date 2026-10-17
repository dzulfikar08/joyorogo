import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Circle, Polyline, Svg } from "react-native-svg";

import { Button, Card, Skeleton, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

const W = 320;
const HR_H = 120;
const ROUTE_H = 200;
const PAD = 8;

/** Titik bpm -> segmen polyline; nilai null (sensor putus) memutus garis. */
function hrSegments(bpm: (number | null)[], min: number, max: number) {
  const span = Math.max(max - min, 1);
  const x = (i: number) => PAD + (i / Math.max(bpm.length - 1, 1)) * (W - 2 * PAD);
  const y = (v: number) => HR_H - PAD - ((v - min) / span) * (HR_H - 2 * PAD);
  const segments: string[] = [];
  let current: string[] = [];
  bpm.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
    } else {
      current.push(`${x(i)},${y(v)}`);
    }
  });
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}

/** Rute lat/lon -> titik SVG; bujur dikoreksi cos(lat) supaya bentuknya tidak melar. */
function routePoints(route: [number, number][]) {
  const lats = route.map(([lat]) => lat);
  const lons = route.map(([, lon]) => lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * k, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((W - 2 * PAD) / spanX, (ROUTE_H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (ROUTE_H - spanY * scale) / 2;
  return route.map(([lat, lon]) => ({
    x: offX + (lon - minLon) * k * scale,
    y: ROUTE_H - offY - (lat - minLat) * scale,
  }));
}

/**
 * Detail latihan JoyoFit: grafik detak jantung + rute. Penulis dan viewer Pro
 * melihat datanya; viewer lain mendapat kartu upsell ke /founder.
 */
export function WorkoutDetail({ postId }: { postId: string }) {
  const { t } = useTranslation("feed");
  const { theme } = useUnistyles();
  const detail = useQuery(orpc.social.workoutDetail.queryOptions({ input: { postId } }));

  if (detail.isPending) return <Skeleton width="100%" height={160} radius={24} />;
  if (detail.isError)
    return (
      <Card>
        <Text style={styles.muted}>{t("watch.loadFailed")}</Text>
      </Card>
    );

  const { locked, hr, route } = detail.data;
  if (locked)
    return (
      <Card style={styles.upsell}>
        <View style={styles.upsellHead}>
          <Ionicons name="lock-closed" size={18} color={theme.colors.mutedForeground} />
          <Text style={styles.title}>{t("watch.lockedTitle")}</Text>
        </View>
        <Text style={styles.muted}>{t("watch.lockedBody")}</Text>
        <Button
          size="sm"
          label={t("watch.lockedCta")}
          onPress={() => router.push("/founder")}
        />
      </Card>
    );

  const values = hr?.bpm.filter((v) => v !== null) ?? [];
  const segments = hr && values.length > 1 ? hrSegments(hr.bpm, Math.min(...values), Math.max(...values)) : [];
  const points = route && route.length > 1 ? routePoints(route) : [];
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <>
      {segments.length > 0 ? (
        <Card style={styles.chart}>
          <Text style={styles.title}>{t("watch.hrTitle")}</Text>
          <Svg width="100%" height={HR_H} viewBox={`0 0 ${W} ${HR_H}`}>
            {segments.map((pts) => (
              <Polyline
                key={pts}
                points={pts}
                stroke={theme.colors.bakar}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
              />
            ))}
          </Svg>
        </Card>
      ) : null}
      {first && last ? (
        <Card style={styles.chart}>
          <Text style={styles.title}>{t("watch.routeTitle")}</Text>
          <Svg width="100%" height={ROUTE_H} viewBox={`0 0 ${W} ${ROUTE_H}`}>
            <Polyline
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke={theme.colors.tidur}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
            <Circle cx={first.x} cy={first.y} r={5} fill={theme.colors.makan} />
            <Circle cx={last.x} cy={last.y} r={5} fill={theme.colors.bakar} />
          </Svg>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  chart: {
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  upsell: {
    gap: theme.spacing.md,
  },
  upsellHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
}));
