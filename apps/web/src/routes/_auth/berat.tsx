import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Medal, Newspaper, Scale } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { daysBetween, emaTrendPoints, jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { gainDayHit } from "@joyorogo/api/lib/gain";
import { kcalBars, kcalSummary } from "@joyorogo/api/lib/kcal-bars";
import type { KcalBar } from "@joyorogo/api/lib/kcal-bars";
import { periodWeight } from "@joyorogo/api/lib/period-progress";
import type { PeriodWeight } from "@joyorogo/api/lib/period-progress";

import { Mascot } from "@/components/mascot";
import { ScreenError } from "@/components/screen-state";
import { WeightGainCard } from "@/components/maternal/weight-gain-chart";
import { GainNotes } from "@/components/gain/gain-notes";
import { WaistSection } from "@/components/waist-section";
import {
  Card,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  SectionTitle,
  Segmented,
} from "@/components/kit/surface";
import { fmtDate, fmtDecimal, fmtNumber } from "@joyorogo/i18n";
import {
  fmtDateMedium,
  fmtDateShort,
  fmtInt,
  fmtKcalLabel,
  fmtKg,
  jakartaDatePlusDays,
  parseNum,
} from "@/lib/format";
import { useWeightCheckIn } from "@/lib/optimistic";
import type { WeightHistory } from "@/lib/api-types";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { ShareStoryButton } from "@/components/story/share-story-button";
import type { StorySpec } from "@/components/story/story-spec";
import { weightGoalProgress } from "@joyorogo/sticker";
import { client, orpc } from "@/utils/orpc";

// 365 = the API cap, so the "Semua" range really shows everything.
const historyOptions = orpc.weight.history.queryOptions({ input: { limit: 365 } });
// day.summary supplies today's targets; the trend, pace and projection on this screen all come from
// lib/period-progress over the history, the same function the share card uses.
const summaryOptions = orpc.day.summary.queryOptions({ input: {} });
const profileOptions = orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/berat")({
  loader: ({ context }) => context.queryClient.ensureQueryData(historyOptions),
  pendingComponent: BeratSkeleton,
  component: BeratPage,
});


const PAD = { top: 18, right: 14, bottom: 26, left: 38 };

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

/** An unlogged day's hatched placeholder, as a share of the plot height. */
const GHOST_SHARE = 0.45;

/** 2140 -> "2,1k" for the compact axis. */
function kcalAxis(n: number): string {
  if (n < 1000) return fmtInt(n);
  return `${fmtNumber(n / 1000, 1)}k`;
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

/** Measures the chart container so the SVG renders 1:1 and 11px text stays 11px. */
function useChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setSize({ w, h: w < 480 ? 180 : 240 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function WeightChart({
  width,
  height,
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
  width: number;
  height: number;
  /** raw scale weigh-ins in the range, oldest first */
  entries: Array<{ date: string; weightKg: number }>;
  /** EMA trend over the same range, oldest first */
  trendPoints: Array<{ date: string; trendKg: number }>;
  targetKg: number | null;
  domainStart: string;
  domainEnd: string;
  /** replays the draw-in animation when the range changes */
  rangeKey: string;
  rangeLabel: string;
  /** the calorie bars of the same period, only read for the scrub tooltip */
  bars: KcalBar[];
  weekly: boolean;
  /** Naikin BB plan (upward target line + pace fan); null for every other mode */
  gainPlan: GainPlanLine | null;
}) {
  const { t } = useTranslation(["berat", "gain"]);
  const [scrubDate, setScrubDate] = useState<string | null>(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
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
  const planFan =
    gainPlan && gainPlan.base && gainPlan.base.date < domainEnd
      ? (() => {
          const days = daysBetween(gainPlan.base.date, domainEnd);
          const at = (kgPerWeek: number) =>
            Math.min(gainPlan.base!.kg + (kgPerWeek / 7) * days, Math.max(gainPlan.targetKg, gainPlan.base!.kg));
          return [
            [gainPlan.base.date, gainPlan.base.kg],
            [domainEnd, at(gainPlan.paceMaxKg)],
            [domainEnd, at(gainPlan.paceMinKg)],
          ] as Array<[string, number]>;
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

  const trendPath =
    trendPoints.length > 1
      ? trendPoints
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(p.trendKg).toFixed(1)}`)
          .join(" ")
      : null;

  const scrubBar = (date: string) => bars.find((b) => b.from <= date && date <= b.to);

  const scrubIdx = scrubDate ? entries.findIndex((e) => e.date === scrubDate) : -1;
  const scrubEntry = scrubIdx >= 0 ? entries[scrubIdx] : undefined;
  const scrubTrend = scrubEntry && trendPoints.find((p) => p.date === scrubEntry.date);
  const scrubPrev = scrubEntry && scrubIdx > 0 ? entries[scrubIdx - 1] : undefined;
  const scrubDelta = scrubEntry && scrubPrev ? scrubEntry.weightKg - scrubPrev.weightKg : null;

  const moveScrub = (event: React.PointerEvent<SVGSVGElement>) => {
    // Touch only scrubs while pressed, so vertical page scroll still works.
    if (event.pointerType !== "mouse" && event.buttons === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
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
  const clearScrub = () => setScrubDate(null);

  const TIP_W = 196;
  const TIP_H = 124;
  let tipLeft = 0;
  let tipTop = 0;
  if (scrubEntry) {
    const px = x(scrubEntry.date);
    tipLeft = Math.min(
      Math.max(px > width * 0.58 ? px - TIP_W - 10 : px + 10, 4),
      Math.max(width - TIP_W - 4, 4),
    );
    tipTop = Math.min(Math.max(y(scrubEntry.weightKg) - 24, 4), Math.max(height - TIP_H - 4, 4));
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="h-auto max-w-full touch-pan-y select-none"
        role="img"
        aria-label={t("chart.a11yPointer", { range: rangeLabel })}
        onPointerDown={moveScrub}
        onPointerMove={moveScrub}
        onPointerLeave={clearScrub}
        onPointerCancel={clearScrub}
      >
        <g className="stroke-border/70">
          {yTicks.map((t) => (
            <line
              key={t}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              strokeWidth={1}
            />
          ))}
        </g>
        <g fontSize={11} fontWeight={600} className="fill-muted-foreground">
          {yTicks.map((t) => (
            <text key={t} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {tickFmt(t)}
            </text>
          ))}
        </g>

        {target !== null && (
          <g>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(target)}
              y2={y(target)}
              strokeDasharray="4 5"
              strokeWidth={1.5}
              className="stroke-makan/45"
            />
            <text
              x={width - PAD.right}
              y={y(target) - 6}
              textAnchor="end"
              fontSize={11}
              fontWeight={600}
              className="fill-makan-ink"
            >
              {t("chart.target", { kg: fmtKg(target) })}
            </text>
          </g>
        )}
        {/* Naikin BB: the plan's upward target line and the pace fan from the latest weigh-in. */}
        {gainPlan && planLine && (
          <g>
            {planFan && (
              <polygon
                points={planFan
                  .map(([date, kg]) => `${x(date).toFixed(1)},${y(kg).toFixed(1)}`)
                  .join(" ")}
                className="fill-makan/15"
              />
            )}
            <line
              x1={x(planLine[0].date)}
              y1={y(planLine[0].kg)}
              x2={x(planLine[1].date)}
              y2={y(planLine[1].kg)}
              strokeDasharray="4 5"
              strokeWidth={1.75}
              className="stroke-makan/60"
            />
            {planLine[0].date === gainPlan.startDate && (
              <text
                x={x(planLine[0].date)}
                y={y(planLine[0].kg) + 15}
                fontSize={11}
                fontWeight={600}
                className="fill-muted-foreground"
              >
                {t("gain:chart.start")} {fmtKg(gainPlan.startKg)}
              </text>
            )}
            {planLine[1].date === gainPlan.targetDate && (
              <text
                x={x(planLine[1].date)}
                y={y(planLine[1].kg) - 6}
                textAnchor="end"
                fontSize={11}
                fontWeight={600}
                className="fill-makan-ink"
              >
                {t("gain:chart.target", { kg: fmtKg(gainPlan.targetKg) })}
              </text>
            )}
          </g>
        )}

        {/* The smoothed trend is the number to believe; scale dots stay faint
            underneath so daily water noise reads as noise. The latest one gets
            a full-strength dot. */}
        <g key={`dots-${rangeKey}`} className="chart-fade">
          {entries.map((e, i) => (
            <circle
              key={e.date}
              cx={x(e.date)}
              cy={y(e.weightKg)}
              r={i === entries.length - 1 ? 4 : 2.5}
              className={i === entries.length - 1 ? "fill-primary" : "fill-primary/35"}
            />
          ))}
        </g>
        {trendPath && (
          <path
            key={`trend-${rangeKey}`}
            d={trendPath}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            className="chart-draw stroke-primary"
          />
        )}

        {scrubEntry && (
          <g>
            <line
              x1={x(scrubEntry.date)}
              x2={x(scrubEntry.date)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              strokeWidth={1}
              className="stroke-muted-foreground/40"
            />
            <circle
              cx={x(scrubEntry.date)}
              cy={y(scrubEntry.weightKg)}
              r={6}
              className="fill-primary/20"
            />
            <circle
              cx={x(scrubEntry.date)}
              cy={y(scrubEntry.weightKg)}
              r={3.5}
              strokeWidth={1.5}
              className="fill-primary stroke-background"
            />
            {scrubTrend && (
              <circle
                cx={x(scrubTrend.date)}
                cy={y(scrubTrend.trendKg)}
                r={3.5}
                strokeWidth={2}
                className="fill-background stroke-primary"
              />
            )}
          </g>
        )}

        <g fontSize={11} fontWeight={500} className="fill-muted-foreground">
          {xTickDates.map((t, i) => (
            <text
              key={t}
              x={x(t)}
              y={height - 8}
              textAnchor={i === 0 ? "start" : i === xTickDates.length - 1 ? "end" : "middle"}
            >
              {fmtDateShort(t)}
            </text>
          ))}
        </g>
      </svg>

      {scrubEntry && (
        <div
          className="pointer-events-none absolute z-10 rounded-2xl border border-border/60 bg-card/95 p-3 shadow-lg backdrop-blur-sm"
          style={{ left: tipLeft, top: tipTop, width: TIP_W }}
        >
          <p className="text-xs font-bold">{fmtDateMedium(scrubEntry.date)}</p>
          <dl className="mt-1.5 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("tip.scale")}</dt>
              <dd className="font-bold tabular-nums">{fmtKg(scrubEntry.weightKg)} kg</dd>
            </div>
            {scrubTrend && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("tip.trend")}</dt>
                <dd className="font-bold tabular-nums">{fmtKg(scrubTrend.trendKg)} kg</dd>
              </div>
            )}
            {(() => {
              const bar = scrubBar(scrubEntry.date);
              if (!bar) return null;
              return (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {weekly ? t("tip.kcalPerDay") : t("tip.kcal")}
                  </dt>
                  <dd className="font-bold tabular-nums">
                    {bar.avgKcal === null
                      ? t("tip.notLogged")
                      : weekly && bar.untrackedDays > 0
                        ? t("tip.kcalValueGaps", {
                            kcal: fmtKcalLabel(bar.avgKcal),
                            count: bar.untrackedDays,
                          })
                        : fmtKcalLabel(bar.avgKcal)}
                  </dd>
                </div>
              );
            })()}
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("tip.vsPrev")}</dt>
              <dd
                className={cn(
                  "font-bold tabular-nums",
                  scrubDelta === null || scrubDelta === 0
                    ? "text-muted-foreground"
                    : (gainPlan ? scrubDelta > 0 : scrubDelta < 0)
                      ? "text-makan-ink"
                      : gainPlan
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-bakar-ink",
                )}
              >
                {scrubDelta === null
                  ? t("tip.first")
                  : scrubDelta === 0
                    ? t("tip.same")
                    : `${scrubDelta < 0 ? "−" : "+"}${fmtKg(Math.abs(scrubDelta))} kg`}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </>
  );
}

/** One-line key of the weight chart: trend line, scale dots, goal line (or the Naikin BB plan). */
function ChartLegend({
  showGoal,
  gainPlan,
}: {
  showGoal: boolean;
  gainPlan: GainPlanLine | null;
}) {
  const { t } = useTranslation(["berat", "gain"]);
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
      <li className="flex items-center gap-1">
        <span className="h-0.5 w-3 rounded-full bg-primary" />
        {t("legend.trend")}
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-primary/35" />
        {t("legend.weight")}
      </li>
      {showGoal && (
        <li className="flex items-center gap-1">
          <span className="w-3 border-t-2 border-dashed border-makan/60" />
          {t("legend.goal")}
        </li>
      )}
      {gainPlan && (
        <>
          <li className="flex items-center gap-1">
            <span className="w-3 border-t-2 border-dashed border-makan/60" />
            {t("gain:chart.target", { kg: fmtKg(gainPlan.targetKg) })}
          </li>
          <li className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-makan/15" />
            {t("gain:chart.band")}
            <span className="font-normal">
              {t("gain:chart.bandRange", {
                min: fmtKg(gainPlan.paceMinKg),
                max: fmtKg(gainPlan.paceMaxKg),
              })}
            </span>
          </li>
        </>
      )}
    </ul>
  );
}

/** Key of the calorie chart: bar shades, unlogged days, the target line. */
function KcalLegend({ showTarget, gain }: { showTarget: boolean; gain: boolean }) {
  const { t } = useTranslation(["berat"]);
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
      <li className="flex items-center gap-1">
        <span className="size-2 rounded-sm bg-bakar/35" />
        <span className="-ml-0.5 size-2 rounded-sm bg-bakar/80" />
        {gain ? t("legend.kcalGain") : t("legend.kcalOver")}
      </li>
      <li className="flex items-center gap-1">
        <svg width={10} height={10} aria-hidden>
          <defs>
            <pattern
              id="kcal-hatch-legend"
              width={4}
              height={4}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={4}
                strokeWidth={1.5}
                className="stroke-muted-foreground/60"
              />
            </pattern>
          </defs>
          <rect width={10} height={10} rx={2} fill="url(#kcal-hatch-legend)" />
        </svg>
        {t("legend.unlogged")}
      </li>
      {showTarget && (
        <li className="flex items-center gap-1">
          <span className="w-3 border-t-2 border-dashed border-bakar-ink/70" />
          {t("legend.kcalTarget")}
        </li>
      )}
    </ul>
  );
}

/** Calories eaten over the weight chart's period and x axis, on its own labelled axis (kcal, left). */
function KcalChart({
  width,
  bars,
  weekly,
  targetKcal,
  gain,
  domainStart,
  domainEnd,
  rangeKey,
}: {
  width: number;
  bars: KcalBar[];
  weekly: boolean;
  targetKcal: number | null;
  gain: boolean;
  domainStart: string;
  domainEnd: string;
  rangeKey: string;
}) {
  const { t } = useTranslation(["berat"]);
  const height = width < 480 ? 150 : 180;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
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
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="h-auto max-w-full select-none"
      role="img"
      aria-label={t("kcal.a11y")}
    >
      <defs>
        <pattern
          id="kcal-hatch"
          width={4}
          height={4}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={4} strokeWidth={1.5} className="stroke-muted-foreground/50" />
        </pattern>
      </defs>
      <g className="stroke-border/70">
        {[0, maxK / 2, maxK].map((k) => (
          <line key={k} x1={PAD.left} x2={width - PAD.right} y1={ky(k)} y2={ky(k)} strokeWidth={1} />
        ))}
      </g>
      <g fontSize={11} fontWeight={600} className="fill-muted-foreground">
        {[0, maxK / 2, maxK].map((k) => (
          <text key={k} x={PAD.left - 8} y={ky(k) + 4} textAnchor="end">
            {kcalAxis(k)}
          </text>
        ))}
      </g>
      <g key={`bars-${rangeKey}`} className="chart-fade">
        {bars.map((b) => {
          const w = weekly
            ? Math.max((daysBetween(b.from, b.to) + 1) * pxPerDay - 2, 2)
            : Math.max(pxPerDay * 0.7, 1.5);
          const left = weekly ? x(b.from) : x(b.from) - w / 2;
          const barH = b.avgKcal === null ? 0 : baseY - ky(b.avgKcal);
          const ghostH = innerH * GHOST_SHARE * (b.untrackedDays / b.days);
          const strong = gain
            ? targetKcal !== null && b.avgKcal !== null && gainDayHit(b.avgKcal, targetKcal)
            : targetKcal !== null && b.avgKcal !== null && b.avgKcal > targetKcal;
          return (
            <g key={b.from}>
              {b.avgKcal !== null && (
                <rect
                  x={left}
                  y={baseY - barH}
                  width={w}
                  height={barH}
                  rx={Math.min(w / 4, 2)}
                  className={strong ? "fill-bakar/80" : "fill-bakar/35"}
                />
              )}
              {ghostH > 0 && (
                <rect
                  x={left}
                  y={baseY - barH - ghostH}
                  width={w}
                  height={ghostH}
                  fill="url(#kcal-hatch)"
                />
              )}
            </g>
          );
        })}
      </g>
      {targetKcal !== null && (
        <g>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={ky(targetKcal)}
            y2={ky(targetKcal)}
            strokeDasharray="6 4"
            strokeWidth={1.25}
            className="stroke-bakar-ink/70"
          />
          <text
            x={width - PAD.right}
            y={ky(targetKcal) - 5}
            textAnchor="end"
            fontSize={11}
            fontWeight={600}
            className="fill-bakar-ink"
          >
            {t("kcal.target", { kcal: fmtInt(targetKcal) })}
          </text>
        </g>
      )}
      <g fontSize={11} fontWeight={500} className="fill-muted-foreground">
        {xTickDates.map((d, i) => (
          <text
            key={d}
            x={x(d)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === xTickDates.length - 1 ? "end" : "middle"}
          >
            {fmtDateShort(d)}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** Small stat tile of the period summary (start, now, change, pace, projection). */
function StatCell({
  label,
  value,
  unit,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="min-w-0 rounded-2xl bg-muted/50 p-2.5">
      <p className="truncate text-xs font-semibold text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-base leading-tight font-extrabold tabular-nums",
          tone === "good" && "text-makan-ink",
          tone === "bad" && "text-bakar-ink",
        )}
      >
        {value}
        {unit && <span className="ml-1 text-xs font-semibold text-muted-foreground">{unit}</span>}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

type WeightSummary = WeightHistory["summary"];

/** The progress story the weight stickers read: goal progress, a normalized trend, and (opt-in only) the kg values. */
function weightStory(
  summary: WeightSummary,
  entries: WeightHistory["entries"],
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
      start !== null && now !== null && summary.targetKg !== null ? weightGoalProgress(start, now, summary.targetKg) : null,
    weight: start !== null && now !== null ? { startKg: start, nowKg: now, goalKg: summary.targetKg } : null,
  };
}

function BeratPage() {
  const history = useQuery(historyOptions);
  if (history.isPending) return <BeratSkeleton />;
  if (history.error) {
    return <ScreenError message={history.error.message} onRetry={() => history.refetch()} />;
  }
  return <BeratScreen history={history.data} />;
}

function BeratScreen({ history }: { history: WeightHistory }) {
  const { t } = useTranslation(["berat", "common", "gain"]);
  const summary = useQuery(summaryOptions);
  const profile = useQuery(profileOptions);
  const maternal = profile.data?.targets?.maternal ?? null;
  const gainInfo = profile.data?.targets?.gain ?? null;
  const goal = profile.data?.profile?.goal ?? "lose";
  const { entries, summary: weightSummary } = history;
  const gain = weightSummary.gain;
  const today = jakartaToday();

  const [range, setRange] = useState<"7" | "30" | "90" | "all">("30");
  const [showAll, setShowAll] = useState(false);
  const [weighOpen, setWeighOpen] = useState(false);
  const [weighValue, setWeighValue] = useState("");
  // Bagikan ke feed: check-in berat terakhir sebagai post 'berat'.
  const [shareOpen, setShareOpen] = useState(false);
  const { ref: chartRef, size: chartSize } = useChartSize();
  // One fetch of the last 400 days (the API cap); ranges filter locally.
  const kcalSeries = useQuery(
    orpc.day.kcalSeries.queryOptions({
      input: { from: jakartaDatePlusDays(-399), to: today },
    }),
  );

  // The share card reads the same period as the tabs: same start, same end, same trend.
  const periodFrom =
    range === "all" ? (entries[0]?.date ?? today) : jakartaDatePlusDays(-(Number(range) - 1));
  const periodQuery = useQuery({
    ...orpc.stats.periodProgress.queryOptions({ input: { from: periodFrom, to: today } }),
    enabled: weightSummary.latestKg !== null && !maternal,
  });
  const periodStory = useMemo<StorySpec | null>(
    () => (periodQuery.data ? { kind: "period", ...periodQuery.data, date: new Date() } : null),
    [periodQuery.data],
  );

  const checkIn = useWeightCheckIn((row) => t("toast.logged", { kg: fmtKg(row.weightKg) }));

  const openWeigh = () => {
    setWeighValue(weightSummary.latestKg !== null ? String(weightSummary.latestKg) : "");
    setWeighOpen(true);
  };
  const submitWeigh = () => {
    const kg = parseNum(weighValue);
    if (kg === null || kg < 25 || kg > 400) {
      toast.error(t("error.weightRange", { min: 25, max: 400 }));
      return;
    }
    checkIn.mutate({ weightKg: kg });
    setWeighOpen(false);
  };

  const heightCm = profile.data?.profile?.heightCm ?? null;
  const bmi =
    !maternal && weightSummary.latestKg !== null && heightCm
      ? weightSummary.latestKg / (heightCm / 100) ** 2
      : null;
  const bmiCategory =
    bmi === null ? null : bmi < 18.5 ? "under" : bmi < 25 ? "ideal" : bmi < 30 ? "over" : "obese";

  // Chart line: client-side 7-day EMA over the raw entries, so every range —
  // including "Semua" — gets a full trend. The headline is its last point.
  const allTrend = useMemo(() => emaTrendPoints(entries), [entries]);
  const latestTrend = allTrend.at(-1);
  const trendKg = latestTrend?.trendKg ?? weightSummary.latestKg;
  const goalReached =
    trendKg !== null &&
    weightSummary.targetKg !== null &&
    (goal === "gain" ? trendKg >= weightSummary.targetKg : trendKg <= weightSummary.targetKg);
  const toGoalKg =
    trendKg !== null && weightSummary.targetKg !== null
      ? Math.abs(trendKg - weightSummary.targetKg)
      : null;
  const rangeDays = range === "all" ? null : Number(range);
  const cutoff = rangeDays === null ? null : jakartaDatePlusDays(-(rangeDays - 1));
  const rangeEntries = cutoff === null ? entries : entries.filter((e) => e.date >= cutoff);
  const rangeTrend = cutoff === null ? allTrend : allTrend.filter((p) => p.date >= cutoff);
  const rangeLabel =
    range === "all" ? t("chart.sinceStart") : t("chart.rangeLast", { count: Number(range) });
  const domainStart = cutoff ?? rangeEntries[0]?.date ?? today;
  // The period's numbers (start, now, change, pace, projection) come from one function, over the same trend the chart
  // draws and the same bounds the share card is built from.
  const period = periodWeight(entries, domainStart, today, weightSummary.targetKg);
  // Naikin BB: the plan line starts where the gain began (the latest earlier weigh-in at the
  // gain's starting weight, else the first weigh-in) and the x axis reaches toward the target date.
  const gainStartDate = gain
    ? ([...entries]
        .reverse()
        .find((e, i) => i > 0 && Math.abs(e.weightKg - gain.startKg) <= 0.5)?.date ??
      entries[0]?.date ??
      today)
    : null;
  const gainPlan: GainPlanLine | null =
    gain && gainStartDate && weightSummary.targetKg !== null
      ? {
          startKg: gain.startKg,
          startDate: gainStartDate,
          targetKg: weightSummary.targetKg,
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
  // Hamil / Menyusui: no calorie target line, no over-target bars, no goal.
  const targetKcal = maternal ? null : (summary.data?.targets?.eatKcal ?? null);
  const kcalRange = kcalSeries.data ?? [];
  const { bars: kcalBarList, weekly: kcalWeekly } = kcalBars(kcalRange, domainStart, today);
  const kcalStats = kcalSummary(kcalRange, domainStart, today);
  // "Colored by direction relative to goal": losing only counts as good while
  // the target sits below the start.
  const wantDown =
    weightSummary.targetKg === null ||
    weightSummary.targetKg <= (weightSummary.startKg ?? Number.POSITIVE_INFINITY);
  const toneFor = (delta: number | null): "good" | "bad" | "neutral" => {
    if (maternal || delta === null || Math.abs(delta) < 0.05) return "neutral";
    // Gain plan: weight up is good, a drop is just neutral information.
    if (gain) return delta > 0 ? "good" : "neutral";
    return (wantDown ? delta < 0 : delta > 0) ? "good" : "bad";
  };

  const newestFirst = [...entries].toReversed();
  const visibleHistory = showAll ? newestFirst : newestFirst.slice(0, 10);

  const dayLabel = (date: string) => (date === today ? t("common:date.today") : fmtDateShort(date));
  const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${fmtKg(Math.abs(n))}`;

  /** One short line under the projection cell: why there is, or is not, a date. */
  const projectionSub = (pw: PeriodWeight | null, targetKg: number | null): string => {
    if (targetKg === null) return t("projection.setTarget");
    if (goalReached) return t("projection.reached");
    if (pw === null || pw.weeklyRateKg === null) return t("projection.needMore");
    if (pw.projectedDate !== null) return t("projection.toward", { kg: fmtKg(targetKg) });
    if (pw.direction === "steady") return t("projection.steady");
    const toward = (pw.endKg - targetKg) * pw.weeklyRateKg < 0;
    return toward ? t("projection.needMore") : t("projection.away");
  };

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <PageHeader
        title={t("page.titleShort")}
        className="pb-3"
        action={
          <span className="flex items-center gap-2">
            {weightSummary.latestKg !== null && !maternal && (
              <>
                <ShareStoryButton
                  label=""
                  ariaLabel={t("page.shareSticker")}
                  variant="secondary"
                  size="icon"
                  kinds={["weight"]}
                  story={weightStory(weightSummary, entries, summary.data)}
                />
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={t("page.share")}
                  title={t("page.share")}
                  onClick={() => setShareOpen(true)}
                >
                  <Newspaper className="size-4" aria-hidden />
                </Button>
              </>
            )}
            {weightSummary.latestKg !== null && (
              <Button onClick={openWeigh} disabled={checkIn.isPending}>
                {t("page.weigh")}
              </Button>
            )}
          </span>
        }
      />

      {weightSummary.latestKg === null ? (
        <Card className="text-center">
          <Mascot pose="determined" size="md" className="mb-3" />
          <p className="text-base font-bold">{t("empty.title")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t("empty.body")}</p>
          <Button className="mt-4" variant="secondary" onClick={openWeigh}>
            {t("page.weighNow")}
          </Button>
        </Card>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[1.15fr_1fr] lg:gap-5">
          <div className="space-y-3 lg:space-y-5">
            <Card className="p-4 sm:p-6">
              <p className="text-[0.8125rem] font-semibold text-muted-foreground">
                {t("hero.trendLabel")}
              </p>
              <p className="mt-0.5 text-5xl leading-none font-extrabold tracking-tighter tabular-nums sm:text-[3.25rem]">
                {fmtKg(trendKg ?? 0)}
                <span className="ml-1.5 text-lg font-bold text-muted-foreground">kg</span>
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground tabular-nums">
                <Scale className="size-4 shrink-0" aria-hidden />
                {t("hero.scale", {
                  kg: fmtKg(weightSummary.latestKg),
                  date: dayLabel(entries.at(-1)!.date),
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("hero.trendExplain")}</p>

              {goalReached && (
                <div className="mt-3 flex items-center gap-3 rounded-2xl bg-makan-soft px-3 py-1.5 text-sm font-bold text-makan-ink">
                  <Mascot pose="mantap" size="sm" className="mx-0" />
                  <p className="flex items-center gap-2">
                    <Medal className="size-4 shrink-0" aria-hidden />
                    {t("hero.goalReached")}
                  </p>
                </div>
              )}

              {!maternal && (weightSummary.targetKg !== null || bmi !== null) && (
                <dl className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-sm">
                  {weightSummary.targetKg !== null && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{t("hero.goalLabel")}</dt>
                      <dd className="text-right font-bold tabular-nums">
                        {goalReached || toGoalKg === null
                          ? t("hero.goalValueReached", { kg: fmtKg(weightSummary.targetKg) })
                          : t("hero.goalValue", {
                              kg: fmtKg(weightSummary.targetKg),
                              left: fmtKg(toGoalKg),
                            })}
                      </dd>
                    </div>
                  )}
                  {bmi !== null && bmiCategory !== null && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{t("bmi.label")}</dt>
                      <dd
                        className={cn(
                          "text-right font-bold tabular-nums",
                          bmiCategory === "ideal" ? "text-makan-ink" : "text-bakar-ink",
                        )}
                      >
                        {t("bmi.value", {
                          value: fmtKg(bmi),
                          category: t(`bmi.category.${bmiCategory}`),
                        })}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </Card>

            {gainInfo && gainInfo.flags.some((flag) => flag !== "TARGET_ABOVE_HEALTHY") && (
              <GainNotes
                gain={{
                  ...gainInfo,
                  flags: gainInfo.flags.filter((flag) => flag !== "TARGET_ABOVE_HEALTHY"),
                }}
              />
            )}

            {maternal?.mode === "pregnant" && <WeightGainCard onWeigh={openWeigh} />}

            <Card aria-label={t("period.title")} className="p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="shrink-0 text-base font-bold tracking-tight">{t("period.title")}</h2>
                <Segmented
                  className="sm:max-w-xs"
                  label={t("chart.rangeLabel")}
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "7", label: t("chart.range.d7") },
                    { value: "30", label: t("chart.range.d30") },
                    { value: "90", label: t("chart.range.d90") },
                    { value: "all", label: t("chart.range.all") },
                  ]}
                />
              </div>

              {rangeEntries.length === 0 ? (
                <div className="py-10 text-center">
                  <Mascot pose="determined" size="sm" className="mb-2" />
                  <p className="text-sm font-bold">{t("chart.emptyTitle", { range: rangeLabel })}</p>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                    {t("chart.emptyBody")}
                  </p>
                  <Button className="mt-4" variant="secondary" onClick={openWeigh}>
                    {t("chart.emptyAction")}
                  </Button>
                </div>
              ) : (
                <>
                  {!maternal &&
                    (period === null ? (
                      <p className="mt-3 text-sm text-muted-foreground">{t("period.needMore")}</p>
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <StatCell
                          label={t("period.start")}
                          value={fmtKg(period.startKg)}
                          unit="kg"
                          sub={t("period.trendOn", { date: fmtDateShort(period.startDate) })}
                        />
                        <StatCell
                          label={t("period.now")}
                          value={fmtKg(period.endKg)}
                          unit="kg"
                          sub={t("period.trendOn", { date: dayLabel(period.endDate) })}
                        />
                        <StatCell
                          label={t("stats.change")}
                          value={signed(period.changeKg)}
                          unit="kg"
                          sub={t("period.changePct", { pct: signed(period.changePct) })}
                          tone={toneFor(period.changeKg)}
                        />
                        <StatCell
                          label={t("stats.pace")}
                          value={period.weeklyRateKg === null ? "–" : signed(period.weeklyRateKg)}
                          unit={period.weeklyRateKg === null ? undefined : "kg"}
                          sub={
                            period.weeklyRateKg === null ? t("period.paceNeeds") : t("period.perWeek")
                          }
                          tone={toneFor(period.weeklyRateKg)}
                        />
                        {weightSummary.targetKg !== null && !gain && (
                          <div className="col-span-2">
                            <StatCell
                              label={t("stats.projection")}
                              value={
                                period.projectedDate
                                  ? t("stats.projectionValue", {
                                      month: fmtDate(period.projectedDate, "month"),
                                    })
                                  : "–"
                              }
                              sub={projectionSub(period, weightSummary.targetKg)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  {period !== null && period.startsLateDays > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("period.startsLate", { date: fmtDateShort(period.startDate) })}
                    </p>
                  )}

                  {rangeEntries.length === 1 && (
                    <p className="mt-2 text-xs text-muted-foreground">{t("chart.tomorrow")}</p>
                  )}
                  <div ref={chartRef} className={cn("relative mt-3", !chartSize && "h-44")}>
                    {chartSize && (
                      <WeightChart
                        width={chartSize.w}
                        height={chartSize.h}
                        entries={rangeEntries}
                        trendPoints={rangeTrend}
                        targetKg={weightSummary.targetKg}
                        domainStart={domainStart}
                        domainEnd={chartEnd}
                        rangeKey={range}
                        rangeLabel={rangeLabel}
                        bars={kcalBarList}
                        weekly={kcalWeekly}
                        gainPlan={gainPlan}
                      />
                    )}
                  </div>
                  <ChartLegend
                    showGoal={!gainPlan && weightSummary.targetKg !== null}
                    gainPlan={gainPlan}
                  />
                </>
              )}
              <details className="group mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-semibold select-none">
                  {t("detail.title")}
                </summary>
                <p className="mt-1.5">
                  {t("detail.trustTrend")} {t("detail.legend")}
                  {!maternal && gain ? ` ${t("gain:chart.gained", { kg: fmtKg(gain.gainedKg) })}` : ""}
                </p>
              </details>
              {!maternal && periodStory && rangeEntries.length > 0 && (
                <ShareStoryButton
                  className="mt-3 w-full"
                  variant="secondary"
                  label={t("period.share")}
                  kinds={["period"]}
                  story={periodStory}
                />
              )}
            </Card>

            {kcalSeries.data && kcalBarList.length > 0 && (
              <Card className="p-4 sm:p-5">
                <h2 className="text-base font-bold tracking-tight">
                  {kcalWeekly ? t("kcal.titleWeekly") : t("kcal.title")}
                </h2>
                <div className="mt-3">
                  {chartSize && (
                    <KcalChart
                      width={chartSize.w}
                      bars={kcalBarList}
                      weekly={kcalWeekly}
                      targetKcal={targetKcal}
                      gain={gain !== null}
                      domainStart={domainStart}
                      domainEnd={chartEnd}
                      rangeKey={range}
                    />
                  )}
                </div>
                <KcalLegend showTarget={targetKcal !== null} gain={gain !== null} />
                <p className="mt-1.5 text-xs font-semibold tabular-nums">
                  {kcalStats.trackedDays === 0
                    ? t("kcal.none")
                    : t("kcal.summary", {
                        tracked: kcalStats.trackedDays,
                        count: kcalStats.days,
                        avg: fmtKcalLabel(kcalStats.avgKcal ?? 0),
                      })}
                </p>
                {kcalWeekly && (
                  <p className="mt-1 text-xs text-muted-foreground">{t("detail.weekly")}</p>
                )}
              </Card>
            )}
          </div>

          <div className="space-y-3 lg:space-y-5">
            <section aria-label={t("history.title")}>
              <SectionTitle>{t("history.title")}</SectionTitle>
              <ListGroup>
                {visibleHistory.map((entry) => {
                  const index = newestFirst.indexOf(entry);
                  const prev = newestFirst[index + 1];
                  const delta = prev ? entry.weightKg - prev.weightKg : null;
                  return (
                    <ListRow
                      key={entry.id}
                      title={dayLabel(entry.date)}
                      subtitle={[
                        delta === null
                          ? t("history.first")
                          : delta !== 0
                            ? t("history.delta", { delta: signed(delta) })
                            : t("history.same"),
                        entry.bodyFatPct != null
                          ? t("history.bodyFat", { pct: fmtKg(entry.bodyFatPct) })
                          : null,
                        entry.musclePct != null
                          ? t("history.bodyMuscle", { pct: fmtKg(entry.musclePct) })
                          : null,
                        entry.source === "scale" ? t("history.scale") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      value={`${fmtKg(entry.weightKg)} kg`}
                    />
                  );
                })}
              </ListGroup>
              {entries.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="pressable mt-2 min-h-11 w-full rounded-3xl bg-card text-sm font-semibold text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  {showAll ? t("history.showLess") : t("history.showAll", { count: entries.length })}
                </button>
              )}
            </section>
          </div>
        </div>
      )}

      <WaistSection />

      <Sheet
        open={weighOpen}
        onOpenChange={setWeighOpen}
        title={t("sheet.title")}
        description={t("sheet.description")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitWeigh();
          }}
          className="space-y-4"
        >
          <div className="relative">
            <Input
              aria-label={t("sheet.weightLabel")}
              autoFocus
              type="number"
              step="0.1"
              min="25"
              max="400"
              inputMode="decimal"
              value={weighValue}
              onChange={(event) => setWeighValue(event.target.value)}
              className="h-16 pr-14 text-center text-3xl font-extrabold"
            />
            <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
              kg
            </span>
          </div>
          <Button type="submit" className="w-full" disabled={checkIn.isPending}>
            {checkIn.isPending ? t("sheet.saving") : t("common:actions.save")}
          </Button>
        </form>
      </Sheet>

      {entries.length > 0 && !maternal && (
        <ShareToFeedSheet
          open={shareOpen}
          onOpenChange={setShareOpen}
          title={t("share.title")}
          preview={t("share.preview", { kg: fmtKg(weightSummary.latestKg ?? 0) })}
          share={(input) =>
            client.social.createPost({
              kind: "berat",
              refId: entries[entries.length - 1]!.id,
              caption: input.caption || undefined,
              visibility: input.visibility,
            })
          }
        />
      )}
    </Page>
  );
}

function BeratSkeleton() {
  const { t } = useTranslation("berat");
  return (
    <Page className="max-w-xl lg:max-w-5xl" aria-busy="true" aria-label={t("page.loading")}>
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-44 rounded-full" />
        <Skeleton className="h-12 w-28 rounded-full" />
      </div>
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="mt-3 h-72 rounded-3xl" />
      <Skeleton className="mt-7 h-80 rounded-3xl" />
    </Page>
  );
}
