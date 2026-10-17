import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { Animated, PanResponder, Pressable, useWindowDimensions, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  Circle,
  Defs,
  Line,
  Pattern,
  Polyline,
  Rect,
  Svg,
  Text as SvgText,
} from "react-native-svg";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  daysBetween,
  emaTrendPoints,
  jakartaToday,
  rangeStats,
  shiftDate,
  type RangeStats,
} from "@joyorogo/api/lib/engine";
import { kcalBars, kcalSummary, type KcalBar } from "@joyorogo/api/lib/kcal-bars";

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

import { Mascot } from "@/components/mascot";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { WaistSection } from "@/components/waist-section";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtDateId, fmtKg } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type Range = "7" | "30" | "90" | "all";

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

/** 'YYYY-MM-DD' -> "14 Okt 2025" (tooltips, where the year matters). */
function mediumDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]} ${y}`;
}

/** 'YYYY-MM-DD' -> "Mar 2027" (projection cell). */
function monthYear(date: string): string {
  const [y, m] = date.split("-");
  return `${MONTHS_SHORT[Number(m) - 1]} ${y}`;
}

const KG_LADDER = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50] as const;

/** Smallest ladder step keeping the y-axis at ~5 ticks or fewer. */
function niceStep(spanKg: number): number {
  for (const step of KG_LADDER) if (spanKg / step <= 5) return step;
  return 100;
}

const DAY_LADDER = [1, 2, 3, 7, 10, 14, 30, 60, 90, 120, 180, 365, 730] as const;

/** Day gap between x ticks: roughly 3–4 date labels for any span. */
function niceDayStep(spanDays: number): number {
  for (const step of DAY_LADDER) if (spanDays / step <= 3.5) return step;
  return 730;
}

/** Friendly sub-caption for the projection stat, per reason it is (not) shown. */
function projectionNote(stats: RangeStats, targetKg: number | null, goalReached: boolean): string {
  if (targetKg === null) return "atur target di Profil";
  if (goalReached) return "sudah tercapai, jaga ritmenya";
  if (stats.projectedDate !== null) return `menuju ${fmtKg(targetKg)} kg`;
  if (stats.weeklyRateKg === null || stats.changeKg === null) return "butuh lebih banyak catatan";
  if (Math.abs(stats.weeklyRateKg) < 0.05) return "ritme sedang stabil";
  const toward = (stats.trendKg - targetKg) * stats.weeklyRateKg < 0;
  return toward ? "hampir ada, teruskan" : "ritme terakhir menjauhi target";
}

/** Chart padding leaves room for kg labels (left) and date ticks (bottom). */
const PAD = { top: 18, right: 38, bottom: 24, left: 38 };

/** Calorie bars live in the bottom share of the plot, on their own (right) axis. */
const BAR_ZONE = 0.38;
/** An untracked day's hatched placeholder, as a share of the bar zone. */
const GHOST_SHARE = 0.45;

/** 2140 -> "2,1k" for the compact right axis. */
function kcalAxis(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}k`;
}

/** Trend chart for the selected range: 7-day EMA line over faint daily dots,
    dashed target line, dotted start line, nice kg gridlines, day-based date
    ticks, a fade-in on range change, and a pan-scrub crosshair + tooltip. */
function WeightChart({
  entries,
  trendPoints,
  targetKg,
  startKg,
  domainStart,
  domainEnd,
  rangeKey,
  bars,
  weekly,
  targetKcal,
}: {
  /** raw scale weigh-ins in the range, oldest first */
  entries: Array<{ date: string; weightKg: number }>;
  /** EMA trend over the same range, oldest first */
  trendPoints: Array<{ date: string; trendKg: number }>;
  targetKg: number | null;
  startKg: number | null;
  domainStart: string;
  domainEnd: string;
  /** replays the fade-in when the range changes */
  rangeKey: string;
  /** calorie bars over the same time axis (daily, or per week on long ranges) */
  bars: KcalBar[];
  weekly: boolean;
  targetKcal: number | null;
}) {
  const { theme } = useUnistyles();
  const { width: winW } = useWindowDimensions();
  // Screen (20) + Card (20) padding on each side.
  const w = Math.min(winW - 80, 400);
  const h = 210;
  const [scrubDate, setScrubDate] = useState<string | null>(null);

  // Draw-in on range change: quick fade with a small rise, static under the
  // reduced-motion escape hatch is unnecessary — 450ms opacity is subtle.
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [fade, rangeKey]);

  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;
  const spanDays = Math.max(daysBetween(domainStart, domainEnd), 1);
  const x = (date: string) =>
    PAD.left +
    (Math.min(Math.max(daysBetween(domainStart, date), 0), spanDays) / spanDays) * innerW;

  // Y domain from raw + trend values; the target/start lines join only when
  // near the data — a goal 20 kg away would flatten the whole trend line.
  const values = [...entries.map((e) => e.weightKg), ...trendPoints.map((p) => p.trendKg)];
  const rawLo = Math.min(...values);
  const rawHi = Math.max(...values);
  const valSpan = Math.max(rawHi - rawLo, 1);
  const near = (kg: number) => kg >= rawLo - valSpan && kg <= rawHi + valSpan;
  const target = targetKg !== null && near(targetKg) ? targetKg : null;
  const start =
    startKg !== null && near(startKg) && (target === null || Math.abs(startKg - target) > 0.01)
      ? startKg
      : null;
  // Step is chosen from the FULL domain (lines included) so the tick count
  // stays ~5 no matter how much the reference lines stretch the view.
  const dataLo = Math.min(
    rawLo,
    ...(target !== null ? [target] : []),
    ...(start !== null ? [start] : []),
  );
  const dataHi = Math.max(
    rawHi,
    ...(target !== null ? [target] : []),
    ...(start !== null ? [start] : []),
  );
  const padKg = Math.max((dataHi - dataLo) * 0.08, 0.2);
  const step = niceStep(dataHi - dataLo + 2 * padKg);
  let lo = Math.floor((dataLo - padKg) / step) * step;
  let hi = Math.ceil((dataHi + padKg) / step) * step;
  const y = (kg: number) => PAD.top + (1 - (kg - lo) / (hi - lo)) * innerH;
  const yTicks = Array.from(
    { length: Math.round((hi - lo) / step) + 1 },
    (_, i) => Math.round((lo + i * step) * 100) / 100,
  );
  const tickFmt = (kg: number) =>
    kg.toLocaleString("id-ID", {
      minimumFractionDigits: step < 1 ? 1 : 0,
      maximumFractionDigits: step < 1 ? 1 : 0,
    });

  const dayStep = niceDayStep(spanDays);
  const xTickDates: string[] = [];
  for (let d = 0; d <= spanDays; d += dayStep) xTickDates.push(shiftDate(domainStart, d));
  if (spanDays - (xTickDates.length - 1) * dayStep >= dayStep * 0.5) {
    xTickDates.push(domainEnd);
  }

  const scrubTo = (px: number) => {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const e of entries) {
      const d = Math.abs(x(e.date) - px);
      if (d < bestDist) {
        bestDist = d;
        best = e.date;
      }
    }
    setScrubDate(best);
  };
  // Pan handlers are created once; route them through a ref so they always
  // see the current entries instead of the first render's.
  const scrubRef = useRef(scrubTo);
  scrubRef.current = scrubTo;
  const panResponder = useRef(
    PanResponder.create({
      // Horizontal drags scrub the chart; vertical ones still scroll the page.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dy) < 14,
      onPanResponderGrant: (event) => scrubRef.current(event.nativeEvent.locationX),
      onPanResponderMove: (event) => scrubRef.current(event.nativeEvent.locationX),
      onPanResponderTerminate: () => setScrubDate(null),
    }),
  ).current;

  const scrubIdx = scrubDate ? entries.findIndex((e) => e.date === scrubDate) : -1;
  const scrubEntry = scrubIdx >= 0 ? entries[scrubIdx] : undefined;
  const scrubTrend = scrubEntry ? trendPoints.find((p) => p.date === scrubEntry.date) : undefined;
  const scrubPrev = scrubEntry && scrubIdx > 0 ? entries[scrubIdx - 1] : undefined;
  const scrubDelta = scrubEntry && scrubPrev ? scrubEntry.weightKg - scrubPrev.weightKg : null;
  const deltaColor =
    scrubDelta === null || scrubDelta === 0
      ? theme.colors.mutedForeground
      : scrubDelta < 0
        ? theme.colors.makanText
        : theme.colors.bakarText;

  const TIP_W = 196;
  const TIP_H = 132;
  let tipLeft = 0;
  let tipTop = 0;
  if (scrubEntry) {
    const px = x(scrubEntry.date);
    tipLeft = Math.min(
      Math.max(px > w * 0.58 ? px - TIP_W - 8 : px + 8, 0),
      Math.max(w - TIP_W, 0),
    );
    tipTop = Math.min(Math.max(y(scrubEntry.weightKg) - 24, 0), Math.max(h - TIP_H, 0));
  }

  const trendPts = trendPoints.map((p) => ({ x: x(p.date), y: y(p.trendKg) }));
  const labelColor = theme.colors.mutedForeground;
  // Secondary axis: kcal 0..maxK in the bottom BAR_ZONE of the plot.
  const baseY = PAD.top + innerH;
  const zoneH = innerH * BAR_ZONE;
  const maxK = Math.max(
    500,
    Math.ceil((Math.max(targetKcal ?? 0, ...bars.map((b) => b.avgKcal ?? 0)) * 1.1) / 500) * 500,
  );
  const ky = (kcal: number) => baseY - (kcal / maxK) * zoneH;
  const pxPerDay = innerW / spanDays;
  const barGeom = (b: KcalBar) => {
    if (weekly) {
      return { left: x(b.from), w: Math.max((daysBetween(b.from, b.to) + 1) * pxPerDay - 2, 2) };
    }
    const bw = Math.max(pxPerDay * 0.7, 1.5);
    return { left: x(b.from) - bw / 2, w: bw };
  };
  const scrubBar = scrubEntry
    ? bars.find((b) => b.from <= scrubEntry.date && scrubEntry.date <= b.to)
    : undefined;
  const lastIdx = entries.length - 1;
  return (
    <Animated.View
      style={{
        width: w,
        height: h,
        opacity: fade,
        transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      <View style={{ width: w, height: h }} {...panResponder.panHandlers}>
        <Svg
          width={w}
          height={h}
          accessibilityLabel="Grafik tren berat badan. Geser untuk melihat tiap catatan."
        >
          <Defs>
            <Pattern
              id="kcal-hatch"
              width={4}
              height={4}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <Line
                x1={0}
                y1={0}
                x2={0}
                y2={4}
                stroke={theme.colors.mutedForeground}
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
            </Pattern>
          </Defs>
          {bars.map((b) => {
            const { left, w: bw } = barGeom(b);
            const barH = b.avgKcal === null ? 0 : baseY - ky(b.avgKcal);
            const ghostH = zoneH * GHOST_SHARE * (b.untrackedDays / b.days);
            const over = targetKcal !== null && b.avgKcal !== null && b.avgKcal > targetKcal;
            return (
              <Fragment key={b.from}>
                {b.avgKcal !== null ? (
                  <Rect
                    x={left}
                    y={baseY - barH}
                    width={bw}
                    height={barH}
                    rx={Math.min(bw / 4, 2)}
                    fill={theme.colors.bakar}
                    fillOpacity={over ? 0.8 : 0.35}
                  />
                ) : null}
                {ghostH > 0 ? (
                  <Rect
                    x={left}
                    y={baseY - barH - ghostH}
                    width={bw}
                    height={ghostH}
                    fill="url(#kcal-hatch)"
                  />
                ) : null}
              </Fragment>
            );
          })}
          {targetKcal !== null ? (
            <Line
              x1={PAD.left}
              x2={w - PAD.right}
              y1={ky(targetKcal)}
              y2={ky(targetKcal)}
              stroke={theme.colors.bakarText}
              strokeOpacity={0.7}
              strokeWidth={1.25}
              strokeDasharray="6 4"
            />
          ) : null}
          {[maxK / 2, maxK].map((k) => (
            <SvgText
              key={k}
              x={w - PAD.right + 5}
              y={ky(k) + 3}
              fontSize={10}
              fontWeight="600"
              fill={theme.colors.bakarText}
            >
              {kcalAxis(k)}
            </SvgText>
          ))}
          {yTicks.map((t) => (
            <Line
              key={t}
              x1={PAD.left}
              x2={w - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={theme.colors.hairline}
              strokeWidth={1}
            />
          ))}
          {yTicks.map((t) => (
            <SvgText
              key={t}
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={10}
              fontWeight="600"
              fill={labelColor}
            >
              {tickFmt(t)}
            </SvgText>
          ))}

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
          {start !== null ? (
            <Line
              x1={PAD.left}
              x2={w - PAD.right}
              y1={y(start)}
              y2={y(start)}
              stroke={labelColor}
              strokeOpacity={0.45}
              strokeWidth={1.25}
              strokeDasharray="2 5"
            />
          ) : null}
          {start !== null ? (
            <SvgText
              x={PAD.left}
              y={
                (target !== null && Math.abs(y(start) - y(target)) < 15) || y(start) < PAD.top + 14
                  ? y(start) + 15
                  : y(start) - 6
              }
              fontSize={10}
              fontWeight="600"
              fill={labelColor}
            >
              Awal {fmtKg(start)}
            </SvgText>
          ) : null}

          <Polyline
            points={trendPts.map((p) => `${p.x},${p.y}`).join(" ")}
            stroke={theme.colors.makan}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
          {entries.map((e, i) => (
            <Circle
              key={e.date}
              cx={x(e.date)}
              cy={y(e.weightKg)}
              r={i === lastIdx ? 4 : 2.5}
              fill={theme.colors.makan}
              fillOpacity={i === lastIdx ? 1 : 0.35}
            />
          ))}

          {scrubEntry ? (
            <>
              <Line
                x1={x(scrubEntry.date)}
                x2={x(scrubEntry.date)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke={labelColor}
                strokeOpacity={0.4}
                strokeWidth={1}
              />
              <Circle
                cx={x(scrubEntry.date)}
                cy={y(scrubEntry.weightKg)}
                r={6}
                fill={theme.colors.makan}
                fillOpacity={0.2}
              />
              <Circle
                cx={x(scrubEntry.date)}
                cy={y(scrubEntry.weightKg)}
                r={3.5}
                fill={theme.colors.makan}
                stroke={theme.colors.card}
                strokeWidth={1.5}
              />
              {scrubTrend ? (
                <Circle
                  cx={x(scrubTrend.date)}
                  cy={y(scrubTrend.trendKg)}
                  r={3.5}
                  fill={theme.colors.card}
                  stroke={theme.colors.makan}
                  strokeWidth={2}
                />
              ) : null}
            </>
          ) : null}

          {xTickDates.map((t, i) => (
            <SvgText
              key={t}
              x={x(t)}
              y={h - 6}
              textAnchor={i === 0 ? "start" : i === xTickDates.length - 1 ? "end" : "middle"}
              fontSize={10}
              fontWeight="500"
              fill={labelColor}
            >
              {shortDate(t)}
            </SvgText>
          ))}
        </Svg>

        {scrubEntry ? (
          <View pointerEvents="none" style={[styles.chartTip, { left: tipLeft, top: tipTop }]}>
            <Text style={styles.chartTipDate}>{mediumDate(scrubEntry.date)}</Text>
            <View style={styles.chartTipRow}>
              <Text style={styles.chartTipLabel}>Timbangan</Text>
              <Num style={styles.chartTipValue}>{fmtKg(scrubEntry.weightKg)} kg</Num>
            </View>
            {scrubTrend ? (
              <View style={styles.chartTipRow}>
                <Text style={styles.chartTipLabel}>Tren</Text>
                <Num style={styles.chartTipValue}>{fmtKg(scrubTrend.trendKg)} kg</Num>
              </View>
            ) : null}
            {scrubBar ? (
              <View style={styles.chartTipRow}>
                <Text style={styles.chartTipLabel}>{weekly ? "Kalori/hari" : "Kalori"}</Text>
                <Num style={styles.chartTipValue}>
                  {scrubBar.avgKcal === null
                    ? "tak dicatat"
                    : `${scrubBar.avgKcal.toLocaleString("id-ID")} kcal`}
                  {weekly && scrubBar.untrackedDays > 0 && scrubBar.avgKcal !== null
                    ? ` · ${scrubBar.untrackedDays} kosong`
                    : ""}
                </Num>
              </View>
            ) : null}
            <View style={styles.chartTipRow}>
              <Text style={styles.chartTipLabel}>vs sebelumnya</Text>
              <Text style={[styles.chartTipValue, { color: deltaColor }]}>
                {scrubDelta === null
                  ? "pertama"
                  : scrubDelta === 0
                    ? "sama"
                    : `${scrubDelta < 0 ? "−" : "+"}${fmtKg(Math.abs(scrubDelta))} kg`}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

export default function Berat() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const [range, setRange] = useState<Range>("30");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Fetch the full year (the API cap) once and filter locally per range, so
  // switching ranges — including "Semua" — never reloads older points.
  const historyQuery = useQuery({
    ...orpc.weight.history.queryOptions({ input: { limit: 365 } }),
    placeholderData: (prev) => prev,
  });
  const dayQuery = useQuery(orpc.day.summary.queryOptions({ input: {} }));
  // One fetch of the last 400 days (the API cap); ranges filter locally.
  const kcalQuery = useQuery(
    orpc.day.kcalSeries.queryOptions({
      input: { from: shiftDate(jakartaToday(), -399), to: jakartaToday() },
    }),
  );
  const [showDetail, setShowDetail] = useState(false);
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
  // Chart line: client-side 7-day EMA over the raw entries, so every range —
  // including "Semua" — gets a full trend (day.summary only ships 30 days).
  const allTrend = useMemo(() => emaTrendPoints(entries), [entries]);
  const rangeDays = range === "all" ? null : Number(range);
  const cutoff = rangeDays === null ? null : shiftDate(today, -(rangeDays - 1));
  const rangeEntries = cutoff === null ? entries : entries.filter((e) => e.date >= cutoff);
  const rangeTrend = cutoff === null ? allTrend : allTrend.filter((p) => p.date >= cutoff);
  const rangeStatsOut = rangeStats(rangeTrend, summary.targetKg);
  const rangeLabel = range === "all" ? "sejak awal" : `${range} hari terakhir`;
  const domainStart = cutoff ?? rangeEntries[0]?.date ?? today;
  const targetKcal = dayQuery.data?.targets?.eatKcal ?? null;
  const kcalRange = kcalQuery.data ?? [];
  const { bars: kcalBarList, weekly: kcalWeekly } = kcalBars(kcalRange, domainStart, today);
  const kcalStats = kcalSummary(kcalRange, domainStart, today);
  // Losing only counts as good while the target sits below the start weight.
  const wantDown =
    summary.targetKg === null || summary.targetKg <= (summary.startKg ?? Number.POSITIVE_INFINITY);
  const toneFor = (delta: number | null): "makan" | "bakar" | null => {
    if (delta === null || Math.abs(delta) < 0.05) return null;
    return (wantDown ? delta < 0 : delta > 0) ? "makan" : "bakar";
  };
  const lastRangeDate = rangeEntries.at(-1)?.date ?? null;

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
    <>
      <Stack.Screen options={{ title: "Berat" }} />
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
                </View>
              ) : (
                <Text style={styles.note}>
                  Timbang beberapa hari lagi untuk melihat laju per minggu.
                </Text>
              )}
              {goalReached ? (
                <View style={styles.goalBanner}>
                  <Mascot pose="mantap" size="sm" />
                  <Text style={styles.goalBannerText}>
                    Target berat sudah tercapai. Jaga ritmenya.
                  </Text>
                </View>
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
              </View>
              <View style={styles.rangeBox}>
                <Segmented
                  options={[
                    { value: "7", label: "7H" },
                    { value: "30", label: "30H" },
                    { value: "90", label: "90H" },
                    { value: "all", label: "Semua" },
                  ]}
                  value={range}
                  onChange={(value) => setRange(value)}
                />
              </View>

              {rangeEntries.length === 0 ? (
                <View style={styles.chartEmptyBox}>
                  <Text style={styles.chartEmptyTitle}>Belum ada catatan {rangeLabel}.</Text>
                  <Text style={styles.chartEmpty}>
                    Pilih rentang lebih panjang, atau catat beratmu untuk mulai mengisi grafik.
                  </Text>
                  <Button
                    variant="secondary"
                    label="Catat berat"
                    onPress={() => setSheetOpen(true)}
                  />
                </View>
              ) : (
                <>
                  <View style={styles.chartStats}>
                    <View style={styles.chartStatCell}>
                      <Text style={styles.chartStatLabel}>Berat tren</Text>
                      <Num style={styles.chartStatValue}>{fmtKg(rangeStatsOut.trendKg)}</Num>
                      <Text style={styles.chartStatSub}>
                        {lastRangeDate !== null ? `terakhir ${shortDate(lastRangeDate)}` : " "}
                      </Text>
                    </View>
                    <View style={styles.chartStatCell}>
                      <Text style={styles.chartStatLabel}>Perubahan</Text>
                      <Num
                        style={[
                          styles.chartStatValue,
                          toneFor(rangeStatsOut.changeKg) === "makan" && {
                            color: theme.colors.makanText,
                          },
                          toneFor(rangeStatsOut.changeKg) === "bakar" && {
                            color: theme.colors.bakarText,
                          },
                        ]}
                      >
                        {rangeStatsOut.changeKg === null
                          ? "–"
                          : `${rangeStatsOut.changeKg < 0 ? "−" : "+"}${fmtKg(Math.abs(rangeStatsOut.changeKg))} kg`}
                      </Num>
                      <Text style={styles.chartStatSub}>{rangeLabel}</Text>
                    </View>
                    <View style={styles.chartStatCell}>
                      <Text style={styles.chartStatLabel}>Laju</Text>
                      <Num
                        style={[
                          styles.chartStatValue,
                          toneFor(rangeStatsOut.weeklyRateKg) === "makan" && {
                            color: theme.colors.makanText,
                          },
                          toneFor(rangeStatsOut.weeklyRateKg) === "bakar" && {
                            color: theme.colors.bakarText,
                          },
                        ]}
                      >
                        {rangeStatsOut.weeklyRateKg === null
                          ? "–"
                          : `${
                              rangeStatsOut.weeklyRateKg < 0
                                ? "−"
                                : rangeStatsOut.weeklyRateKg > 0
                                  ? "+"
                                  : ""
                            }${fmtKg(Math.abs(rangeStatsOut.weeklyRateKg))} kg/minggu`}
                      </Num>
                      <Text style={styles.chartStatSub}>rata-rata rentang</Text>
                    </View>
                    <View style={styles.chartStatCell}>
                      <Text style={styles.chartStatLabel}>Proyeksi</Text>
                      <Num style={styles.chartStatValue}>
                        {rangeStatsOut.projectedDate !== null
                          ? `±${monthYear(rangeStatsOut.projectedDate)}`
                          : "–"}
                      </Num>
                      <Text style={styles.chartStatSub}>
                        {projectionNote(rangeStatsOut, summary.targetKg, goalReached)}
                      </Text>
                    </View>
                  </View>

                  {rangeEntries.length === 1 ? (
                    <Text style={styles.chartHint}>
                      Timbang lagi besok untuk mulai melihat garis tren.
                    </Text>
                  ) : null}
                  <WeightChart
                    entries={rangeEntries}
                    trendPoints={rangeTrend}
                    targetKg={summary.targetKg}
                    startKg={summary.startKg}
                    domainStart={domainStart}
                    domainEnd={today}
                    rangeKey={range}
                    bars={kcalBarList}
                    weekly={kcalWeekly}
                    targetKcal={targetKcal}
                  />
                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: theme.colors.makan, opacity: 0.35 },
                        ]}
                      />
                      <Text style={styles.legendText}>Berat</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendLine, { backgroundColor: theme.colors.makan }]} />
                      <Text style={styles.legendText}>Tren</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={styles.legendBars}>
                        <View style={[styles.legendSquare, { opacity: 0.35 }]} />
                        <View style={[styles.legendSquare, { opacity: 0.8 }]} />
                      </View>
                      <Text style={styles.legendText}>Kalori</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <Svg width={10} height={10}>
                        <Defs>
                          <Pattern
                            id="kcal-hatch-legend"
                            width={4}
                            height={4}
                            patternUnits="userSpaceOnUse"
                            patternTransform="rotate(45)"
                          >
                            <Line
                              x1={0}
                              y1={0}
                              x2={0}
                              y2={4}
                              stroke={theme.colors.mutedForeground}
                              strokeOpacity={0.6}
                              strokeWidth={1.5}
                            />
                          </Pattern>
                        </Defs>
                        <Rect width={10} height={10} rx={2} fill="url(#kcal-hatch-legend)" />
                      </Svg>
                      <Text style={styles.legendText}>Belum dicatat</Text>
                    </View>
                    {targetKcal !== null ? (
                      <View style={styles.legendItem}>
                        <View style={styles.legendDashKcal} />
                        <Text style={styles.legendText}>Target kalori</Text>
                      </View>
                    ) : null}
                  </View>
                  {kcalQuery.data ? (
                    <Num style={styles.kcalSummary}>
                      {kcalStats.trackedDays === 0
                        ? "Belum ada kalori tercatat"
                        : `Tercatat ${kcalStats.trackedDays} dari ${kcalStats.days} hari · rata-rata ${(kcalStats.avgKcal ?? 0).toLocaleString("id-ID")} kcal`}
                    </Num>
                  ) : null}
                </>
              )}
              <Pressable
                onPress={() => setShowDetail((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showDetail }}
                hitSlop={8}
              >
                <Text style={styles.detailToggle}>{showDetail ? "Detail ▴" : "Detail ▾"}</Text>
              </Pressable>
              {showDetail ? (
                <Text style={styles.chartCaption}>
                  Garis = tren (rata-rata bergerak 7 hari), titik = timbangan harian. Batang =
                  kalori harian yang dicatat (gelap = di atas target, terang = di bawah); area
                  garis-garis = hari tanpa catatan makan
                  {kcalWeekly ? "; rentang panjang dirata-rata per minggu per hari tercatat" : ""}.
                  {summary.deltaKg !== null
                    ? ` Total ${summary.deltaKg < 0 ? "turun" : "naik"} ${fmtKg(Math.abs(summary.deltaKg))} kg sejak berat awal.`
                    : ""}
                </Text>
              ) : null}
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
              trendKg !== null && summary.latestKg !== null ? ` · tren ${fmtKg(trendKg)} kg` : ""
            }`}
            kind="berat"
            refId={newestEntries[0].id}
          />
        ) : null}
      </Screen>
    </>
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
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  goalBannerText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  legendDash: {
    width: 14,
    height: 0,
    borderTopWidth: 2,
    borderTopColor: theme.colors.makan,
    borderStyle: "dashed",
    opacity: 0.45,
  },
  chartEmptyBox: {
    alignItems: "center",
    paddingVertical: 28,
    gap: theme.spacing.sm,
  },
  chartEmptyTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  chartEmpty: {
    textAlign: "center",
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
    flexShrink: 1,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  // The segmented control spans the card so four options (7H..Semua) fit.
  rangeBox: {
    width: "100%",
    marginTop: theme.spacing.sm,
  },
  chartStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  chartStatCell: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  chartStatLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  chartStatValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  chartStatSub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  chartHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    marginTop: theme.spacing.sm,
  },
  chartCaption: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 18,
    marginTop: theme.spacing.sm,
  },
  chartTip: {
    position: "absolute",
    width: 196,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
    padding: 10,
    gap: 3,
  },
  chartTipDate: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  chartTipRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  chartTipLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  chartTipValue: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  legendRow: {
    flexDirection: "row",
    gap: theme.spacing.lg,
    justifyContent: "center",
    flexWrap: "wrap",
    rowGap: 4,
  },
  detailToggle: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  kcalSummary: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  legendLine: {
    width: 12,
    height: 2,
    borderRadius: 1,
  },
  legendBars: {
    flexDirection: "row",
    gap: 1,
  },
  legendSquare: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: theme.colors.bakar,
  },
  legendDashKcal: {
    width: 14,
    height: 0,
    borderTopWidth: 2,
    borderTopColor: theme.colors.bakarText,
    borderStyle: "dashed",
    opacity: 0.7,
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
