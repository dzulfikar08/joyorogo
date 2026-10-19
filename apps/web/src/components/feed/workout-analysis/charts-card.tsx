import {
  type AnalysisHrZones,
  type AnalysisSeries,
  type SportKind,
  formatDistance,
  formatDuration,
  formatPace,
} from "@joyorogo/api/lib/workout-analysis";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, Segmented } from "@/components/kit/surface";

import {
  type ChartMetric,
  availableMetrics,
  formatPaceOrSpeed,
  metricValues,
  paceMode,
} from "@joyorogo/workout-view/analysis-math";
import { SeriesChart } from "./series-chart";

function ReadoutItem({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-bold tabular-nums">
        {value}
        {unit && (
          <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">{unit}</span>
        )}
      </dd>
    </div>
  );
}

/** Values of every metric at the scrubbed sample. */
function Readout({
  series,
  kind,
  index,
}: {
  series: AnalysisSeries;
  kind: SportKind;
  index: number | null;
}) {
  const { t } = useTranslation("feed");
  if (index === null) {
    return (
      <p className="flex min-h-[3.25rem] items-center text-xs text-muted-foreground">
        {t("analysis.chart.hint")}
      </p>
    );
  }
  const mode = paceMode(kind);
  const pace = series.pace?.[index] ?? null;
  const hr = series.hr?.[index] ?? null;
  const alt = series.alt?.[index] ?? null;
  const cad = series.cad?.[index] ?? null;
  const power = series.power?.[index] ?? null;
  const cadUnit = kind === "ride" ? "rpm" : "spm";
  return (
    <dl className="grid min-h-[3.25rem] grid-cols-4 gap-x-3 gap-y-1.5">
      {series.dist && (
        <ReadoutItem
          label={t("analysis.chart.distance")}
          value={formatDistance(series.dist[index] ?? 0)}
        />
      )}
      <ReadoutItem
        label={t("analysis.chart.time")}
        value={formatDuration(index * series.stepSec)}
      />
      {mode && series.pace && (
        <ReadoutItem
          label={mode === "speed" ? t("analysis.speed") : t("analysis.pace")}
          value={formatPaceOrSpeed(kind, pace)}
          unit={mode === "speed" ? "km/h" : "/km"}
        />
      )}
      {series.hr && (
        <ReadoutItem
          label={t("analysis.hr")}
          value={hr === null ? "--" : String(Math.round(hr))}
          unit="bpm"
        />
      )}
      {series.alt && (
        <ReadoutItem
          label={t("analysis.elevation")}
          value={alt === null ? "--" : String(Math.round(alt))}
          unit="m"
        />
      )}
      {series.cad && (
        <ReadoutItem
          label={t("analysis.cadence")}
          value={cad === null ? "--" : String(Math.round(cad))}
          unit={cadUnit}
        />
      )}
      {series.power && (
        <ReadoutItem
          label={t("analysis.power")}
          value={power === null ? "--" : String(Math.round(power))}
          unit="W"
        />
      )}
    </dl>
  );
}

/** Metric toggle, readout and one chart; the scrubber is owned by the parent so the map shares it. */
export function ChartsCard({
  series,
  kind,
  hrZones,
  scrubIndex,
  onScrub,
  title,
}: {
  series: AnalysisSeries;
  kind: SportKind;
  hrZones: AnalysisHrZones | null;
  scrubIndex: number | null;
  onScrub: (index: number | null) => void;
  title?: string;
}) {
  const { t } = useTranslation("feed");
  const metrics = availableMetrics(series, kind);
  const [picked, setPicked] = useState<ChartMetric | null>(null);
  const metric = picked && metrics.includes(picked) ? picked : metrics[0];
  if (!metric || series.n < 2) return null;

  const names: Record<ChartMetric, string> = {
    pace: paceMode(kind) === "speed" ? t("analysis.speed") : t("analysis.pace"),
    hr: t("analysis.hr"),
    alt: t("analysis.elevation"),
    cad: t("analysis.cadence"),
    power: t("analysis.power"),
  };
  const units: Record<ChartMetric, string> = {
    pace: paceMode(kind) === "speed" ? "km/h" : "min/km",
    hr: "bpm",
    alt: "m",
    cad: kind === "ride" ? "rpm" : "spm",
    power: "W",
  };
  const present = metricValues(series, metric, kind).filter((v): v is number => v !== null);
  const show = (v: number) =>
    metric === "pace" && paceMode(kind) === "pace" ? formatPace(v) : String(Math.round(v));
  const from = present.length ? show(Math.min(...present)) : "--";
  const to = present.length ? show(Math.max(...present)) : "--";

  return (
    <Card className="p-4">
      {title && <h2 className="mb-3 px-1 text-base font-bold tracking-tight">{title}</h2>}
      {metrics.length > 1 && (
        <Segmented
          label={t("analysis.chart.metric")}
          value={metric}
          onChange={setPicked}
          options={metrics.map((m) => ({ value: m, label: names[m] }))}
          className="mb-3"
        />
      )}
      <div aria-live="polite" className="mb-1 px-1">
        <Readout series={series} kind={kind} index={scrubIndex} />
      </div>
      <SeriesChart
        series={series}
        metric={metric}
        kind={kind}
        scrubIndex={scrubIndex}
        onScrub={onScrub}
        hrZones={hrZones}
        unit={units[metric]}
        axisUnit={series.dist ? "km" : "min"}
        label={t("analysis.chart.aria", { metric: names[metric], from, to, unit: units[metric] })}
      />
    </Card>
  );
}
