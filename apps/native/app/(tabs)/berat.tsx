import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { Dimensions, View } from "react-native";
import { useState } from "react";
import { Redirect } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, Polyline, Svg } from "react-native-svg";

import {
  BootLoader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  Num,
  PageHeader,
  Screen,
  Segmented,
  Skeleton,
  Text,
} from "@/components/ui";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtDateId, fmtKg } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type Range = "30" | "90";

/** Trend line over raw scale dots for the selected range. */
function WeightChart({
  entries,
  trendPoints,
}: {
  entries: Array<{ date: string; weightKg: number }>;
  trendPoints: Array<{ date: string; weightKg: number; trendKg: number }>;
}) {
  const { theme } = useUnistyles();
  if (entries.length === 0) return null;
  const w = Math.min(320, Dimensions.get("window").width - 100);
  const h = 150;
  const pad = 10;
  const trendByDate: Record<string, number> = Object.fromEntries(
    trendPoints.map((p) => [p.date, p.trendKg]),
  );
  const values = entries.map((e) => e.weightKg);
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const x = (i: number) =>
    entries.length === 1 ? w / 2 : pad + (i / (entries.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
  const linePts = entries
    .map((e, i) => ({ x: x(i), y: e.date in trendByDate ? y(trendByDate[e.date]) : null }))
    .filter((p): p is { x: number; y: number } => p.y !== null);
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      {linePts.length > 1 ? (
        <Polyline
          points={linePts.map((p) => `${p.x},${p.y}`).join(" ")}
          stroke={theme.colors.makan}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />
      ) : null}
      {entries.map((e, i) => (
        <Circle
          key={e.date}
          cx={x(i)}
          cy={y(e.weightKg)}
          r={3}
          fill={theme.colors.mutedForeground}
        />
      ))}
    </Svg>
  );
}

export default function Berat() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const [range, setRange] = useState<Range>("30");
  const [sheetOpen, setSheetOpen] = useState(false);

  const historyQuery = useQuery({
    ...orpc.weight.history.queryOptions({ input: { limit: Number(range) } }),
    placeholderData: (prev) => prev,
  });
  const dayQuery = useQuery(orpc.day.summary.queryOptions({ input: {} }));
  const trend = dayQuery.data?.trend ?? null;

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (historyQuery.isPending) {
    return (
      <Screen>
        <PageHeader title="Berat" />
        <Skeleton width="100%" height={140} radius={24} />
        <Skeleton width="100%" height={220} radius={24} />
        <Skeleton width="100%" height={180} radius={24} />
      </Screen>
    );
  }
  if (historyQuery.isError) {
    return (
      <Screen>
        <PageHeader title="Berat" />
        <ErrorState
          message={errorMessage(historyQuery.error)}
          onRetry={() => historyQuery.refetch()}
        />
      </Screen>
    );
  }

  const summary = historyQuery.data.summary;
  const entries = historyQuery.data.entries;
  const hasData = summary.latestKg !== null;

  return (
    <Screen>
      <PageHeader
        title="Berat"
        caption="Angka tren lebih bisa dipercaya daripada timbangan harian"
      />

      {hasData ? (
        <>
          {/* Big trend number + rate + projection */}
          <Card>
            <Text style={styles.trendLabel}>Berat tren</Text>
            <View style={styles.trendRow}>
              <Num style={styles.trendValue} adjustsFontSizeToFit numberOfLines={1}>
                {trend ? fmtKg(trend.weightKg) : fmtKg(summary.latestKg)}
              </Num>
              <Text style={styles.trendUnit}>kg</Text>
            </View>
            {trend?.weeklyRateKg != null ? (
              <View style={styles.rateBadge}>
                <Text style={styles.rateText}>
                  {trend.weeklyRateKg < 0 ? "Turun" : trend.weeklyRateKg > 0 ? "Naik" : "Stabil"}{" "}
                  {fmtKg(Math.abs(trend.weeklyRateKg))} kg/minggu
                </Text>
                {trend.projectedDate ? (
                  <Text style={styles.rateSub}>menuju target {fmtDateId(trend.projectedDate)}</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.note}>
                Timbang beberapa hari lagi untuk melihat laju per minggu.
              </Text>
            )}
            <Button
              label="Timbang hari ini"
              icon="scale-outline"
              onPress={() => setSheetOpen(true)}
            />
            {!dayQuery.isPending && dayQuery.data?.weightLoggedToday ? (
              <Text style={styles.note}>
                Tersimpan untuk hari ini. Menyimpan lagi menimpa angka tadi.
              </Text>
            ) : null}
          </Card>

          {/* Chart */}
          <Card>
            <View style={styles.chartHead}>
              <Text style={styles.chartTitle}>Perjalanan berat</Text>
              <View style={styles.rangeBox}>
                <Segmented
                  options={[
                    { value: "30", label: "30 hari" },
                    { value: "90", label: "90 hari" },
                  ]}
                  value={range}
                  onChange={(value) => setRange(value)}
                />
              </View>
            </View>
            <WeightChart entries={entries} trendPoints={trend?.points ?? []} />
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: theme.colors.mutedForeground }]}
                />
                <Text style={styles.legendText}>Timbangan</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.makan }]} />
                <Text style={styles.legendText}>Garis tren</Text>
              </View>
            </View>
          </Card>

          {/* Summary cells */}
          <View style={styles.statGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Mulai</Text>
              <Num style={styles.statValue}>
                {summary.startKg !== null ? `${fmtKg(summary.startKg)}` : "-"}
              </Num>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Sekarang</Text>
              <Num style={styles.statValue}>{fmtKg(summary.latestKg)}</Num>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Berubah</Text>
              <Num style={styles.statValue}>
                {summary.deltaKg !== null
                  ? `${summary.deltaKg > 0 ? "+" : ""}${fmtKg(summary.deltaKg)}`
                  : "-"}
              </Num>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Sisa ke target</Text>
              <Num style={styles.statValue}>
                {summary.remainingKg !== null ? `${fmtKg(summary.remainingKg)}` : "-"}
              </Num>
            </View>
          </View>
        </>
      ) : (
        <EmptyState
          icon="scale-outline"
          title="Belum ada catatan berat"
          description="Simpan timbangan pertamamu untuk mulai melihat tren dan proyeksi target."
          action={<Button label="Timbang sekarang" onPress={() => setSheetOpen(true)} />}
        />
      )}

      {/* History */}
      {entries.length > 0 ? (
        <Card style={styles.historyCard}>
          <Text style={styles.historyTitle}>Riwayat</Text>
          <ListGroup style={styles.historyGroup}>
            {entries
              .slice()
              .toReversed()
              .map((entry, index, arr) => {
                const newer = index > 0 ? arr[index - 1] : null;
                const delta = newer ? entry.weightKg - newer.weightKg : null;
                return (
                  <ListRow
                    key={entry.id}
                    title={fmtDateId(entry.date)}
                    value={`${fmtKg(entry.weightKg)} kg`}
                    subtitle={
                      delta !== null && Math.abs(delta) >= 0.05
                        ? `${delta > 0 ? "+" : ""}${fmtKg(delta)} dari sebelumnya`
                        : undefined
                    }
                  />
                );
              })}
          </ListGroup>
        </Card>
      ) : null}

      <WeighInSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        latestKg={summary.latestKg}
      />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  trendLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  trendRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  trendValue: {
    fontSize: theme.fontSize.hero,
    fontWeight: "800",
    letterSpacing: -1.5,
    color: theme.colors.foreground,
  },
  trendUnit: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.mutedForeground,
  },
  rateBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  rateText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  rateSub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.makanText,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  chartHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  chartTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  rangeBox: {
    flexShrink: 1,
  },
  legendRow: {
    flexDirection: "row",
    gap: theme.spacing.lg,
    justifyContent: "center",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
  },
  statCell: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.tile,
    padding: 16,
    gap: 2,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  statValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  historyCard: {
    gap: theme.spacing.sm,
  },
  historyTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    paddingLeft: theme.spacing.xs,
  },
  historyGroup: {
    paddingVertical: 0,
  },
}));
