import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Medal, Scale, Share2, TrendingDown, TrendingUp } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  daysBetween,
  emaTrendPoints,
  jakartaToday,
  rangeStats,
  shiftDate,
} from "@joyorogo/api/lib/engine";
import type { RangeStats } from "@joyorogo/api/lib/engine";
import { kcalBars, kcalSummary } from "@joyorogo/api/lib/kcal-bars";
import type { KcalBar } from "@joyorogo/api/lib/kcal-bars";

import { Mascot } from "@/components/mascot";
import { ScreenError } from "@/components/screen-state";
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
import { client, orpc } from "@/utils/orpc";

// 365 = the API cap, so the "Semua" range really shows everything.
const historyOptions = orpc.weight.history.queryOptions({ input: { limit: 365 } });
// The authoritative trend (28-day smoothed EMA + pace + projection) comes
// from day.summary; the history only supplies the raw scale dots.
const summaryOptions = orpc.day.summary.queryOptions({ input: {} });
const profileOptions = orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/berat")({
  loader: ({ context }) => context.queryClient.ensureQueryData(historyOptions),
  pendingComponent: BeratSkeleton,
  component: BeratPage,
});


const PAD = { top: 18, right: 38, bottom: 26, left: 38 };

/** Calorie bars live in the bottom share of the plot, on their own (right) axis. */
const BAR_ZONE = 0.38;
/** An untracked day's hatched placeholder, as a share of the bar zone. */
const GHOST_SHARE = 0.45;

/** 2140 -> "2,1k" for the compact right axis. */
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
  startKg,
  domainStart,
  domainEnd,
  rangeKey,
  rangeLabel,
  bars,
  weekly,
  targetKcal,
}: {
  width: number;
  height: number;
  /** raw scale weigh-ins in the range, oldest first */
  entries: Array<{ date: string; weightKg: number }>;
  /** EMA trend over the same range, oldest first */
  trendPoints: Array<{ date: string; trendKg: number }>;
  targetKg: number | null;
  startKg: number | null;
  domainStart: string;
  domainEnd: string;
  /** replays the draw-in animation when the range changes */
  rangeKey: string;
  rangeLabel: string;
  /** calorie bars over the same time axis (daily, or per week on long ranges) */
  bars: KcalBar[];
  weekly: boolean;
  targetKcal: number | null;
}) {
  const { t } = useTranslation("berat");
  const [scrubDate, setScrubDate] = useState<string | null>(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
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

  // Secondary axis: kcal 0..maxK in the bottom BAR_ZONE of the plot. The
  // target line joins the domain so it never clips off the top.
  const baseY = PAD.top + innerH;
  const zoneH = innerH * BAR_ZONE;
  const maxK = Math.max(
    500,
    Math.ceil((Math.max(targetKcal ?? 0, ...bars.map((b) => b.avgKcal ?? 0)) * 1.1) / 500) * 500,
  );
  const ky = (kcal: number) => baseY - (kcal / maxK) * zoneH;
  const pxPerDay = innerW / spanDays;
  const barGeom = (b: KcalBar) =>
    weekly
      ? { left: x(b.from), w: Math.max((daysBetween(b.from, b.to) + 1) * pxPerDay - 2, 2) }
      : (() => {
          const w = Math.max(pxPerDay * 0.7, 1.5);
          return { left: x(b.from) - w / 2, w };
        })();
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
        <defs>
          <pattern
            id="kcal-hatch"
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
              className="stroke-muted-foreground/50"
            />
          </pattern>
        </defs>
        <g key={`bars-${rangeKey}`} className="chart-fade">
          {bars.map((b) => {
            const { left, w } = barGeom(b);
            const barH = b.avgKcal === null ? 0 : baseY - ky(b.avgKcal);
            const ghostH = zoneH * GHOST_SHARE * (b.untrackedDays / b.days);
            const over = targetKcal !== null && b.avgKcal !== null && b.avgKcal > targetKcal;
            return (
              <g key={b.from}>
                {b.avgKcal !== null && (
                  <rect
                    x={left}
                    y={baseY - barH}
                    width={w}
                    height={barH}
                    rx={Math.min(w / 4, 2)}
                    className={over ? "fill-bakar/80" : "fill-bakar/35"}
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
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={ky(targetKcal)}
            y2={ky(targetKcal)}
            strokeDasharray="6 4"
            strokeWidth={1.25}
            className="stroke-bakar-ink/70"
          />
        )}
        <g fontSize={10} fontWeight={600} className="fill-bakar-ink">
          {[maxK / 2, maxK].map((k) => (
            <text key={k} x={width - PAD.right + 5} y={ky(k) + 3}>
              {kcalAxis(k)}
            </text>
          ))}
        </g>
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
        {start !== null && (
          <g>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(start)}
              y2={y(start)}
              strokeDasharray="2 5"
              strokeWidth={1.25}
              className="stroke-muted-foreground/45"
            />
            <text
              x={PAD.left}
              y={
                (target !== null && Math.abs(y(start) - y(target)) < 15) || y(start) < PAD.top + 14
                  ? y(start) + 15
                  : y(start) - 6
              }
              fontSize={11}
              fontWeight={600}
              className="fill-muted-foreground"
            >
              {t("chart.start", { kg: fmtKg(start) })}
            </text>
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
                  scrubDelta === null
                    ? "text-muted-foreground"
                    : scrubDelta < 0
                      ? "text-makan-ink"
                      : scrubDelta > 0
                        ? "text-bakar-ink"
                        : "text-muted-foreground",
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

/** One-line key: Berat, Tren, Kalori (over/under), Belum dicatat, Target. */
function ChartLegend({ showTarget }: { showTarget: boolean }) {
  const { t } = useTranslation("berat");
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
      <li className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-primary/35" />
        {t("legend.weight")}
      </li>
      <li className="flex items-center gap-1">
        <span className="h-0.5 w-3 rounded-full bg-primary" />
        {t("legend.trend")}
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2 rounded-sm bg-bakar/35" />
        <span className="-ml-0.5 size-2 rounded-sm bg-bakar/80" />
        {t("legend.kcal")}
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


/** Small stat tile inside the chart card header (trend, range delta, pace, projection). */
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
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
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
  const { t } = useTranslation(["berat", "common"]);
  const summary = useQuery(summaryOptions);
  const profile = useQuery(profileOptions);
  const { entries, summary: weightSummary } = history;
  const trend = summary.data?.trend ?? null;
  const today = jakartaToday();

  const [range, setRange] = useState<"7" | "30" | "90" | "all">("30");
  const [showAll, setShowAll] = useState(false);
  const [weighOpen, setWeighOpen] = useState(false);
  const [weighValue, setWeighValue] = useState("");
  // Bagikan ke feed: check-in berat terakhir sebagai post 'berat'.
  const [shareOpen, setShareOpen] = useState(false);
  const chart = useChartSize();
  // One fetch of the last 400 days (the API cap); ranges filter locally.
  const kcalSeries = useQuery(
    orpc.day.kcalSeries.queryOptions({
      input: { from: jakartaDatePlusDays(-399), to: today },
    }),
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

  const trendKg = trend?.weightKg ?? weightSummary.latestKg;
  const rate = trend?.weeklyRateKg ?? null;
  const flat = rate !== null && Math.abs(rate) <= 0.05;
  const heightCm = profile.data?.profile?.heightCm ?? null;
  const bmi =
    weightSummary.latestKg !== null && heightCm
      ? weightSummary.latestKg / (heightCm / 100) ** 2
      : null;
  const bmiCategory =
    bmi === null ? null : bmi < 18.5 ? "under" : bmi < 25 ? "ideal" : bmi < 30 ? "over" : "obese";
  const goalReached =
    trendKg !== null && weightSummary.targetKg !== null && trendKg <= weightSummary.targetKg;

  // Chart line: client-side 7-day EMA over the raw entries, so every range —
  // including "Semua" — gets a full trend (day.summary only ships 30 days).
  const allTrend = useMemo(() => emaTrendPoints(entries), [entries]);
  const rangeDays = range === "all" ? null : Number(range);
  const cutoff = rangeDays === null ? null : jakartaDatePlusDays(-(rangeDays - 1));
  const rangeEntries = cutoff === null ? entries : entries.filter((e) => e.date >= cutoff);
  const rangeTrend = cutoff === null ? allTrend : allTrend.filter((p) => p.date >= cutoff);
  const rangeStatsOut = rangeStats(rangeTrend, weightSummary.targetKg);
  const rangeLabel =
    range === "all" ? t("chart.sinceStart") : t("chart.rangeLast", { count: Number(range) });
  const rangeShort =
    range === "all" ? t("chart.sinceStart") : t("chart.rangeDays", { count: Number(range) });
  const domainStart = cutoff ?? rangeEntries[0]?.date ?? today;
  const targetKcal = summary.data?.targets?.eatKcal ?? null;
  const kcalRange = kcalSeries.data ?? [];
  const { bars: kcalBarList, weekly: kcalWeekly } = kcalBars(kcalRange, domainStart, today);
  const kcalStats = kcalSummary(kcalRange, domainStart, today);
  // "Colored by direction relative to goal": losing only counts as good while
  // the target sits below the start.
  const wantDown =
    weightSummary.targetKg === null ||
    weightSummary.targetKg <= (weightSummary.startKg ?? Number.POSITIVE_INFINITY);
  const toneFor = (delta: number | null): "good" | "bad" | "neutral" => {
    if (delta === null || Math.abs(delta) < 0.05) return "neutral";
    return (wantDown ? delta < 0 : delta > 0) ? "good" : "bad";
  };

  const newestFirst = [...entries].toReversed();
  const visibleHistory = showAll ? newestFirst : newestFirst.slice(0, 10);

  const dayLabel = (date: string) => (date === today ? t("common:date.today") : fmtDateShort(date));
  const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${fmtKg(Math.abs(n))}`;

  /** Friendly sub-caption for the projection stat, per reason it is (not) shown. */
  const projectionSub = (stats: RangeStats, targetKg: number | null): string => {
    if (targetKg === null) return t("projection.setTarget");
    if (goalReached) return t("projection.reached");
    if (stats.projectedDate !== null) return t("projection.toward", { kg: fmtKg(targetKg) });
    if (stats.weeklyRateKg === null || stats.changeKg === null) return t("projection.needMore");
    if (Math.abs(stats.weeklyRateKg) < 0.05) return t("projection.steady");
    const toward = (stats.trendKg - targetKg) * stats.weeklyRateKg < 0;
    return toward ? t("projection.almost") : t("projection.away");
  };

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <PageHeader
        title={t("page.title")}
        className="pb-3"
        action={
          <span className="flex items-center gap-2">
            {weightSummary.latestKg !== null && (
              <Button variant="secondary" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" aria-hidden />
                <span className="max-sm:sr-only">{t("page.share")}</span>
              </Button>
            )}
            <Button onClick={openWeigh} disabled={checkIn.isPending}>
              {t("page.weigh")}
            </Button>
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-semibold text-muted-foreground">
                    {t("hero.trendLabel")}
                  </p>
                  <p className="mt-0.5 text-5xl leading-none font-extrabold tracking-tighter tabular-nums sm:text-[3.25rem]">
                    {fmtKg(trendKg ?? 0)}
                    <span className="ml-1.5 text-lg font-bold text-muted-foreground">kg</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {bmi !== null && bmiCategory !== null && (
                    <span
                      className={cn(
                        "inline-flex min-h-7 items-center rounded-full px-3 text-xs font-bold tabular-nums",
                        bmiCategory === "ideal"
                          ? "bg-makan-soft text-makan-ink"
                          : "bg-bakar-soft text-bakar-ink",
                      )}
                    >
                      {t("bmi.pill", {
                        value: fmtKg(bmi),
                        category: t(`bmi.category.${bmiCategory}`),
                      })}
                    </span>
                  )}
                  <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-semibold text-muted-foreground tabular-nums">
                    <Scale className="size-3.5" aria-hidden />
                    {t("hero.scale", {
                      kg: fmtKg(weightSummary.latestKg),
                      date: dayLabel(entries.at(-1)!.date),
                    })}
                  </span>
                </div>
              </div>

              {rate !== null && (
                <p
                  className={cn(
                    "mt-2 flex items-center gap-1.5 text-sm font-bold",
                    flat ? "text-muted-foreground" : rate < 0 ? "text-makan-ink" : "text-bakar-ink",
                  )}
                >
                  {!flat &&
                    (rate < 0 ? (
                      <TrendingDown className="size-4" aria-hidden />
                    ) : (
                      <TrendingUp className="size-4" aria-hidden />
                    ))}
                  {flat
                    ? t("hero.steadyWeek")
                    : t(rate < 0 ? "trend.down" : "trend.up", { kg: fmtKg(Math.abs(rate)) })}
                </p>
              )}

              {goalReached && (
                <div className="mt-3 flex items-center gap-3 rounded-2xl bg-makan-soft px-3 py-1.5 text-sm font-bold text-makan-ink">
                  <Mascot pose="mantap" size="sm" className="mx-0" />
                  <p className="flex items-center gap-2">
                    <Medal className="size-4 shrink-0" aria-hidden />
                    {t("hero.goalReached")}
                  </p>
                </div>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">{t("summary.start")}</p>
                  <p className="mt-0.5 text-lg leading-tight font-extrabold tabular-nums">
                    {fmtKg(weightSummary.startKg ?? 0)}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">{t("summary.down")}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg leading-tight font-extrabold tabular-nums",
                      (weightSummary.deltaKg ?? 0) < 0 && "text-makan-ink",
                      (weightSummary.deltaKg ?? 0) > 0 && "text-bakar-ink",
                    )}
                  >
                    {weightSummary.deltaKg !== null ? fmtKg(Math.abs(weightSummary.deltaKg)) : "–"}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {weightSummary.deltaKg === null
                      ? t("summary.noData")
                      : weightSummary.deltaKg < 0
                        ? t("summary.fromStart")
                        : weightSummary.deltaKg > 0
                          ? t("summary.upFromStart")
                          : t("summary.same")}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {t("summary.remaining")}
                  </p>
                  <p className="mt-0.5 text-lg leading-tight font-extrabold tabular-nums">
                    {weightSummary.remainingKg !== null ? fmtKg(weightSummary.remainingKg) : "–"}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {weightSummary.targetKg !== null
                      ? t("summary.target", { kg: fmtKg(weightSummary.targetKg) })
                      : t("summary.setTarget")}
                  </p>
                </div>
              </div>
            </Card>

            <Card aria-label={t("chart.title")} className="p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="shrink-0 text-base font-bold tracking-tight max-sm:sr-only">
                  {t("chart.title")}
                </h2>
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
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <StatCell
                      label={t("stats.change")}
                      value={
                        rangeStatsOut.changeKg === null
                          ? "–"
                          : `${rangeStatsOut.changeKg < 0 ? "−" : "+"}${fmtKg(
                              Math.abs(rangeStatsOut.changeKg),
                            )}`
                      }
                      unit={rangeStatsOut.changeKg === null ? undefined : "kg"}
                      sub={rangeShort}
                      tone={toneFor(rangeStatsOut.changeKg)}
                    />
                    <StatCell
                      label={t("stats.pace")}
                      value={rangeStatsOut.weeklyRateKg === null ? "–" : signed(rangeStatsOut.weeklyRateKg)}
                      sub={rangeStatsOut.weeklyRateKg === null ? undefined : t("stats.perWeek")}
                      tone={toneFor(rangeStatsOut.weeklyRateKg)}
                    />
                    <StatCell
                      label={t("stats.projection")}
                      value={
                        rangeStatsOut.projectedDate
                          ? t("stats.projectionValue", {
                              month: fmtDate(rangeStatsOut.projectedDate, "month"),
                            })
                          : "–"
                      }
                      sub={projectionSub(rangeStatsOut, weightSummary.targetKg)}
                    />
                  </div>

                  {rangeEntries.length === 1 && (
                    <p className="mt-2 text-xs text-muted-foreground">{t("chart.tomorrow")}</p>
                  )}
                  <div ref={chart.ref} className={cn("relative mt-3", !chart.size && "h-44")}>
                    {chart.size && (
                      <WeightChart
                        width={chart.size.w}
                        height={chart.size.h}
                        entries={rangeEntries}
                        trendPoints={rangeTrend}
                        targetKg={weightSummary.targetKg}
                        startKg={weightSummary.startKg}
                        domainStart={domainStart}
                        domainEnd={today}
                        rangeKey={range}
                        rangeLabel={rangeLabel}
                        bars={kcalBarList}
                        weekly={kcalWeekly}
                        targetKcal={targetKcal}
                      />
                    )}
                  </div>
                  <ChartLegend showTarget={targetKcal !== null} />
                  {kcalSeries.data && (
                    <p className="mt-1.5 text-xs font-semibold tabular-nums">
                      {kcalStats.trackedDays === 0
                        ? t("kcal.none")
                        : t("kcal.summary", {
                            tracked: kcalStats.trackedDays,
                            count: kcalStats.days,
                            avg: fmtKcalLabel(kcalStats.avgKcal ?? 0),
                          })}
                    </p>
                  )}
                </>
              )}
              <details className="group mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-semibold select-none">
                  {t("detail.title")}
                </summary>
                <p className="mt-1.5">
                  {t("detail.trustTrend")} {t("detail.legend")}
                  {kcalWeekly ? ` ${t("detail.weekly")}` : ""}
                  {weightSummary.deltaKg !== null &&
                    ` ${t(weightSummary.deltaKg < 0 ? "detail.totalDown" : "detail.totalUp", {
                      kg: fmtKg(Math.abs(weightSummary.deltaKg)),
                    })}`}
                </p>
              </details>
            </Card>
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
                      subtitle={
                        delta === null
                          ? t("history.first")
                          : delta !== 0
                            ? t("history.delta", { delta: signed(delta) })
                            : t("history.same")
                      }
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

      {entries.length > 0 && (
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
