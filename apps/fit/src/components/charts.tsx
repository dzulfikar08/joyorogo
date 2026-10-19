import { fmtDateShort, fmtDecimal } from "@joyorogo/i18n";
import { cn } from "@joyorogo/ui/lib/utils";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  type DayPoint,
  type Metric,
  SPORT_KINDS,
  type SportKind,
  type VolumeRow,
} from "@/lib/aggregate";
import { SPORT_COLOR } from "@/lib/sport";

const PREVIOUS_COLOR = "var(--muted-foreground)";

export interface DaySeries {
  key: Metric;
  label: string;
  color: string;
  kind: "line" | "bar" | "area";
  axis?: "left" | "right";
  digits?: number;
  unit?: string;
}

type Row = { date: string; previousDate?: string } & Record<
  string,
  number | string | null | undefined
>;

function mergeRows(
  rows: readonly DayPoint[],
  previous: readonly DayPoint[] | undefined,
  series: readonly DaySeries[],
): Row[] {
  return rows.map((point, i) => {
    const row: Row = { date: point.date };
    const before = previous?.[i];
    if (before) row.previousDate = before.date;
    for (const s of series) {
      row[s.key] = point[s.key];
      if (before) row[`${s.key}:previous`] = before[s.key];
    }
    return row;
  });
}

function TooltipBox({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-36 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      {children}
    </div>
  );
}

function Swatch({
  color,
  dashed,
  block,
  bar,
}: {
  color: string;
  dashed?: boolean;
  block?: boolean;
  bar?: boolean;
}) {
  // `block` is the ghost bar of the previous period, `bar` a solid bar of the current one.
  if (block || bar)
    return (
      <span
        aria-hidden
        className="inline-block size-2.5 shrink-0 rounded-sm"
        style={{ background: color, opacity: block ? 0.35 : 1 }}
      />
    );
  return (
    <span
      aria-hidden
      className="inline-block h-0 w-3 shrink-0 border-t-2"
      style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
    />
  );
}

/** Shown on hover: the day, each series' value and, when comparing, the same series from the period before. */
function DayTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: readonly { payload?: Row }[];
  series: readonly DaySeries[];
}) {
  const { t } = useTranslation("fitWeb");
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const value = (v: unknown, s: DaySeries) =>
    typeof v === "number" ? `${fmtDecimal(v, s.digits ?? 0)}${s.unit ? ` ${s.unit}` : ""}` : "–";
  return (
    <TooltipBox>
      <p className="mb-1 font-bold">{fmtDateShort(row.date)}</p>
      <ul className="flex flex-col gap-0.5">
        {series.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-4 tabular-nums">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Swatch color={s.color} />
              {s.label}
            </span>
            <span className="font-semibold">{value(row[s.key], s)}</span>
          </li>
        ))}
      </ul>
      {row.previousDate && (
        <>
          <p className="mt-2 mb-1 font-bold text-muted-foreground">
            {t("compare.previousDay", { date: fmtDateShort(row.previousDate) })}
          </p>
          <ul className="flex flex-col gap-0.5">
            {series.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-4 tabular-nums">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Swatch color={PREVIOUS_COLOR} dashed />
                  {s.label}
                </span>
                <span className="font-semibold">{value(row[`${s.key}:previous`], s)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </TooltipBox>
  );
}

const AXIS = { tickLine: false, axisLine: false } as const;

/**
 * Daily series over a window on one or two y axes, with the period before drawn dashed underneath when `previous` is
 * given (same length, aligned by day). `summary` is the text alternative of the chart.
 */
export function DayChart({
  rows,
  previous,
  series,
  summary,
  height = 220,
  domain,
  referenceY,
}: {
  rows: readonly DayPoint[];
  previous?: readonly DayPoint[];
  series: readonly DaySeries[];
  summary: string;
  height?: number;
  /** Fixed y domain of the left axis (a score on a known scale); otherwise fitted to the data. */
  domain?: [number | "auto", number | "auto"];
  /** A dashed horizontal line (an average or a need); name it in the legend, not on the chart. */
  referenceY?: number;
}) {
  const data = mergeRows(rows, previous, series);
  const sparse = rows.length <= 31;
  const right = series.some((s) => s.axis === "right");
  const onAxis = (axis: "left" | "right") => series.filter((s) => (s.axis ?? "left") === axis);
  // Bars start at zero, or their height lies about the value; a score on a known scale gets its own domain.
  const domainOf = (axis: "left" | "right"): [number | "auto", number | "auto"] =>
    axis === "left" && domain
      ? domain
      : onAxis(axis).some((s) => s.kind === "bar")
        ? [0, "auto"]
        : ["auto", "auto"];
  const tick = (axis: "left" | "right") => (v: number) =>
    fmtDecimal(v, Number.isInteger(v) || (onAxis(axis)[0]?.digits ?? 0) === 0 ? 0 : 1);
  const gradient = (key: string) => `grad-${key}`;
  return (
    <div role="img" aria-label={summary} className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={data} margin={{ top: 8, right: right ? 0 : 8, bottom: 0, left: 0 }}>
          <defs>
            {series
              .filter((s) => s.kind === "area")
              .map((s) => (
                <linearGradient key={s.key} id={gradient(s.key)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey="date"
            {...AXIS}
            tickFormatter={(date: string) => fmtDateShort(date)}
            interval="preserveStartEnd"
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            yAxisId="left"
            {...AXIS}
            width={36}
            domain={domainOf("left")}
            tickFormatter={tick("left")}
          />
          {right && (
            <YAxis
              yAxisId="right"
              orientation="right"
              {...AXIS}
              width={36}
              domain={domainOf("right")}
              tickFormatter={tick("right")}
            />
          )}
          {referenceY !== undefined && (
            <ReferenceLine
              yAxisId="left"
              y={referenceY}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
            />
          )}
          <Tooltip
            content={<DayTooltip series={series} />}
            cursor={{ stroke: "var(--border)" }}
            isAnimationActive={false}
          />
          {previous &&
            series
              .filter((s) => s.kind === "bar")
              .map((s) => (
                <Bar
                  key={`${s.key}:previous`}
                  yAxisId={s.axis ?? "left"}
                  dataKey={`${s.key}:previous`}
                  fill={PREVIOUS_COLOR}
                  fillOpacity={0.35}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
              ))}
          {previous &&
            series
              .filter((s) => s.kind !== "bar")
              .map((s) => (
                <Line
                  key={`${s.key}:previous`}
                  yAxisId={s.axis ?? "left"}
                  dataKey={`${s.key}:previous`}
                  stroke={PREVIOUS_COLOR}
                  strokeOpacity={0.7}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                  legendType="none"
                />
              ))}
          {series.map((s) => {
            const yAxisId = s.axis ?? "left";
            if (s.kind === "bar") {
              return (
                <Bar
                  key={s.key}
                  yAxisId={yAxisId}
                  dataKey={s.key}
                  fill={s.color}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
              );
            }
            if (s.kind === "area") {
              return (
                <Area
                  key={s.key}
                  yAxisId={yAxisId}
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#${gradient(s.key)})`}
                  dot={sparse ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            }
            return (
              <Line
                key={s.key}
                yAxisId={yAxisId}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={sparse ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Colored key under a chart: what each color or line means. */
export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
  block?: boolean;
  bar?: boolean;
}

/** Legend entries of a chart's series: a line for lines and areas, a block for bars. */
export function legendOf(series: readonly DaySeries[]): LegendItem[] {
  return series.map((s) => ({ label: s.label, color: s.color, bar: s.kind === "bar" }));
}

export function Legend({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <ul
      className={cn("mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} dashed={item.dashed} block={item.block} bar={item.bar} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function VolumeTooltip({
  active,
  payload,
  unit,
  labels,
  digits,
}: {
  active?: boolean;
  payload?: readonly { payload?: VolumeRow }[];
  unit: string;
  labels: Record<SportKind, string>;
  digits: number;
}) {
  const { t } = useTranslation("fitWebOverview");
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const parts = SPORT_KINDS.filter((kind) => row[kind] > 0);
  const total = parts.reduce((sum, kind) => sum + row[kind], 0);
  return (
    <TooltipBox>
      <p className="mb-1 font-bold">{t("volume.week", { date: fmtDateShort(row.weekStart) })}</p>
      <ul className="flex flex-col gap-0.5">
        {parts.map((kind) => (
          <li key={kind} className="flex items-center justify-between gap-4 tabular-nums">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                aria-hidden
                className="size-2 rounded-sm"
                style={{ background: SPORT_COLOR[kind] }}
              />
              {labels[kind]}
            </span>
            <span className="font-semibold">{`${fmtDecimal(row[kind], digits)} ${unit}`}</span>
          </li>
        ))}
        {parts.length === 0 && <li className="text-muted-foreground">{t("volume.none")}</li>}
        {parts.length > 1 && (
          <li className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1 font-bold tabular-nums">
            <span>{t("volume.total")}</span>
            <span>{`${fmtDecimal(total, digits)} ${unit}`}</span>
          </li>
        )}
      </ul>
    </TooltipBox>
  );
}

/** Weekly volume stacked by sport kind. */
export function VolumeChart({
  rows,
  unit,
  digits,
  labels,
  summary,
  height = 240,
}: {
  rows: readonly VolumeRow[];
  unit: string;
  digits: number;
  labels: Record<SportKind, string>;
  summary: string;
  height?: number;
}) {
  const kinds = SPORT_KINDS.filter((kind) => rows.some((row) => row[kind] > 0));
  return (
    <div role="img" aria-label={summary} className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart
          data={rows.map((row) => ({ ...row }))}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey="weekStart"
            {...AXIS}
            tickFormatter={(date: string) => fmtDateShort(date)}
            interval="preserveStartEnd"
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis {...AXIS} width={36} tickFormatter={(v: number) => fmtDecimal(v, 0)} />
          <Tooltip
            content={<VolumeTooltip unit={unit} labels={labels} digits={digits} />}
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            isAnimationActive={false}
          />
          {kinds.map((kind, index) => (
            <Bar
              key={kind}
              dataKey={kind}
              stackId="volume"
              fill={SPORT_COLOR[kind]}
              maxBarSize={28}
              radius={index === kinds.length - 1 ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A tiny trend line with no axes, for a stat tile. Gaps break the line. */
export function Sparkline({
  values,
  color,
  className,
}: {
  values: readonly (number | null)[];
  color: string;
  className?: string;
}) {
  const finite = values.filter((v): v is number => v !== null);
  if (finite.length < 2) return <div className={cn("h-8", className)} aria-hidden />;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || 1;
  const W = 100;
  const H = 28;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = values.length === 1 ? 0 : (i / (values.length - 1)) * W;
    const y = H - 3 - ((v - lo) / span) * (H - 6);
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full overflow-visible", className)}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
