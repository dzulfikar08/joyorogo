import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { Animated, PanResponder, useWindowDimensions, View } from "react-native";
import { Redirect } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  Circle,
  Defs,
  Line,
  Pattern,
  Polygon,
  Polyline,
  Rect,
  Svg,
  Text as SvgText,
} from "react-native-svg";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { daysBetween, emaTrendPoints, jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { kcalBars, kcalSummary, type KcalBar } from "@joyorogo/api/lib/kcal-bars";
import { gainDayHit } from "@joyorogo/api/lib/gain";
import { periodWeight, type PeriodWeight } from "@joyorogo/api/lib/period-progress";

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
import { ShareStoryButton } from "@/components/story/share-story-button";
import type { StorySpec } from "@/components/story/types";
import { weightGoalProgress } from "@joyorogo/sticker";
import { WaistSection } from "@/components/waist-section";
import { WeightGainCard } from "@/components/maternal/weight-gain-chart";
import { useMaternal } from "@/components/maternal/use-maternal";
import { GainNotes } from "@/components/gain/gain-notes";
import { useGain } from "@/components/gain/use-gain";
import { Disclosure } from "@/components/disclosure";
import { useSessionGate } from "@/lib/use-session-gate";
import { fmtDate, fmtDecimal, fmtNumber } from "@joyorogo/i18n";
import {
  errorMessage,
  fmtDateMedium,
  fmtDateShort,
  fmtInt,
  fmtKcalLabel,
  fmtKg,
} from "@/utils/format";
import { orpc } from "@/utils/orpc";

type Range = "7" | "30" | "90" | "all";

/** Naikin BB plan drawn on the chart: upward target line plus the weekly pace fan. */
type GainPlanLine = {
  startKg: number;
  startDate: string;
  targetKg: number;
  targetDate: string;
  paceMinKg: number;
  paceMaxKg: number;
  /** latest trend point, the origin of the pace fan */
  base: { date: string; kg: number } | null;
};


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

/** "+0,5" / "−0,5" / "0": a weight change with an explicit sign. */
function signed(n: number): string {
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}${fmtKg(Math.abs(n))}`;
}

/** Chart padding leaves room for kg labels (left) and date ticks (bottom). */
const PAD = { top: 18, right: 14, bottom: 24, left: 38 };

/** Weight chart for the selected range: the 7-day trend line over the daily scale dots, a labelled dashed
    goal line, nice kg gridlines, day-based date ticks, a fade-in on range change, and a pan-scrub
    crosshair + tooltip. Calories live in their own chart (KcalChart) below, never on this axis. */
function WeightChart({
  entries,
  trendPoints,
  targetKg,
  domainStart,
  domainEnd,
  rangeKey,
  rangeLabel,
  bars,
  weekly,
  gainPlan,
}: {
  /** raw scale weigh-ins in the range, oldest first */
  entries: Array<{ date: string; weightKg: number }>;
  /** EMA trend over the same range, oldest first */
  trendPoints: Array<{ date: string; trendKg: number }>;
  targetKg: number | null;
  domainStart: string;
  domainEnd: string;
  /** replays the fade-in when the range changes */
  rangeKey: string;
  rangeLabel: string;
  /** the calorie bars of the same period, only read for the scrub tooltip */
  bars: KcalBar[];
  weekly: boolean;
  /** Naikin BB plan (upward target line + pace fan); null for every other mode */
  gainPlan: GainPlanLine | null;
}) {
  const { t } = useTranslation(["berat", "gain"]);
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

  // Y domain from raw + trend values; the target line joins only when
  // near the data — a goal 20 kg away would flatten the whole trend line.
  const values = [...entries.map((e) => e.weightKg), ...trendPoints.map((p) => p.trendKg)];
  const rawLo = Math.min(...values);
  const rawHi = Math.max(...values);
  const valSpan = Math.max(rawHi - rawLo, 1);
  const near = (kg: number) => kg >= rawLo - valSpan && kg <= rawHi + valSpan;
  // Naikin BB draws one diagonal plan line instead of flat target/start lines. The x domain
  // already reaches (at most a capped stretch toward) the target date, so its ends stay close.
  const planDays = gainPlan ? Math.max(daysBetween(gainPlan.startDate, gainPlan.targetDate), 1) : 1;
  const planKgAt = (date: string) =>
    gainPlan
      ? gainPlan.startKg +
        ((gainPlan.targetKg - gainPlan.startKg) *
          Math.min(Math.max(daysBetween(gainPlan.startDate, date), 0), planDays)) /
          planDays
      : 0;
  const planFrom = gainPlan && gainPlan.startDate > domainStart ? gainPlan.startDate : domainStart;
  const planTo = gainPlan && gainPlan.targetDate < domainEnd ? gainPlan.targetDate : domainEnd;
  const planLine =
    gainPlan && planFrom <= planTo
      ? [
          { date: planFrom, kg: planKgAt(planFrom) },
          { date: planTo, kg: planKgAt(planTo) },
        ]
      : null;
  // The fan: the weekly pace band from the latest trend point, capped at the target.
  const planFan: Array<[string, number]> | null =
    gainPlan && gainPlan.base && gainPlan.base.date < domainEnd
      ? ((): Array<[string, number]> => {
          const base = gainPlan.base!;
          const days = daysBetween(base.date, domainEnd);
          const at = (kgPerWeek: number) =>
            Math.min(base.kg + (kgPerWeek / 7) * days, Math.max(gainPlan.targetKg, base.kg));
          return [
            [base.date, base.kg],
            [domainEnd, at(gainPlan.paceMaxKg)],
            [domainEnd, at(gainPlan.paceMinKg)],
          ];
        })()
      : null;
  const planKgs = [
    ...(planLine ? planLine.map((p) => p.kg) : []),
    ...(planFan ? planFan.map(([, kg]) => kg) : []),
  ];
  const target = !gainPlan && targetKg !== null && near(targetKg) ? targetKg : null;
  // Step is chosen from the FULL domain (lines included) so the tick count
  // stays ~5 no matter how much the reference lines stretch the view.
  const dataLo = Math.min(
    rawLo,
    ...planKgs,
    ...(target !== null ? [target] : []),
  );
  const dataHi = Math.max(
    rawHi,
    ...planKgs,
    ...(target !== null ? [target] : []),
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
  const tickFmt = (kg: number) => (step < 1 ? fmtDecimal(kg, 1) : fmtInt(kg));

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
  // Gain plan: weight up is good, a drop is just neutral information.
  const deltaColor =
    scrubDelta === null || scrubDelta === 0
      ? theme.colors.mutedForeground
      : gainPlan
        ? scrubDelta > 0
          ? theme.colors.makanText
          : theme.colors.mutedForeground
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
          accessibilityLabel={t("chart.a11yTouch", { range: rangeLabel })}
        >
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
              {t("chart.target", { kg: fmtKg(target) })}
            </SvgText>
          ) : null}
          {gainPlan && planLine ? (
            <>
              {planFan ? (
                <Polygon
                  points={planFan.map(([date, kg]) => `${x(date)},${y(kg)}`).join(" ")}
                  fill={theme.colors.makan}
                  fillOpacity={0.15}
                />
              ) : null}
              <Line
                x1={x(planLine[0].date)}
                y1={y(planLine[0].kg)}
                x2={x(planLine[1].date)}
                y2={y(planLine[1].kg)}
                stroke={theme.colors.makan}
                strokeOpacity={0.6}
                strokeWidth={1.75}
                strokeDasharray="4 5"
              />
              {planLine[0].date === gainPlan.startDate ? (
                <SvgText
                  x={x(planLine[0].date)}
                  y={y(planLine[0].kg) + 15}
                  fontSize={10}
                  fontWeight="600"
                  fill={labelColor}
                >
                  {`${t("gain:chart.start")} ${fmtKg(gainPlan.startKg)}`}
                </SvgText>
              ) : null}
              {planLine[1].date === gainPlan.targetDate ? (
                <SvgText
                  x={x(planLine[1].date)}
                  y={y(planLine[1].kg) - 6}
                  textAnchor="end"
                  fontSize={10}
                  fontWeight="600"
                  fill={theme.colors.makanText}
                >
                  {`${t("gain:chart.target")} ${fmtKg(gainPlan.targetKg)}`}
                </SvgText>
              ) : null}
            </>
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
              {fmtDateShort(t)}
            </SvgText>
          ))}
        </Svg>

        {scrubEntry ? (
          <View pointerEvents="none" style={[styles.chartTip, { left: tipLeft, top: tipTop }]}>
            <Text style={styles.chartTipDate}>{fmtDateMedium(scrubEntry.date)}</Text>
            <View style={styles.chartTipRow}>
              <Text style={styles.chartTipLabel}>{t("tip.scale")}</Text>
              <Num style={styles.chartTipValue}>{fmtKg(scrubEntry.weightKg)} kg</Num>
            </View>
            {scrubTrend ? (
              <View style={styles.chartTipRow}>
                <Text style={styles.chartTipLabel}>{t("tip.trend")}</Text>
                <Num style={styles.chartTipValue}>{fmtKg(scrubTrend.trendKg)} kg</Num>
              </View>
            ) : null}
            {scrubBar ? (
              <View style={styles.chartTipRow}>
                <Text style={styles.chartTipLabel}>
                  {weekly ? t("tip.kcalPerDay") : t("tip.kcal")}
                </Text>
                <Num style={styles.chartTipValue}>
                  {scrubBar.avgKcal === null
                    ? t("tip.notLogged")
                    : weekly && scrubBar.untrackedDays > 0
                      ? t("tip.kcalValueGaps", {
                          kcal: fmtKcalLabel(scrubBar.avgKcal),
                          count: scrubBar.untrackedDays,
                        })
                      : fmtKcalLabel(scrubBar.avgKcal)}
                </Num>
              </View>
            ) : null}
            <View style={styles.chartTipRow}>
              <Text style={styles.chartTipLabel}>{t("tip.vsPrev")}</Text>
              <Text style={[styles.chartTipValue, { color: deltaColor }]}>
                {scrubDelta === null
                  ? t("tip.first")
                  : scrubDelta === 0
                    ? t("tip.same")
                    : `${scrubDelta < 0 ? "−" : "+"}${fmtKg(Math.abs(scrubDelta))} kg`}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** An unlogged day's hatched placeholder, as a share of the plot height. */
const GHOST_SHARE = 0.45;

/** 2140 -> "2,1k" for the compact axis. */
function kcalAxis(n: number): string {
  if (n < 1000) return fmtInt(n);
  return `${fmtNumber(n / 1000, 1)}k`;
}

/** Calories eaten over the weight chart's period and x axis, on its own labelled axis (kcal, left). Bars are one day
    each (a week on long periods); a darker bar is above the target (Naikin BB: reached it); the hatched area is days
    without a log. */
function KcalChart({
  bars,
  weekly,
  targetKcal,
  gain,
  domainStart,
  domainEnd,
}: {
  bars: KcalBar[];
  weekly: boolean;
  targetKcal: number | null;
  gain: boolean;
  domainStart: string;
  domainEnd: string;
}) {
  const { t } = useTranslation(["berat"]);
  const { theme } = useUnistyles();
  const { width: winW } = useWindowDimensions();
  const w = Math.min(winW - 80, 400);
  const h = 140;
  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;
  const spanDays = Math.max(daysBetween(domainStart, domainEnd), 1);
  const x = (date: string) =>
    PAD.left +
    (Math.min(Math.max(daysBetween(domainStart, date), 0), spanDays) / spanDays) * innerW;
  const pxPerDay = innerW / spanDays;
  const baseY = PAD.top + innerH;
  const maxK = Math.max(
    500,
    Math.ceil((Math.max(targetKcal ?? 0, ...bars.map((b) => b.avgKcal ?? 0)) * 1.1) / 500) * 500,
  );
  const ky = (kcal: number) => baseY - (kcal / maxK) * innerH;
  const dayStep = niceDayStep(spanDays);
  const xTickDates: string[] = [];
  for (let d = 0; d <= spanDays; d += dayStep) xTickDates.push(shiftDate(domainStart, d));
  if (spanDays - (xTickDates.length - 1) * dayStep >= dayStep * 0.5) xTickDates.push(domainEnd);
  const labelColor = theme.colors.mutedForeground;
  return (
    <Svg width={w} height={h} accessibilityLabel={t("kcal.a11y")}>
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
      {[0, maxK / 2, maxK].map((k) => (
        <Fragment key={k}>
          <Line
            x1={PAD.left}
            x2={w - PAD.right}
            y1={ky(k)}
            y2={ky(k)}
            stroke={theme.colors.hairline}
            strokeWidth={1}
          />
          <SvgText
            x={PAD.left - 8}
            y={ky(k) + 4}
            textAnchor="end"
            fontSize={10}
            fontWeight="600"
            fill={labelColor}
          >
            {kcalAxis(k)}
          </SvgText>
        </Fragment>
      ))}
      {bars.map((b) => {
        const left = weekly ? x(b.from) : x(b.from) - Math.max(pxPerDay * 0.7, 1.5) / 2;
        const bw = weekly
          ? Math.max((daysBetween(b.from, b.to) + 1) * pxPerDay - 2, 2)
          : Math.max(pxPerDay * 0.7, 1.5);
        const barH = b.avgKcal === null ? 0 : baseY - ky(b.avgKcal);
        const ghostH = innerH * GHOST_SHARE * (b.untrackedDays / b.days);
        const strong = gain
          ? targetKcal !== null && b.avgKcal !== null && gainDayHit(b.avgKcal, targetKcal)
          : targetKcal !== null && b.avgKcal !== null && b.avgKcal > targetKcal;
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
                fillOpacity={strong ? 0.8 : 0.35}
              />
            ) : null}
            {ghostH > 0 ? (
              <Rect x={left} y={baseY - barH - ghostH} width={bw} height={ghostH} fill="url(#kcal-hatch)" />
            ) : null}
          </Fragment>
        );
      })}
      {targetKcal !== null ? (
        <>
          <Line
            x1={PAD.left}
            x2={w - PAD.right}
            y1={ky(targetKcal)}
            y2={ky(targetKcal)}
            stroke={theme.colors.bakarText}
            strokeOpacity={0.8}
            strokeWidth={1.25}
            strokeDasharray="6 4"
          />
          <SvgText
            x={w - PAD.right}
            y={ky(targetKcal) - 5}
            textAnchor="end"
            fontSize={10}
            fontWeight="600"
            fill={theme.colors.bakarText}
          >
            {t("kcal.target", { kcal: fmtInt(targetKcal) })}
          </SvgText>
        </>
      ) : null}
      {xTickDates.map((d, i) => (
        <SvgText
          key={d}
          x={x(d)}
          y={h - 6}
          textAnchor={i === 0 ? "start" : i === xTickDates.length - 1 ? "end" : "middle"}
          fontSize={10}
          fontWeight="500"
          fill={labelColor}
        >
          {fmtDateShort(d)}
        </SvgText>
      ))}
    </Svg>
  );
}

type WeightSummary = {
  startKg: number | null;
  latestKg: number | null;
  deltaKg: number | null;
  targetKg: number | null;
  gain: { gainedKg: number } | null;
};

/** The progress story the weight stickers read: goal progress, a normalized trend, and (opt-in only) the kg values. */
function weightStory(
  summary: WeightSummary,
  entries: Array<{ date: string; weightKg: number }>,
  day: { eatenKcal: number; targets: { eatKcal: number } | null } | undefined,
): StorySpec {
  const start = summary.startKg;
  const now = summary.latestKg;
  const lost = !summary.gain && summary.deltaKg !== null && summary.deltaKg < 0 ? -summary.deltaKg : 0;
  return {
    kind: "progress",
    eatenKcal: day?.eatenKcal ?? 0,
    targetKcal: day?.targets?.eatKcal ?? 0,
    gain: summary.gain !== null,
    weightLostKg: lost,
    weightGainedKg: summary.gain?.gainedKg ?? 0,
    weekTrend: entries.slice(-14).map((e) => ({ date: e.date, weightKg: e.weightKg })),
    weightGoalProgress:
      start !== null && now !== null && summary.targetKg !== null
        ? weightGoalProgress(start, now, summary.targetKg)
        : null,
    weight: start !== null && now !== null ? { startKg: start, nowKg: now, goalKg: summary.targetKg } : null,
  };
}

export default function Berat() {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["berat", "common", "gain"]);
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
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const maternal = useMaternal().mode !== "none";
  const { gain: gainInfo } = useGain();
  const today = jakartaToday();
  // The share card reads the same period as the tabs: same start, same end, same trend.
  const periodFrom =
    range === "all"
      ? (historyQuery.data?.entries[0]?.date ?? today)
      : shiftDate(today, -(Number(range) - 1));
  const periodQuery = useQuery({
    ...orpc.stats.periodProgress.queryOptions({ input: { from: periodFrom, to: today } }),
    enabled: historyQuery.data !== undefined && historyQuery.data.summary.latestKg !== null,
  });
  const periodStory = useMemo<StorySpec | null>(
    () => (periodQuery.data ? { kind: "period", ...periodQuery.data, date: new Date() } : null),
    [periodQuery.data],
  );
  // Chart line: client-side 7-day EMA over the raw entries, so every range —
  // including "Semua" — gets a full trend (day.summary only ships 30 days).
  const allTrend = useMemo(() => emaTrendPoints(historyQuery.data?.entries ?? []), [historyQuery.data]);

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (historyQuery.isPending) {
    return (
      <Screen>
        <PageHeader title={t("page.titleShort")} />
        <Skeleton width="100%" height={140} radius={24} />
        <Skeleton width="100%" height={220} radius={24} />
        <Skeleton width="100%" height={180} radius={24} />
      </Screen>
    );
  }
  if (historyQuery.isError) {
    return (
      <Screen>
        <PageHeader title={t("page.titleShort")} />
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
  const gain = summary.gain;

  const rangeDays = range === "all" ? null : Number(range);
  const cutoff = rangeDays === null ? null : shiftDate(today, -(rangeDays - 1));
  const rangeEntries = cutoff === null ? entries : entries.filter((e) => e.date >= cutoff);
  const rangeTrend = cutoff === null ? allTrend : allTrend.filter((p) => p.date >= cutoff);
  const rangeLabel =
    range === "all" ? t("chart.sinceStart") : t("chart.rangeLast", { count: Number(range) });
  const domainStart = cutoff ?? rangeEntries[0]?.date ?? today;
  // The period's numbers (start, now, change, pace, projection) come from one function, over the same trend the chart
  // draws and the same bounds the share card is built from.
  const period = periodWeight(entries, domainStart, today, summary.targetKg);
  // Naikin BB: the plan line starts where the gain began (the latest earlier weigh-in at the
  // gain's starting weight, else the first weigh-in) and the x axis reaches toward the target date.
  const latestTrend = allTrend.at(-1);
  const gainStartDate = gain
    ? ([...entries]
        .reverse()
        .find((e, i) => i > 0 && Math.abs(e.weightKg - gain.startKg) <= 0.5)?.date ??
      entries[0]?.date ??
      today)
    : null;
  const gainPlan: GainPlanLine | null =
    gain && gainStartDate && summary.targetKg !== null
      ? {
          startKg: gain.startKg,
          startDate: gainStartDate,
          targetKg: summary.targetKg,
          targetDate: gain.targetDate,
          paceMinKg: gain.pace.minKg,
          paceMaxKg: gain.pace.maxKg,
          base: latestTrend ? { date: latestTrend.date, kg: latestTrend.trendKg } : null,
        }
      : null;
  const chartEnd = gainPlan
    ? shiftDate(
        today,
        Math.min(
          Math.max(daysBetween(today, gainPlan.targetDate), 0),
          Math.max(14, daysBetween(domainStart, today)),
        ),
      )
    : today;
  const targetKcal = maternal ? null : (dayQuery.data?.targets?.eatKcal ?? null);
  const kcalRange = kcalQuery.data ?? [];
  const { bars: kcalBarList, weekly: kcalWeekly } = kcalBars(kcalRange, domainStart, today);
  const kcalStats = kcalSummary(kcalRange, domainStart, today);
  // Losing only counts as good while the target sits below the start weight.
  const wantDown =
    summary.targetKg === null || summary.targetKg <= (summary.startKg ?? Number.POSITIVE_INFINITY);
  const toneFor = (delta: number | null): "makan" | "bakar" | null => {
    if (delta === null || Math.abs(delta) < 0.05) return null;
    // Gain plan: weight up is good, a drop is just neutral information.
    if (gain) return delta > 0 ? "makan" : null;
    return (wantDown ? delta < 0 : delta > 0) ? "makan" : "bakar";
  };
  const toneColor = (delta: number | null) => {
    const tone = toneFor(delta);
    return tone === "makan"
      ? { color: theme.colors.makanText }
      : tone === "bakar"
        ? { color: theme.colors.bakarText }
        : null;
  };

  const heightCm = profileQuery.data?.profile?.heightCm ?? null;
  const bmi =
    summary.latestKg !== null && heightCm ? summary.latestKg / (heightCm / 100) ** 2 : null;
  const bmiCategory =
    bmi === null ? null : bmi < 18.5 ? "under" : bmi < 25 ? "ideal" : bmi < 30 ? "over" : "obese";

  // The headline is the line the chart draws: its last point.
  const trendKg = latestTrend?.trendKg ?? summary.latestKg;
  const goalReached =
    trendKg !== null &&
    summary.targetKg !== null &&
    (gain ? trendKg >= summary.targetKg : trendKg <= summary.targetKg);
  const toGoalKg =
    trendKg !== null && summary.targetKg !== null ? Math.abs(trendKg - summary.targetKg) : null;
  const newestEntries = entries.slice().toReversed();
  const scaleDate = newestEntries[0]
    ? newestEntries[0].date === today
      ? t("common:date.today")
      : fmtDateShort(newestEntries[0].date)
    : "";

  /** One short line under the projection cell: why there is, or is not, a date. */
  const projectionNote = (pw: PeriodWeight | null, targetKg: number | null): string => {
    if (targetKg === null) return t("projection.setTarget");
    if (goalReached) return t("projection.reached");
    if (pw === null || pw.weeklyRateKg === null) return t("projection.needMore");
    if (pw.projectedDate !== null) return t("projection.toward", { kg: fmtKg(targetKg) });
    if (pw.direction === "steady") return t("projection.steady");
    const toward = pw.goalReached || (pw.endKg - targetKg) * pw.weeklyRateKg < 0;
    return toward ? t("projection.needMore") : t("projection.away");
  };

  return (
    <Screen>
      <PageHeader
        title={t("page.titleShort")}
        right={
          hasData ? (
            <View style={styles.headerActions}>
              {maternal || summary.latestKg === null ? null : (
                <ShareStoryButton
                  iconOnly
                  label={t("page.shareSticker")}
                  story={weightStory(summary, entries, dayQuery.data)}
                  kinds={["weight"]}
                />
              )}
              <Button size="sm" label={t("hero.weighShort")} onPress={() => setSheetOpen(true)} />
            </View>
          ) : undefined
        }
      />

        {/* Hamil: kenaikan berat per minggu dibanding rentang IOM */}
        {maternal ? <WeightGainCard onWeighIn={() => setSheetOpen(true)} /> : null}

        {hasData ? (
          <>
            {/* Where you are: the trend, then today's scale as the second line, then what the goal and BMI say */}
            <Card>
              <Text style={styles.trendLabel}>{t("hero.trendLabel")}</Text>
              <View style={styles.trendRow}>
                <Num style={styles.trendValue} adjustsFontSizeToFit numberOfLines={1}>
                  {fmtKg(trendKg ?? summary.latestKg ?? 0)}
                </Num>
                <Text style={styles.trendUnit}>kg</Text>
              </View>
              <Text style={styles.heroScale}>
                {t("hero.scale", { kg: fmtKg(summary.latestKg ?? 0), date: scaleDate })}
              </Text>
              <Text style={styles.note}>{t("hero.trendExplain")}</Text>
              {goalReached ? (
                <View style={styles.goalBanner}>
                  <Mascot pose="mantap" size="sm" />
                  <Text style={styles.goalBannerText}>{t("hero.goalReached")}</Text>
                </View>
              ) : null}
              {!maternal && (summary.targetKg !== null || (bmi !== null && bmiCategory !== null)) ? (
                <View style={styles.factRows}>
                  {summary.targetKg !== null ? (
                    <View style={styles.factRow}>
                      <Text style={styles.factLabel}>{t("hero.goalLabel")}</Text>
                      <Num style={styles.factValue}>
                        {goalReached || toGoalKg === null
                          ? t("hero.goalValueReached", { kg: fmtKg(summary.targetKg) })
                          : t("hero.goalValue", {
                              kg: fmtKg(summary.targetKg),
                              left: fmtKg(toGoalKg),
                            })}
                      </Num>
                    </View>
                  ) : null}
                  {bmi !== null && bmiCategory !== null ? (
                    <View style={styles.factRow}>
                      <Text style={styles.factLabel}>{t("bmi.label")}</Text>
                      <Num
                        style={[
                          styles.factValue,
                          bmiCategory === "ideal"
                            ? { color: theme.colors.makanText }
                            : { color: theme.colors.bakarText },
                        ]}
                      >
                        {t("bmi.value", {
                          value: fmtKg(bmi),
                          category: t(`bmi.category.${bmiCategory}`),
                        })}
                      </Num>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>

            {gainInfo && gainInfo.flags.length > 0 ? <GainNotes gain={gainInfo} /> : null}

            {/* The chosen period: the tabs drive every number and the chart below them */}
            <Card>
              <Text style={styles.sectionLabel}>{t("period.title")}</Text>
              <View style={styles.rangeBox}>
                <Segmented
                  options={[
                    { value: "7", label: t("chart.range.d7") },
                    { value: "30", label: t("chart.range.d30") },
                    { value: "90", label: t("chart.range.d90") },
                    { value: "all", label: t("chart.range.all") },
                  ]}
                  value={range}
                  onChange={(value) => setRange(value)}
                />
              </View>

              {rangeEntries.length === 0 ? (
                <View style={styles.chartEmptyBox}>
                  <Text style={styles.chartEmptyTitle}>
                    {t("chart.emptyTitle", { range: rangeLabel })}
                  </Text>
                  <Text style={styles.chartEmpty}>{t("chart.emptyBody")}</Text>
                  <Button
                    variant="secondary"
                    label={t("chart.emptyAction")}
                    onPress={() => setSheetOpen(true)}
                  />
                </View>
              ) : (
                <>
                  {maternal ? null : period === null ? (
                    <Text style={styles.note}>{t("period.needMore")}</Text>
                  ) : (
                    <View style={styles.periodGrid}>
                      <View style={styles.periodCell}>
                        <Text style={styles.chartStatLabel}>{t("period.start")}</Text>
                        <Num style={styles.chartStatValue}>{`${fmtKg(period.startKg)} kg`}</Num>
                        <Text style={styles.chartStatSub}>
                          {t("period.trendOn", { date: fmtDateShort(period.startDate) })}
                        </Text>
                      </View>
                      <View style={styles.periodCell}>
                        <Text style={styles.chartStatLabel}>{t("period.now")}</Text>
                        <Num style={styles.chartStatValue}>{`${fmtKg(period.endKg)} kg`}</Num>
                        <Text style={styles.chartStatSub}>
                          {t("period.trendOn", {
                            date:
                              period.endDate === today
                                ? t("common:date.today")
                                : fmtDateShort(period.endDate),
                          })}
                        </Text>
                      </View>
                      <View style={styles.periodCell}>
                        <Text style={styles.chartStatLabel}>{t("stats.change")}</Text>
                        <Num style={[styles.chartStatValue, toneColor(period.changeKg)]}>
                          {`${signed(period.changeKg)} kg`}
                        </Num>
                        <Text style={styles.chartStatSub}>
                          {t("period.changePct", { pct: signed(period.changePct) })}
                        </Text>
                      </View>
                      <View style={styles.periodCell}>
                        <Text style={styles.chartStatLabel}>{t("stats.pace")}</Text>
                        <Num style={[styles.chartStatValue, toneColor(period.weeklyRateKg)]}>
                          {period.weeklyRateKg === null ? "-" : `${signed(period.weeklyRateKg)} kg`}
                        </Num>
                        <Text style={styles.chartStatSub}>
                          {period.weeklyRateKg === null ? t("period.paceNeeds") : t("period.perWeek")}
                        </Text>
                      </View>
                      {summary.targetKg !== null && !gain ? (
                        <View style={styles.periodCellWide}>
                          <Text style={styles.chartStatLabel}>{t("stats.projection")}</Text>
                          <Num style={styles.chartStatValue}>
                            {period.projectedDate !== null
                              ? t("stats.projectionValue", {
                                  month: fmtDate(period.projectedDate, "month"),
                                })
                              : "-"}
                          </Num>
                          <Text style={styles.chartStatSub}>
                            {projectionNote(period, summary.targetKg)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                  {period !== null && period.startsLateDays > 0 ? (
                    <Text style={styles.chartHint}>
                      {t("period.startsLate", { date: fmtDateShort(period.startDate) })}
                    </Text>
                  ) : null}

                  {rangeEntries.length === 1 ? (
                    <Text style={styles.chartHint}>{t("chart.tomorrow")}</Text>
                  ) : null}
                  <WeightChart
                    entries={rangeEntries}
                    trendPoints={rangeTrend}
                    targetKg={summary.targetKg}
                    domainStart={domainStart}
                    domainEnd={chartEnd}
                    rangeKey={range}
                    rangeLabel={rangeLabel}
                    bars={kcalBarList}
                    weekly={kcalWeekly}
                    gainPlan={gainPlan}
                  />
                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendLine, { backgroundColor: theme.colors.makan }]} />
                      <Text style={styles.legendText}>{t("legend.trend")}</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: theme.colors.makan, opacity: 0.35 },
                        ]}
                      />
                      <Text style={styles.legendText}>{t("legend.weight")}</Text>
                    </View>
                    {!gainPlan && summary.targetKg !== null ? (
                      <View style={styles.legendItem}>
                        <View style={styles.legendDash} />
                        <Text style={styles.legendText}>{t("legend.goal")}</Text>
                      </View>
                    ) : null}
                    {gainPlan ? (
                      <>
                        <View style={styles.legendItem}>
                          <View
                            style={[
                              styles.legendLine,
                              { backgroundColor: theme.colors.makan, opacity: 0.6 },
                            ]}
                          />
                          <Text style={styles.legendText}>
                            {`${t("gain:chart.target")} ${fmtKg(gainPlan.targetKg)}`}
                          </Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View
                            style={[
                              styles.legendSquare,
                              { backgroundColor: theme.colors.makan, opacity: 0.2 },
                            ]}
                          />
                          <Text style={styles.legendText}>
                            {`${t("gain:chart.band")}: ${t("gain:chart.bandRange", {
                              min: fmtKg(gainPlan.paceMinKg),
                              max: fmtKg(gainPlan.paceMaxKg),
                            })}`}
                          </Text>
                        </View>
                      </>
                    ) : null}
                  </View>
                </>
              )}
              <Disclosure plain title={t("detail.title")}>
                <Text style={styles.chartCaption}>
                  {t("detail.trustTrend")} {gain ? t("gain:nativeToday.chart.detailLegend") : t("detail.legend")}
                  {!maternal && gain
                    ? ` ${t("gain:chart.gained", { kg: fmtKg(gain.gainedKg) })}`
                    : ""}
                </Text>
              </Disclosure>
              {maternal || !periodStory ? null : (
                <ShareStoryButton
                  variant="secondary"
                  label={t("period.share")}
                  story={periodStory}
                  kinds={["period"]}
                />
              )}
            </Card>

            {/* What was eaten over the same period, on its own axis */}
            {kcalQuery.data && kcalBarList.length > 0 ? (
              <Card>
                <Text style={styles.sectionLabel}>
                  {kcalWeekly ? t("kcal.titleWeekly") : t("kcal.title")}
                </Text>
                <KcalChart
                  bars={kcalBarList}
                  weekly={kcalWeekly}
                  targetKcal={targetKcal}
                  gain={gain !== null}
                  domainStart={domainStart}
                  domainEnd={chartEnd}
                />
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={styles.legendBars}>
                      <View style={[styles.legendSquare, { opacity: 0.35 }]} />
                      <View style={[styles.legendSquare, { opacity: 0.8 }]} />
                    </View>
                    <Text style={styles.legendText}>
                      {gain ? t("legend.kcalGain") : t("legend.kcalOver")}
                    </Text>
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
                    <Text style={styles.legendText}>{t("legend.unlogged")}</Text>
                  </View>
                  {targetKcal !== null ? (
                    <View style={styles.legendItem}>
                      <View style={styles.legendDashKcal} />
                      <Text style={styles.legendText}>{t("legend.kcalTarget")}</Text>
                    </View>
                  ) : null}
                </View>
                <Num style={styles.kcalSummary}>
                  {kcalStats.trackedDays === 0
                    ? t("kcal.none")
                    : t("kcal.summary", {
                        tracked: kcalStats.trackedDays,
                        count: kcalStats.days,
                        avg: fmtKcalLabel(kcalStats.avgKcal ?? 0),
                      })}
                </Num>
                {kcalWeekly ? <Text style={styles.chartCaption}>{t("detail.weekly")}</Text> : null}
              </Card>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon="scale-outline"
            title={t("empty.title")}
            description={t("empty.bodyNative")}
            action={<Button label={t("page.weighNow")} onPress={() => setSheetOpen(true)} />}
          />
        )}

        {/* History */}
        {entries.length > 0 ? (
          <Card style={styles.historyCard}>
            <Text style={styles.historyTitle}>{t("history.title")}</Text>
            {maternal ? null : (
              <Button
                variant="secondary"
                label={t("page.share")}
                onPress={() => setShareOpen(true)}
              />
            )}
            <ListGroup style={styles.historyGroup}>
              {(showAllHistory ? newestEntries : newestEntries.slice(0, 10)).map((entry, index) => {
                const newer = index > 0 ? newestEntries[index - 1] : null;
                const delta = newer ? entry.weightKg - newer.weightKg : null;
                return (
                  <ListRow
                    key={entry.id}
                    title={entry.date === today ? t("common:date.today") : fmtDateMedium(entry.date)}
                    value={`${fmtKg(entry.weightKg)} kg`}
                    subtitle={
                      [
                        delta !== null && Math.abs(delta) >= 0.05
                          ? t("history.delta", { delta: signed(delta) })
                          : null,
                        entry.bodyFatPct != null
                          ? t("history.bodyFat", { pct: fmtKg(entry.bodyFatPct) })
                          : null,
                        entry.musclePct != null
                          ? t("history.bodyMuscle", { pct: fmtKg(entry.musclePct) })
                          : null,
                        entry.source === "scale" ? t("history.scale") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  />
                );
              })}
            </ListGroup>
            {entries.length > 10 ? (
              <Button
                variant="secondary"
                label={
                  showAllHistory
                    ? t("history.showLess")
                    : t("history.showAll", { count: entries.length })
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
            title={t("share.titleNative")}
            preview={
              trendKg !== null && summary.latestKg !== null
                ? t("share.previewTrend", {
                    kg: fmtKg(newestEntries[0].weightKg),
                    trend: fmtKg(trendKg),
                  })
                : t("share.previewNative", { kg: fmtKg(newestEntries[0].weightKg) })
            }
            kind="berat"
            refId={newestEntries[0].id}
          />
        ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  sectionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  heroScale: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  factRows: {
    gap: theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.spacing.sm,
  },
  factRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  factLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  factValue: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  // Two columns, each wide enough for "-0,5 kg" and its sub line at 360dp; the projection spans both.
  periodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  periodCell: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  periodCellWide: {
    flexBasis: "100%",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
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
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
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
  // The segmented control spans the card so four options (7H..Semua) fit.
  rangeBox: {
    width: "100%",
    marginTop: theme.spacing.sm,
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
