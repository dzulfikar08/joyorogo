import {
  type AnalysisHrZones,
  type AnalysisSeries,
  type SportKind,
  axisValue,
  formatDuration,
  formatPace,
  indexAtAxis,
} from "@joyorogo/api/lib/workout-analysis";
import { fmtDecimal } from "@joyorogo/i18n";
import {
  type ChartMetric,
  availableMetrics,
  metricValues,
  niceTicks,
  paceMode,
  valueDomain,
} from "@joyorogo/workout-view/analysis-math";
import { memo, useMemo } from "react";
import type { PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { stepLengthSeries } from "@/lib/stride";

import { HR_ZONE_COLORS } from "./zones";

/** Plot area geometry shared by every panel, so one vertical cursor lines up across all of them. */
const AXIS_WIDTH = 52;
const RIGHT_PAD = 12;

const COLOR: Record<Metric, string> = {
  pace: "var(--primary)",
  hr: "var(--heart)",
  alt: "var(--chart-5)",
  cad: "var(--tidur)",
  stride: "var(--recovery)",
  power: "var(--bakar)",
};

type Row = { x: number } & Partial<Record<Metric, number | null>>;

interface PanelModel {
  metric: Metric;
  rows: Row[];
  domain: [number, number];
  reversed: boolean;
}

/** A metric of the stacked charts: the shared ones, plus the step length the phone also draws for runs and walks. */
type Metric = ChartMetric | "stride";

/**
 * Values of one metric on the series grid. The step length is what the source measured, else speed over steps per second
 * (the phone's rule, `@/lib/stride`); the other metrics are the shared ones.
 */
function metricSeries(series: AnalysisSeries, metric: Metric, kind: SportKind): (number | null)[] {
  if (metric !== "stride") return metricValues(series, metric, kind);
  return stepLengthSeries(series, series.n) ?? [];
}

/** The y range of a metric: the shared rule, except for the step length (a few decimals wide). */
function domainOf(values: (number | null)[], metric: Metric): [number, number] {
  if (metric !== "stride") return valueDomain(values, metric);
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return [0, 1];
  let lo = Math.min(...present);
  let hi = Math.max(...present);
  if (hi - lo < 0.1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.05;
    hi = mid + 0.05;
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

function panelModels(
  series: AnalysisSeries,
  kind: SportKind,
): { models: PanelModel[]; xMax: number } {
  const xScale = series.dist ? 1000 : 60;
  const metrics: Metric[] = availableMetrics(series, kind);
  // Step length sits after cadence, on foot only: a bike's rpm has no step.
  if (paceMode(kind) === "pace" && stepLengthSeries(series, series.n) !== null)
    metrics.splice(metrics.includes("cad") ? metrics.indexOf("cad") + 1 : metrics.length, 0, "stride");
  const values = new Map(metrics.map((m) => [m, metricSeries(series, m, kind)]));
  const rows: Row[] = Array.from({ length: series.n }, (_, i) => {
    const row: Row = { x: axisValue(series, i) / xScale };
    for (const m of metrics) row[m] = values.get(m)?.[i] ?? null;
    return row;
  });
  return {
    xMax: axisValue(series, series.n - 1) / xScale,
    models: metrics.map((metric) => ({
      metric,
      rows,
      // A step is under a metre: the shared range spans at least one whole unit and would flatten the line.
      domain: domainOf(values.get(metric) ?? [], metric),
      // Pace is "seconds per km": a smaller number is faster, so the axis runs downward to keep faster on top.
      reversed: metric === "pace" && paceMode(kind) === "pace",
    })),
  };
}

/** Text of a metric's value for axis ticks and the readout. */
export function formatMetric(
  metric: Metric,
  kind: SportKind,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  if (metric === "pace")
    return paceMode(kind) === "speed" ? fmtDecimal(value, 1) : formatPace(value);
  return fmtDecimal(value, metric === "stride" ? 2 : 0);
}

const Panel = memo(function Panel({
  model,
  kind,
  hrZones,
  xMax,
  showAxis,
  label,
  unit,
  summary,
}: {
  model: PanelModel;
  kind: SportKind;
  hrZones: AnalysisHrZones | null;
  xMax: number;
  showAxis: boolean;
  label: string;
  unit: string;
  summary: string;
}) {
  const { metric, rows, domain, reversed } = model;
  const color = COLOR[metric];
  // Step length spans a fraction of a metre: three ticks would put one under the panel's label.
  const ticks = niceTicks(domain[0], domain[1], metric === "stride" ? 2 : 3);
  const height = showAxis ? 128 : 104;
  return (
    <div role="img" aria-label={summary} className="min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={rows} margin={{ top: 6, right: RIGHT_PAD, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`wk-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          {metric === "hr" &&
            hrZones &&
            HR_ZONE_COLORS.map((zoneColor, i) => (
              <ReferenceArea
                key={i}
                y1={Math.max(hrZones.bounds[i] ?? 0, domain[0])}
                y2={Math.min(hrZones.bounds[i + 1] ?? 0, domain[1])}
                fill={zoneColor}
                fillOpacity={0.1}
                stroke="none"
                ifOverflow="hidden"
              />
            ))}
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, xMax]}
            allowDataOverflow
            hide={!showAxis}
            axisLine={false}
            tickLine={false}
            tickMargin={6}
            tickCount={6}
            tickFormatter={(v: number) =>
              rows.length > 0 ? `${fmtDecimal(v, v < 10 && v % 1 !== 0 ? 1 : 0)}` : ""
            }
            label={
              showAxis
                ? {
                    value: unit,
                    position: "insideBottomRight",
                    offset: -2,
                    fill: "var(--muted-foreground)",
                    fontSize: 11,
                  }
                : undefined
            }
          />
          <YAxis
            width={AXIS_WIDTH}
            axisLine={false}
            tickLine={false}
            domain={domain}
            reversed={reversed}
            ticks={ticks}
            tickFormatter={(v: number) => formatMetric(metric, kind, v)}
            label={{
              value: label,
              position: "insideTopLeft",
              offset: 4,
              fill: "var(--muted-foreground)",
              fontSize: 11,
              dy: -4,
              dx: 4,
            }}
          />
          <Area
            dataKey={metric}
            type="monotone"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#wk-${metric})`}
            dot={false}
            activeDot={false}
            connectNulls={false}
            baseValue={reversed ? "dataMax" : "dataMin"}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

/**
 * One chart per metric the workout carries, stacked on one shared distance (or minutes) axis. Pointing at any of them
 * moves `scrubIndex`, which the map and the readout follow; a vertical cursor crosses every panel at that sample.
 */
export function WorkoutCharts({
  series,
  kind,
  hrZones,
  scrubIndex,
  onScrub,
}: {
  series: AnalysisSeries;
  kind: SportKind;
  hrZones: AnalysisHrZones | null;
  scrubIndex: number | null;
  onScrub: (index: number | null) => void;
}) {
  const { t } = useTranslation("fitWebWorkouts");
  const { models, xMax } = useMemo(() => panelModels(series, kind), [series, kind]);
  const xUnit = series.dist ? "km" : t("charts.minutes");

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const plot = rect.width - AXIS_WIDTH - RIGHT_PAD;
    if (plot <= 0) return;
    const frac = Math.min(1, Math.max(0, (event.clientX - rect.left - AXIS_WIDTH) / plot));
    const scale = series.dist ? 1000 : 60;
    onScrub(indexAtAxis(series, frac * xMax * scale));
  };

  const labelOf = (metric: Metric) =>
    metric === "pace"
      ? paceMode(kind) === "speed"
        ? t("charts.speed")
        : t("charts.pace")
      : t(`charts.${metric}`);
  const unitOf = (metric: Metric) =>
    metric === "pace"
      ? paceMode(kind) === "speed"
        ? t("unit.kmh")
        : t("unit.perKm")
      : t(`charts.unit.${metric}`);

  const cursor =
    scrubIndex !== null && xMax > 0
      ? Math.min(1, Math.max(0, axisValue(series, scrubIndex) / (xMax * (series.dist ? 1000 : 60))))
      : null;

  return (
    <div>
      <Readout
        series={series}
        kind={kind}
        metrics={models.map((m) => m.metric)}
        scrubIndex={scrubIndex}
        labelOf={labelOf}
        unitOf={unitOf}
      />
      <div
        className="relative mt-3 flex touch-pan-y flex-col"
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={() => onScrub(null)}
        data-testid="workout-charts"
      >
        {models.map((model, i) => (
          <Panel
            key={model.metric}
            model={model}
            kind={kind}
            hrZones={hrZones}
            xMax={xMax}
            showAxis={i === models.length - 1}
            label={`${labelOf(model.metric)} (${unitOf(model.metric)})`}
            unit={xUnit}
            summary={t("charts.aria", { metric: labelOf(model.metric) })}
          />
        ))}
        {cursor !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-6 w-px bg-foreground/50"
            style={{
              left: `calc(${AXIS_WIDTH}px + (100% - ${AXIS_WIDTH + RIGHT_PAD}px) * ${cursor})`,
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The numbers at the cursor: elapsed time, distance and each charted metric. */
function Readout({
  series,
  kind,
  metrics,
  scrubIndex,
  labelOf,
  unitOf,
}: {
  series: AnalysisSeries;
  kind: SportKind;
  metrics: Metric[];
  scrubIndex: number | null;
  labelOf: (metric: Metric) => string;
  unitOf: (metric: Metric) => string;
}) {
  const { t } = useTranslation("fitWebWorkouts");
  const values = useMemo(
    () => new Map(metrics.map((m) => [m, metricSeries(series, m, kind)])),
    [series, kind, metrics],
  );
  if (scrubIndex === null) {
    return <p className="min-h-12 text-xs text-muted-foreground">{t("charts.hint")}</p>;
  }
  const items: { label: string; value: string }[] = [
    { label: t("charts.time"), value: formatDuration(scrubIndex * series.stepSec) },
    ...(series.dist
      ? [
          {
            label: t("charts.distance"),
            value: `${fmtDecimal((series.dist[scrubIndex] ?? 0) / 1000, 2)} km`,
          },
        ]
      : []),
    ...metrics.map((m) => ({
      label: labelOf(m),
      value: `${formatMetric(m, kind, values.get(m)?.[scrubIndex])} ${unitOf(m)}`,
    })),
  ];
  return (
    <dl className="grid min-h-12 grid-cols-3 gap-x-3 gap-y-1 text-sm tabular-nums sm:flex sm:flex-wrap sm:gap-x-6">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="break-words text-[0.6875rem] text-muted-foreground">{item.label}</dt>
          <dd className="break-words font-bold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
