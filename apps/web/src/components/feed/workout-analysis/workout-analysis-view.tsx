import type { AnalysisSeries, LatLon, WorkoutAnalysis } from "@joyorogo/api/lib/workout-analysis";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, SectionTitle } from "@/components/kit/surface";
import { useTheme } from "@/components/theme-provider";

import { ChartsCard } from "./charts-card";
import { BestEffortsCard, ComparisonCard, EffortCard, LoadCard } from "./performance-cards";
import { CaloriesCard, SummaryCard } from "./summary-card";
import { LapsCard, SplitsCard } from "./tables";
import { HrZonesCard, PaceZonesCard } from "./zones-cards";

const RouteMap = lazy(() => import("./route-map"));

function MapCard({
  track,
  series,
  scrubIndex,
  onScrub,
  title,
}: {
  track: (LatLon | null)[];
  series: AnalysisSeries | null;
  scrubIndex: number | null;
  onScrub?: (index: number | null) => void;
  title?: string;
}) {
  const { resolvedTheme } = useTheme();
  const height = "h-72 md:h-96";
  return (
    <Card className="overflow-hidden p-0">
      {title && <SectionTitle className="px-5 pt-4">{title}</SectionTitle>}
      <Suspense fallback={<div className={`${height} animate-pulse bg-muted`} />}>
        <RouteMap
          track={track}
          series={series}
          scrubIndex={scrubIndex}
          onScrub={onScrub}
          theme={resolvedTheme}
          className={height}
        />
      </Suspense>
    </Card>
  );
}

/** Strava-style analysis of one workout. `scrubIndex` is shared by the map and the chart. */
export function WorkoutAnalysisView({ analysis }: { analysis: WorkoutAnalysis }) {
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const { series } = analysis;
  const kind = analysis.sport.kind;
  const track = series?.track?.some((p) => p !== null) ? series.track : null;

  return (
    <div className="mt-4 space-y-4">
      <SummaryCard analysis={analysis} />
      {series && track && (
        <MapCard track={track} series={series} scrubIndex={scrubIndex} onScrub={setScrubIndex} />
      )}
      {series && (
        <ChartsCard
          series={series}
          kind={kind}
          hrZones={analysis.hrZones}
          scrubIndex={scrubIndex}
          onScrub={setScrubIndex}
        />
      )}
      <SplitsCard splits={analysis.splits} kind={kind} />
      {analysis.hrZones && <HrZonesCard zones={analysis.hrZones} />}
      {analysis.paceZones && <PaceZonesCard zones={analysis.paceZones} />}
      <BestEffortsCard efforts={analysis.bestEfforts} />
      {analysis.effort && <EffortCard effort={analysis.effort} />}
      {analysis.load && <LoadCard load={analysis.load} />}
      <LapsCard laps={analysis.laps} kind={kind} />
      <CaloriesCard analysis={analysis} />
      {analysis.comparison && (
        <ComparisonCard comparison={analysis.comparison} analysis={analysis} />
      )}
    </div>
  );
}

/** Posts from older JoyoFit builds: a heart-rate chart and a route map, no shared scrubber. */
export function BasicWorkoutView({
  hr,
  route,
}: {
  hr: { intervalSec: number; bpm: (number | null)[] } | null;
  route: [number, number][] | null;
}) {
  const { t } = useTranslation("feed");
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const hrSeries = useMemo<AnalysisSeries | null>(
    () =>
      hr && hr.bpm.length > 1 && hr.bpm.some((v) => v !== null)
        ? {
            stepSec: hr.intervalSec,
            n: hr.bpm.length,
            dist: null,
            hr: hr.bpm,
            pace: null,
            alt: null,
            cad: null,
            power: null,
            track: null,
          }
        : null,
    [hr],
  );
  const track = useMemo(() => (route && route.length > 1 ? (route as LatLon[]) : null), [route]);

  return (
    <div className="mt-4 space-y-4">
      {hrSeries && (
        <ChartsCard
          series={hrSeries}
          kind="other"
          hrZones={null}
          scrubIndex={scrubIndex}
          onScrub={setScrubIndex}
          title={t("watch.hrTitle")}
        />
      )}
      {track && (
        <MapCard track={track} series={null} scrubIndex={null} title={t("watch.routeTitle")} />
      )}
    </div>
  );
}
