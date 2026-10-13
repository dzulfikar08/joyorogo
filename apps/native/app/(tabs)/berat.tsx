import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Dimensions, View } from "react-native";
import { Redirect } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, Line, Polyline, Svg, Text as SvgText } from "react-native-svg";

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
import { daysBetween, jakartaToday } from "@joyorogo/api/lib/engine";

import { WeighInSheet } from "@/components/weigh-in-sheet";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { WaistSection } from "@/components/waist-section";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtDateId, fmtKg } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type Range = "30" | "90";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

/** 'YYYY-MM-DD' -> "14 Okt" */
function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]}`;
}

/** 'YYYY-MM-DD' -> "14 Oktober 2026" */
function fmtDateLong(date: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Chart padding leaves room for kg labels (left) and date ticks (bottom). */
const PAD = { top: 18, right: 14, bottom: 24, left: 38 };

/** Trend line over raw scale dots for the selected range, with a dashed
    target line, min/max kg labels, and first/mid/last date ticks. */
function WeightChart({
  entries,
  trendPoints,
  targetKg,
}: {
  entries: Array<{ date: string; weightKg: number }>;
  trendPoints: Array<{ date: string; weightKg: number; trendKg: number }>;
  targetKg: number | null;
}) {
  const { theme } = useUnistyles();
  if (entries.length === 0) return null;
  const w = Math.min(320, Dimensions.get("window").width - 100);
  const h = 170;
  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;
  const weights = entries.map((e) => e.weightKg);
  let lo = Math.min(...weights);
  let hi = Math.max(...weights);
  const span = Math.max(hi - lo, 1);
  // The target line joins the view only when near the data — a goal 20 kg
  // away would flatten the whole trend line.
  const target =
    targetKg !== null && targetKg >= lo - span && targetKg <= hi + span ? targetKg : null;
  if (target !== null) {
    lo = Math.min(lo, target);
    hi = Math.max(hi, target);
  }
  lo -= 0.5;
  hi += 0.5;

  const firstDate = entries[0].date;
  const last = entries[entries.length - 1];
  const spanDays = entries.length > 1 ? Math.max(daysBetween(firstDate, last.date), 1) : 0;
  const x = (date: string) =>
    spanDays === 0
      ? PAD.left + innerW / 2
      : PAD.left + (daysBetween(firstDate, date) / spanDays) * innerW;
  const y = (kg: number) => PAD.top + (1 - (kg - lo) / (hi - lo)) * innerH;

  const trendPts = trendPoints
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ x: x(p.date), y: y(p.trendKg) }));
  const mid = entries[Math.floor((entries.length - 1) / 2)];
  const xTicks = [entries[0], mid, last].filter(
    (e, i, all) => all.findIndex((other) => other.date === e.date) === i,
  );
  const labelColor = theme.colors.mutedForeground;
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      {target !== null ? (
        <Line
          x1={PAD.left}
          x2={w - PAD.right}
          y1={y(target)}
          y2={y(target)}
          stroke={theme.colors.makan}
          strokeOpacity={0.45}
          strokeWidth={1.5}
          strokeDasharray="4 5"
        />
      ) : null}
      {target !== null ? (
        <SvgText
          x={w - PAD.right}
          y={y(target) - 6}
          textAnchor="end"
          fontSize={10}
          fontWeight="600"
          fill={theme.colors.makanText}
        >
          Target {fmtKg(target)}
        </SvgText>
      ) : null}
      {trendPts.length > 1 ? (
        <Polyline
          points={trendPts.map((p) => `${p.x},${p.y}`).join(" ")}
          stroke={theme.colors.makan}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />
      ) : null}
      {entries.map((e) => (
        <Circle
          key={e.date}
          cx={x(e.date)}
          cy={y(e.weightKg)}
          r={3}
          fill={theme.colors.mutedForeground}
        />
      ))}
      <SvgText
        x={PAD.left - 8}
        y={PAD.top + 4}
        textAnchor="end"
        fontSize={10}
        fontWeight="600"
        fill={labelColor}
      >
        {fmtKg(hi)}
      </SvgText>
      <SvgText
        x={PAD.left - 8}
        y={PAD.top + innerH + 4}
        textAnchor="end"
        fontSize={10}
        fontWeight="600"
        fill={labelColor}
      >
        {fmtKg(lo)}
      </SvgText>
      {xTicks.map((t, i) => (
        <SvgText
          key={t.date}
          x={x(t.date)}
          y={h - 6}
          textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          fontSize={10}
          fontWeight="500"
          fill={labelColor}
        >
          {shortDate(t.date)}
        </SvgText>
      ))}
    </Svg>
  );
}

export default function Berat() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const [range, setRange] = useState<Range>("30");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Fetch the full 90-day window once and filter locally per range, so
  // switching ranges never reloads older points.
  const historyQuery = useQuery({
    ...orpc.weight.history.queryOptions({ input: { limit: 90 } }),
    placeholderData: (prev) => prev,
  });
  const dayQuery = useQuery(orpc.day.summary.queryOptions({ input: {} }));
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
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

  const today = jakartaToday();
  const rangeDays = range === "30" ? 30 : 90;
  const rangeEntries = entries.filter((e) => daysBetween(e.date, today) <= rangeDays - 1);
  const rangeTrend = (trend?.points ?? []).filter(
    (p) => daysBetween(p.date, today) <= rangeDays - 1,
  );

  const heightCm = profileQuery.data?.profile?.heightCm ?? null;
  const bmi =
    summary.latestKg !== null && heightCm ? summary.latestKg / (heightCm / 100) ** 2 : null;
  const bmiCategory =
    bmi === null
      ? null
      : bmi < 18.5
        ? "Kurang"
        : bmi < 25
          ? "Ideal"
          : bmi < 30
            ? "Overweight"
            : "Obesitas";

  const trendKg = trend?.weightKg ?? null;
  const goalReached = trendKg !== null && summary.targetKg !== null && trendKg <= summary.targetKg;
  const newestEntries = entries.slice().toReversed();

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
            <View style={styles.trendHead}>
              <View style={styles.trendBlock}>
                <Text style={styles.trendLabel}>Berat tren</Text>
                <View style={styles.trendRow}>
                  <Num style={styles.trendValue} adjustsFontSizeToFit numberOfLines={1}>
                    {trend ? fmtKg(trend.weightKg) : fmtKg(summary.latestKg)}
                  </Num>
                  <Text style={styles.trendUnit}>kg</Text>
                </View>
              </View>
              <View style={styles.badgeCol}>
                {bmi !== null && bmiCategory !== null ? (
                  <View
                    style={[
                      styles.pill,
                      bmiCategory === "Ideal" ? styles.pillIdeal : styles.pillOff,
                    ]}
                  >
                    <Text
                      style={bmiCategory === "Ideal" ? styles.pillTextIdeal : styles.pillTextOff}
                    >
                      <Num>BMI {fmtKg(bmi)}</Num> · {bmiCategory}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.pill}>
                  <Text style={styles.pillMuted}>
                    Timbangan <Num>{fmtKg(summary.latestKg)}</Num> kg
                  </Text>
                </View>
              </View>
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
            {goalReached ? (
              <View style={styles.goalBanner}>
                <Text style={styles.goalBannerText}>
                  Target berat sudah tercapai. Jaga ritmenya.
                </Text>
              </View>
            ) : trend?.projectedDate && summary.targetKg !== null ? (
              <Text style={styles.projection}>
                Dengan ritme ini, target{" "}
                <Text style={styles.projectionStrong}>{fmtKg(summary.targetKg)} kg</Text> tercapai
                sekitar{" "}
                <Text style={styles.projectionStrong}>{fmtDateLong(trend.projectedDate)}</Text>.
              </Text>
            ) : null}
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
            {rangeEntries.length > 1 ? (
              <>
                <WeightChart
                  entries={rangeEntries}
                  trendPoints={rangeTrend}
                  targetKg={summary.targetKg}
                />
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
                  {summary.targetKg !== null ? (
                    <View style={styles.legendItem}>
                      <View style={styles.legendDash} />
                      <Text style={styles.legendText}>Target</Text>
                    </View>
                  ) : null}
                </View>
              </>
            ) : (
              <Text style={styles.chartEmpty}>
                Belum cukup catatan dalam {rangeDays} hari terakhir untuk menggambar grafik.
              </Text>
            )}
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
          <Button
            variant="secondary"
            label="Bagikan progres"
            onPress={() => setShareOpen(true)}
          />
          <ListGroup style={styles.historyGroup}>
            {(showAllHistory ? newestEntries : newestEntries.slice(0, 10)).map((entry, index) => {
              const newer = index > 0 ? newestEntries[index - 1] : null;
              const delta = newer ? entry.weightKg - newer.weightKg : null;
              return (
                <ListRow
                  key={entry.id}
                  title={entry.date === today ? "Hari ini" : fmtDateId(entry.date)}
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
          {entries.length > 10 ? (
            <Button
              variant="secondary"
              label={
                showAllHistory ? "Tampilkan lebih sedikit" : `Tampilkan semua (${entries.length})`
              }
              onPress={() => setShowAllHistory((v) => !v)}
            />
          ) : null}
        </Card>
      ) : null}

      <WaistSection gender={profileQuery.data?.profile?.gender ?? null} heightCm={heightCm} />

      <WeighInSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        latestKg={summary.latestKg}
      />

      {newestEntries[0] ? (
        <ShareToFeedSheet
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          title="Check-in berat badan"
          preview={`${fmtKg(newestEntries[0].weightKg)} kg${
            trendKg !== null && summary.latestKg !== null
              ? ` · tren ${fmtKg(trendKg)} kg`
              : ""
          }`}
          kind="berat"
          refId={newestEntries[0].id}
        />
      ) : null}
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
  trendHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  trendBlock: {
    flexShrink: 1,
  },
  badgeCol: {
    alignItems: "flex-end",
    gap: theme.spacing.xs,
  },
  pill: {
    backgroundColor: theme.colors.muted,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillIdeal: {
    backgroundColor: theme.colors.makanSoft,
  },
  pillOff: {
    backgroundColor: theme.colors.bakarSoft,
  },
  pillTextIdeal: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  pillTextOff: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.bakarText,
  },
  pillMuted: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  goalBanner: {
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.tile,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  goalBannerText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  projection: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  projectionStrong: {
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  legendDash: {
    width: 14,
    height: 0,
    borderTopWidth: 2,
    borderTopColor: theme.colors.makan,
    borderStyle: "dashed",
    opacity: 0.45,
  },
  chartEmpty: {
    paddingVertical: 40,
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  chartHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  chartTitle: {
    flexShrink: 1,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  // Segmented options are flex: 1 (basis 0); inside an auto-width box they
  // collapse to nothing on React Native, so the switcher needs a real width.
  rangeBox: {
    width: 184,
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
