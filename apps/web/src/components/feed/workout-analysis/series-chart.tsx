import {
  type AnalysisHrZones,
  type AnalysisSeries,
  type SportKind,
  axisValue,
  formatPace,
  indexAtAxis,
} from "@joyorogo/api/lib/workout-analysis";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import {
  type ChartMetric,
  areaPath,
  axisTicks,
  linePath,
  metricValues,
  niceTicks,
  paceMode,
  valueDomain,
} from "./analysis-math";

const HEIGHT = 188;
const PAD = { top: 10, right: 38, bottom: 24, left: 6 };

/** Heart-rate zone colours, Z1 to Z5; shared with the zones card. */
export const ZONE_COLORS = ["#7fa7d4", "#45a86a", "#e3b92c", "#ee8431", "#e5484d"] as const;

const METRIC_COLOR: Record<ChartMetric, string> = {
  pace: "var(--primary)",
  hr: "#e5484d",
  alt: "var(--muted-foreground)",
  cad: "var(--tidur)",
  power: "var(--bakar)",
};

/** Width of the element in CSS pixels, kept current while it resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function tickLabel(metric: ChartMetric, kind: SportKind, value: number): string {
  if (metric === "pace") {
    return paceMode(kind) === "speed" ? String(Math.round(value)) : formatPace(value);
  }
  return String(Math.round(value));
}

/**
 * One metric over the shared axis as hand-written SVG, with the common scrubber: pointer drag
 * (touch keeps vertical page scroll), arrow keys, and a crosshair that follows `scrubIndex`.
 */
export function SeriesChart({
  series,
  metric,
  kind,
  scrubIndex,
  onScrub,
  hrZones,
  label,
  unit,
  axisUnit,
}: {
  series: AnalysisSeries;
  metric: ChartMetric;
  kind: SportKind;
  scrubIndex: number | null;
  onScrub: (index: number | null) => void;
  hrZones: AnalysisHrZones | null;
  /** Accessible description of the chart. */
  label: string;
  /** Unit shown with the y axis. */
  unit: string;
  /** Unit of the x axis, e.g. `km` or `min`. */
  axisUnit: string;
}) {
  const { ref, width } = useWidth();
  const gradientId = `hr${useId().replace(/:/g, "")}`;
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const { n } = series;

  const x0 = axisValue(series, 0);
  const span = Math.max(axisValue(series, n - 1) - x0, 1e-9);
  const xAt = (i: number) => PAD.left + ((axisValue(series, i) - x0) / span) * plotW;

  const values = metricValues(series, metric, kind);
  const [lo, hi] = valueDomain(values, metric);
  const inverted = metric === "pace" && paceMode(kind) === "pace";
  const yAt = (v: number) => {
    const clamped = Math.min(hi, Math.max(lo, v));
    const f = (clamped - lo) / (hi - lo);
    return PAD.top + (inverted ? f : 1 - f) * plotH;
  };
  const points = values.map((v, i) => (v === null ? null : { x: xAt(i), y: yAt(v) }));
  const line = linePath(points);
  const baseY = PAD.top + plotH;
  const filled = metric === "alt" ? areaPath(points, baseY) : "";

  // A faint elevation profile under pace and speed, the way Strava draws it.
  const backdropValues = metric === "pace" && series.alt ? series.alt : null;
  const backdrop = (() => {
    if (!backdropValues) return "";
    const [aLo, aHi] = valueDomain(backdropValues, "alt");
    const pts = backdropValues.map((v, i) =>
      v === null ? null : { x: xAt(i), y: baseY - ((v - aLo) / (aHi - aLo)) * plotH * 0.42 },
    );
    return areaPath(pts, baseY);
  })();

  const yTicks = niceTicks(lo, hi, 3);
  const xTicks = axisTicks(series, Math.max(2, Math.floor(plotW / 55)));

  const scrubValue = scrubIndex !== null ? (values[scrubIndex] ?? null) : null;
  const scrubX = scrubIndex !== null ? xAt(scrubIndex) : null;

  const indexFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = Math.min(Math.max(event.clientX - rect.left - PAD.left, 0), plotW);
    return indexAtAxis(series, x0 + (px / plotW) * span);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const jump = Math.max(1, Math.round(n / 50));
    const at = scrubIndex ?? 0;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(n - 1, at + (event.shiftKey ? jump * 5 : jump));
    else if (event.key === "ArrowLeft") next = Math.max(0, at - (event.shiftKey ? jump * 5 : jump));
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else if (event.key === "Escape") next = null;
    else return;
    event.preventDefault();
    onScrub(next);
  };

  const color = METRIC_COLOR[metric];
  const zoneStops =
    metric === "hr" && hrZones && hrZones.bounds.length === 6
      ? hrZones.bounds.slice(0, 5).map((bound, z) => ({ bound, color: ZONE_COLORS[z]! }))
      : null;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block cursor-crosshair select-none"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(event) => onScrub(indexFromEvent(event))}
          onPointerMove={(event) => onScrub(indexFromEvent(event))}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") onScrub(null);
          }}
        >
          {zoneStops && (
            <defs>
              <linearGradient
                id={gradientId}
                gradientUnits="userSpaceOnUse"
                x1="0"
                x2="0"
                y1={PAD.top}
                y2={baseY}
              >
                <stop offset={0} stopColor={zoneStops[zoneStops.length - 1]!.color} />
                {[...zoneStops].reverse().flatMap((stop, i, all) => {
                  const offset = Math.min(1, Math.max(0, (yAt(stop.bound) - PAD.top) / plotH));
                  const below = all[i + 1]?.color ?? stop.color;
                  return [
                    <stop key={`${stop.bound}a`} offset={offset} stopColor={stop.color} />,
                    <stop key={`${stop.bound}b`} offset={offset} stopColor={below} />,
                  ];
                })}
              </linearGradient>
            </defs>
          )}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.left + plotW + 6}
                y={yAt(tick)}
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {tickLabel(metric, kind, tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text
              key={tick.x}
              x={PAD.left + ((tick.x - x0) / span) * plotW}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {tick.label}
            </text>
          ))}
          <text
            x={PAD.left + plotW + 6}
            y={HEIGHT - 6}
            className="fill-muted-foreground text-[10px]"
            textAnchor="start"
          >
            {axisUnit}
          </text>
          <text x={PAD.left + 2} y={PAD.top + 9} className="fill-muted-foreground text-[10px]">
            {unit}
          </text>
          {backdrop && <path d={backdrop} className="fill-muted-foreground/15" />}
          {filled && <path d={filled} fill={color} fillOpacity={0.22} />}
          <path
            d={line}
            fill="none"
            stroke={zoneStops ? `url(#${gradientId})` : color}
            strokeWidth={metric === "alt" ? 1.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {scrubX !== null && (
            <g pointerEvents="none">
              <line
                x1={scrubX}
                x2={scrubX}
                y1={PAD.top}
                y2={baseY}
                stroke="var(--foreground)"
                strokeOpacity={0.55}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {scrubValue !== null && (
                <circle
                  cx={scrubX}
                  cy={yAt(scrubValue)}
                  r={4.5}
                  fill={color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
