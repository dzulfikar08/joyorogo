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

import {
  daysBetween,
  emaTrendPoints,
  jakartaToday,
  rangeStats,
  shiftDate,
} from "@joyorogo/api/lib/engine";
import type { RangeStats } from "@joyorogo/api/lib/engine";

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
import { fmtKg, jakartaDatePlusDays, parseNum } from "@/lib/format";
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

const PAD = { top: 18, right: 14, bottom: 26, left: 38 };

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
}) {
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

  const trendPath =
    trendPoints.length > 1
      ? trendPoints
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(p.trendKg).toFixed(1)}`)
          .join(" ")
      : null;

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

  const TIP_W = 176;
  const TIP_H = 104;
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
        aria-label={`Grafik tren berat badan, ${rangeLabel}. Geser kursor untuk melihat tiap catatan.`}
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
              Target {fmtKg(target)}
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
              Awal {fmtKg(start)}
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
              {shortDate(t)}
            </text>
          ))}
        </g>
      </svg>

      {scrubEntry && (
        <div
          className="pointer-events-none absolute z-10 rounded-2xl border border-border/60 bg-card/95 p-3 shadow-lg backdrop-blur-sm"
          style={{ left: tipLeft, top: tipTop, width: TIP_W }}
        >
          <p className="text-xs font-bold">{mediumDate(scrubEntry.date)}</p>
          <dl className="mt-1.5 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Timbangan</dt>
              <dd className="font-bold tabular-nums">{fmtKg(scrubEntry.weightKg)} kg</dd>
            </div>
            {scrubTrend && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Tren</dt>
                <dd className="font-bold tabular-nums">{fmtKg(scrubTrend.trendKg)} kg</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">vs sebelumnya</dt>
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
                  ? "catatan pertama"
                  : scrubDelta === 0
                    ? "sama"
                    : `${scrubDelta < 0 ? "−" : "+"}${fmtKg(Math.abs(scrubDelta))} kg`}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </>
  );
}

/** Friendly sub-caption for the projection stat, per reason it is (not) shown. */
function projectionSub(stats: RangeStats, targetKg: number | null, goalReached: boolean): string {
  if (targetKg === null) return "atur target di Profil";
  if (goalReached) return "sudah tercapai, jaga ritmenya";
  if (stats.projectedDate !== null) return `menuju ${fmtKg(targetKg)} kg`;
  if (stats.weeklyRateKg === null || stats.changeKg === null) return "butuh lebih banyak catatan";
  if (Math.abs(stats.weeklyRateKg) < 0.05) return "ritme sedang stabil";
  const toward = (stats.trendKg - targetKg) * stats.weeklyRateKg < 0;
  return toward ? "hampir ada, teruskan" : "ritme terakhir menjauhi target";
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
    <div className="min-w-0 rounded-2xl bg-muted/50 p-3">
      <p className="truncate text-[0.8125rem] font-semibold text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg leading-tight font-extrabold tabular-nums",
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

  const checkIn = useWeightCheckIn((row) => `Berat dicatat: ${fmtKg(row.weightKg)} kg`);

  const openWeigh = () => {
    setWeighValue(weightSummary.latestKg !== null ? String(weightSummary.latestKg) : "");
    setWeighOpen(true);
  };
  const submitWeigh = () => {
    const kg = parseNum(weighValue);
    if (kg === null || kg < 25 || kg > 400) {
      toast.error("Isi berat badan antara 25 dan 400 kg.");
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
    bmi === null
      ? null
      : bmi < 18.5
        ? "Kurang"
        : bmi < 25
          ? "Ideal"
          : bmi < 30
            ? "Overweight"
            : "Obesitas";
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
  const rangeLabel = range === "all" ? "sejak awal" : `${range} hari terakhir`;
  const domainStart = cutoff ?? rangeEntries[0]?.date ?? today;
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

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <PageHeader
        title="Berat badan"
        action={
          <span className="flex items-center gap-2">
            {weightSummary.latestKg !== null && (
              <Button variant="secondary" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" aria-hidden />
                Bagikan progres
              </Button>
            )}
            <Button onClick={openWeigh} disabled={checkIn.isPending}>
              Timbang
            </Button>
          </span>
        }
      />

      {weightSummary.latestKg === null ? (
        <Card className="text-center">
          <Mascot pose="determined" size="md" className="mb-3" />
          <p className="text-base font-bold">Belum ada catatan berat</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Timbang dirimu lalu simpan lewat tombol Timbang. Grafik, tren, dan riwayat muncul
            setelah catatan pertama.
          </p>
          <Button className="mt-4" variant="secondary" onClick={openWeigh}>
            Timbang sekarang
          </Button>
        </Card>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[1.15fr_1fr] lg:gap-5">
          <div className="space-y-3 lg:space-y-5">
            <Card className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-semibold text-muted-foreground">Berat tren</p>
                  <p className="mt-1 text-[3.25rem] leading-none font-extrabold tracking-tighter tabular-nums">
                    {fmtKg(trendKg ?? 0)}
                    <span className="ml-1.5 text-lg font-bold text-muted-foreground">kg</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {bmi !== null && bmiCategory !== null && (
                    <span
                      className={cn(
                        "inline-flex min-h-8 items-center rounded-full px-3 text-xs font-bold tabular-nums",
                        bmiCategory === "Ideal"
                          ? "bg-makan-soft text-makan-ink"
                          : "bg-bakar-soft text-bakar-ink",
                      )}
                    >
                      BMI {fmtKg(bmi)} · {bmiCategory}
                    </span>
                  )}
                  <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-semibold text-muted-foreground tabular-nums">
                    <Scale className="size-3.5" aria-hidden />
                    Timbangan {fmtKg(weightSummary.latestKg)} kg
                  </span>
                </div>
              </div>

              {rate !== null && (
                <p
                  className={cn(
                    "mt-3 flex items-center gap-1.5 text-sm font-bold",
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
                    ? "Stabil minggu ini"
                    : `${rate < 0 ? "Turun" : "Naik"} ${fmtKg(Math.abs(rate))} kg/minggu`}
                </p>
              )}

              {goalReached && (
                <div className="mt-5 flex items-center gap-3 rounded-2xl bg-makan-soft px-4 py-2 text-sm font-bold text-makan-ink">
                  <Mascot pose="mantap" size="sm" className="mx-0" />
                  <p className="flex items-center gap-2">
                    <Medal className="size-4 shrink-0" aria-hidden />
                    Target berat sudah tercapai. Jaga ritmenya.
                  </p>
                </div>
              )}
            </Card>

            <Card aria-label="Grafik tren berat">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="shrink-0 text-base font-bold tracking-tight">Grafik tren</h2>
                <Segmented
                  className="sm:max-w-xs"
                  label="Rentang grafik"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "7", label: "7H" },
                    { value: "30", label: "30H" },
                    { value: "90", label: "90H" },
                    { value: "all", label: "Semua" },
                  ]}
                />
              </div>

              {rangeEntries.length === 0 ? (
                <div className="py-10 text-center">
                  <Mascot pose="determined" size="sm" className="mb-2" />
                  <p className="text-sm font-bold">Belum ada catatan {rangeLabel}.</p>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                    Pilih rentang lebih panjang, atau catat beratmu untuk mulai mengisi grafik.
                  </p>
                  <Button className="mt-4" variant="secondary" onClick={openWeigh}>
                    Catat berat
                  </Button>
                </div>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                    <StatCell
                      label="Berat tren"
                      value={fmtKg(trendKg ?? rangeStatsOut.trendKg)}
                      unit="kg"
                      sub={`terakhir ${shortDate(rangeEntries.at(-1)!.date)}`}
                    />
                    <StatCell
                      label="Perubahan"
                      value={
                        rangeStatsOut.changeKg === null
                          ? "–"
                          : `${rangeStatsOut.changeKg < 0 ? "−" : "+"}${fmtKg(
                              Math.abs(rangeStatsOut.changeKg),
                            )}`
                      }
                      unit={rangeStatsOut.changeKg === null ? undefined : "kg"}
                      sub={rangeLabel}
                      tone={toneFor(rangeStatsOut.changeKg)}
                    />
                    <StatCell
                      label="Laju"
                      value={
                        rangeStatsOut.weeklyRateKg === null
                          ? "–"
                          : `${
                              rangeStatsOut.weeklyRateKg < 0
                                ? "−"
                                : rangeStatsOut.weeklyRateKg > 0
                                  ? "+"
                                  : ""
                            }${fmtKg(Math.abs(rangeStatsOut.weeklyRateKg))}`
                      }
                      unit={rangeStatsOut.weeklyRateKg === null ? undefined : "kg/minggu"}
                      sub="rata-rata"
                      tone={toneFor(rangeStatsOut.weeklyRateKg)}
                    />
                    <StatCell
                      label="Proyeksi"
                      value={
                        rangeStatsOut.projectedDate
                          ? `±${monthYear(rangeStatsOut.projectedDate)}`
                          : "–"
                      }
                      sub={projectionSub(rangeStatsOut, weightSummary.targetKg, goalReached)}
                    />
                  </div>

                  {rangeEntries.length === 1 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Timbang lagi besok untuk mulai melihat garis tren.
                    </p>
                  )}
                  <div ref={chart.ref} className={cn("relative mt-4", !chart.size && "h-44")}>
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
                      />
                    )}
                  </div>
                </>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Garis = tren (rata-rata bergerak 7 hari), titik = timbangan harian.
                {weightSummary.deltaKg !== null &&
                  ` Total ${weightSummary.deltaKg < 0 ? "turun" : "naik"} ${fmtKg(
                    Math.abs(weightSummary.deltaKg),
                  )} kg sejak berat awal.`}
              </p>
            </Card>
          </div>

          <div className="space-y-3 lg:space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-card p-3.5">
                <p className="text-[0.8125rem] font-semibold text-muted-foreground">Mulai</p>
                <p className="mt-1 text-xl leading-tight font-extrabold tabular-nums">
                  {fmtKg(weightSummary.startKg ?? 0)}
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                </p>
              </div>
              <div className="rounded-2xl bg-card p-3.5">
                <p className="text-[0.8125rem] font-semibold text-muted-foreground">Turun</p>
                <p
                  className={cn(
                    "mt-1 text-xl leading-tight font-extrabold tabular-nums",
                    (weightSummary.deltaKg ?? 0) < 0 && "text-makan-ink",
                    (weightSummary.deltaKg ?? 0) > 0 && "text-bakar-ink",
                  )}
                >
                  {weightSummary.deltaKg !== null ? fmtKg(Math.abs(weightSummary.deltaKg)) : "–"}
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {weightSummary.deltaKg === null
                    ? "belum ada data"
                    : weightSummary.deltaKg < 0
                      ? "dari berat awal"
                      : weightSummary.deltaKg > 0
                        ? "naik dari awal"
                        : "masih sama"}
                </p>
              </div>
              <div className="rounded-2xl bg-card p-3.5">
                <p className="text-[0.8125rem] font-semibold text-muted-foreground">Sisa</p>
                <p className="mt-1 text-xl leading-tight font-extrabold tabular-nums">
                  {weightSummary.remainingKg !== null ? fmtKg(weightSummary.remainingKg) : "–"}
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {weightSummary.targetKg !== null
                    ? `Target ${fmtKg(weightSummary.targetKg)} kg`
                    : "atur target di Profil"}
                </p>
              </div>
            </div>

            <section aria-label="Riwayat timbangan">
              <SectionTitle>Riwayat</SectionTitle>
              <ListGroup>
                {visibleHistory.map((entry) => {
                  const index = newestFirst.indexOf(entry);
                  const prev = newestFirst[index + 1];
                  const delta = prev ? entry.weightKg - prev.weightKg : null;
                  return (
                    <ListRow
                      key={entry.id}
                      title={entry.date === today ? "Hari ini" : shortDate(entry.date)}
                      subtitle={
                        delta === null
                          ? "catatan pertama"
                          : delta !== 0
                            ? `${delta < 0 ? "−" : "+"}${fmtKg(Math.abs(delta))} kg dari sebelumnya`
                            : "sama seperti sebelumnya"
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
                  {showAll ? "Tampilkan lebih sedikit" : `Tampilkan semua (${entries.length})`}
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
        title="Timbang hari ini"
        description="Satu catatan per hari. Menyimpan lagi menimpa angka tadi."
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
              aria-label="Berat badan (kg)"
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
            {checkIn.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>
      </Sheet>

      {entries.length > 0 && (
        <ShareToFeedSheet
          open={shareOpen}
          onOpenChange={setShareOpen}
          title="Bagikan progres berat"
          preview={`Check-in terakhir · ${fmtKg(weightSummary.latestKg ?? 0)} kg`}
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
  return (
    <Page className="max-w-xl lg:max-w-5xl" aria-busy="true" aria-label="Memuat riwayat berat">
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-44 rounded-full" />
        <Skeleton className="h-12 w-28 rounded-full" />
      </div>
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="mt-3 h-72 rounded-3xl" />
      <div className="mt-3 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-7 h-80 rounded-3xl" />
    </Page>
  );
}
