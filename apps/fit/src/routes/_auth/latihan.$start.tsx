import type { WatchWorkoutListItem } from "@joyorogo/api/lib/watch-workout-store";
import type { LatLon, SportKind, WorkoutAnalysis } from "@joyorogo/api/lib/workout-analysis";
import { formatPace } from "@joyorogo/api/lib/workout-analysis";
import { fmtDecimal } from "@joyorogo/i18n";
import { useTheme } from "@joyorogo/ui/hooks/use-theme";
import { paceMode } from "@joyorogo/workout-view/analysis-math";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, FileUp } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, IconChip, Stat } from "@/components/kit";
import { ExportWorkout } from "@/components/connect/export-workout";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import { ComparisonCard, BestEffortsCard, EffortCard } from "@/components/workout/performance";
import { LapsCard, SplitsCard } from "@/components/workout/tables";
import { WorkoutCharts } from "@/components/workout/workout-charts";
import { HrZonesCard, PaceZonesCard } from "@/components/workout/zones";
import { fmtHm, fmtKm, fmtPaceOrSpeed, fmtStart } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { orpc } from "@/lib/orpc";
import { sportIcon } from "@/lib/sport";
import { sportKindOf } from "@/lib/aggregate";

const loadRouteMap = () => import("@joyorogo/workout-view/route-map");
const RouteMap = lazy(loadRouteMap);

export const Route = createFileRoute("/_auth/latihan/$start")({
  component: WorkoutDetailPage,
  // The workout and, once we know it has GPS, the map chunk start loading together with the page chunk (and on hover).
  loader: ({ context, params }) => {
    const start = Number(params.start);
    if (!Number.isInteger(start) || start <= 0) return;
    void context.queryClient
      .prefetchQuery(orpc.watchWorkout.detail.queryOptions({ input: { start } }))
      .then(() => {
        const detail = context.queryClient.getQueryData(
          orpc.watchWorkout.detail.queryKey({ input: { start } }),
        );
        if (detail?.item.hasGps) void loadRouteMap();
      });
  },
});

function BackLink() {
  const { t } = useTranslation("fitWebWorkouts");
  return (
    <Link
      to="/latihan"
      className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-full text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t("detail.back")}
    </Link>
  );
}

function WorkoutDetailPage() {
  const { t } = useTranslation("fitWebWorkouts");
  const { start: raw } = Route.useParams();
  const start = Number(raw);
  const valid = Number.isInteger(start) && start > 0;
  const detail = useQuery({
    ...orpc.watchWorkout.detail.queryOptions({ input: { start } }),
    enabled: valid,
  });
  usePageTitle(detail.data?.item.sportName ?? t("title"));

  if (!valid || (detail.error instanceof ORPCError && detail.error.code === "NOT_FOUND")) {
    return (
      <>
        <BackLink />
        <Card>
          <EmptyState title={t("detail.notFoundTitle")}>{t("detail.notFoundBody")}</EmptyState>
        </Card>
      </>
    );
  }
  if (detail.error) {
    return (
      <>
        <BackLink />
        <Card>
          <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      </>
    );
  }
  if (!detail.data) {
    return (
      <>
        <BackLink />
        <BlockSkeleton className="h-20" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <BlockSkeleton key={i} className="h-28" />
          ))}
        </div>
        <BlockSkeleton className="mt-4 h-96" />
      </>
    );
  }

  const { item, analysis } = detail.data;
  const kind: SportKind = analysis?.sport.kind ?? sportKindOf(item.sportKind);
  const Icon = sportIcon(item.sportName, item.sportKind);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink />
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <IconChip className="size-12 bg-primary/10 text-primary">
            <Icon className="size-6" aria-hidden />
          </IconChip>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl leading-tight font-extrabold tracking-tight sm:text-[1.75rem]">
              {item.sportName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {fmtStart(item.start)}
              {item.imported && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                  <FileUp className="size-3" aria-hidden />
                  {t("detail.imported")}
                </span>
              )}
            </p>
          </div>
          <ExportWorkout start={item.start} hasGps={item.hasGps} />
        </header>
      </div>
      {analysis ? <Analysis analysis={analysis} kind={kind} /> : <Basic item={item} />}
    </div>
  );
}

/** A workout stored without its analysis (or by a newer engine than this server reads): the list numbers are still right. */
function Basic({ item }: { item: WatchWorkoutListItem }) {
  const { t } = useTranslation("fitWebWorkouts");
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("detail.distance")} value={item.distanceM ? fmtKm(item.distanceM) : "–"} />
        <Stat
          label={t("detail.movingTime")}
          value={fmtHm(item.movingSec)}
          hint={t("detail.elapsed", { time: fmtHm(item.elapsedSec) })}
        />
        <Stat
          label={t("detail.avgHr")}
          value={item.avgHr ?? "–"}
          unit={item.avgHr ? "bpm" : undefined}
          hint={item.maxHr ? t("detail.maxHr", { value: item.maxHr }) : undefined}
        />
        <Stat
          label={t("detail.calories")}
          value={item.calories > 0 ? fmtDecimal(item.calories, 0) : "–"}
          unit={item.calories > 0 ? "kcal" : undefined}
        />
      </div>
      <Card>
        <EmptyState title={t("detail.noAnalysisTitle")}>{t("detail.noAnalysisBody")}</EmptyState>
      </Card>
    </>
  );
}

function Analysis({ analysis, kind }: { analysis: WorkoutAnalysis; kind: SportKind }) {
  const { t } = useTranslation("fitWebWorkouts");
  const { resolvedTheme } = useTheme();
  const [scrub, setScrub] = useState<number | null>(null);
  const { series, stats } = analysis;
  const track: (LatLon | null)[] | null = series?.track?.some((p) => p !== null)
    ? series.track
    : null;
  const mode = paceMode(kind);
  const cadUnit = t(kind === "ride" ? "unit.rpm" : "unit.spm");
  const hasCharts =
    series !== null && (series.hr || series.pace || series.alt || series.cad || series.power);

  const pace = stats.avgPaceSecKm;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-8">
        <Stat
          label={t("detail.distance")}
          value={analysis.distanceM ? fmtKm(analysis.distanceM) : "–"}
        />
        <Stat
          label={t("detail.movingTime")}
          value={fmtHm(analysis.movingSec)}
          hint={t("detail.elapsed", { time: fmtHm(analysis.elapsedSec) })}
        />
        {mode && (
          <Stat
            label={mode === "speed" ? t("detail.avgSpeed") : t("detail.avgPace")}
            value={fmtPaceOrSpeed(kind, pace)}
            unit={mode === "speed" ? t("unit.kmh") : t("unit.perKm")}
            hint={
              stats.bestPaceSecKm
                ? t("detail.best", {
                    value:
                      mode === "speed"
                        ? `${fmtDecimal(3600 / stats.bestPaceSecKm, 1)} ${t("unit.kmh")}`
                        : `${formatPace(stats.bestPaceSecKm)} ${t("unit.perKm")}`,
                  })
                : undefined
            }
          />
        )}
        <Stat
          label={t("detail.avgHr")}
          value={stats.avgHr ?? "–"}
          unit={stats.avgHr ? "bpm" : undefined}
          hint={stats.maxHr ? t("detail.maxHr", { value: stats.maxHr }) : undefined}
        />
        {stats.avgCad !== null && (
          <Stat
            label={t("detail.avgCadence")}
            value={fmtDecimal(stats.avgCad, 0)}
            unit={cadUnit}
            hint={
              stats.maxCad !== null
                ? t("detail.maxCadence", { value: fmtDecimal(stats.maxCad, 0), unit: cadUnit })
                : undefined
            }
          />
        )}
        {mode === "pace" && stats.avgStrideM !== null && (
          <Stat
            label={t("detail.stepLength")}
            value={fmtDecimal(stats.avgStrideM, 2)}
            unit="m"
          />
        )}
        <Stat
          label={t("detail.elevation")}
          value={analysis.elevation ? `+${fmtDecimal(analysis.elevation.gainM, 0)}` : "–"}
          unit={analysis.elevation ? "m" : undefined}
          hint={
            analysis.elevation
              ? t("detail.elevationLoss", { value: fmtDecimal(analysis.elevation.lossM, 0) })
              : undefined
          }
        />
        <Stat
          label={t("detail.calories")}
          value={analysis.calories ? fmtDecimal(analysis.calories.kcal, 0) : "–"}
          unit={analysis.calories ? "kcal" : undefined}
        />
        <Stat
          label={t("detail.strain")}
          value={analysis.effort ? fmtDecimal(analysis.effort.strain, 1) : "–"}
          unit={analysis.effort ? "/21" : undefined}
          hint={analysis.effort ? t(`effort.band.${analysis.effort.band}`) : undefined}
        />
        <Stat
          label={t("detail.loadRatio")}
          value={analysis.load?.ratio != null ? fmtDecimal(analysis.load.ratio, 2) : "–"}
          hint={
            analysis.load
              ? t("detail.trimp", { value: fmtDecimal(analysis.load.trimp, 0) })
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {track && (
            <Card className="overflow-hidden p-0">
              <Suspense fallback={<BlockSkeleton className="h-80 rounded-none lg:h-[26rem]" />}>
                <RouteMap
                  track={track}
                  series={series}
                  scrubIndex={scrub}
                  onScrub={setScrub}
                  theme={resolvedTheme}
                  className="h-80 lg:h-[26rem]"
                />
              </Suspense>
            </Card>
          )}
          {series && hasCharts && (
            <Card>
              <CardHeader title={t("charts.title")} />
              <WorkoutCharts
                series={series}
                kind={kind}
                hrZones={analysis.hrZones}
                scrubIndex={scrub}
                onScrub={setScrub}
              />
            </Card>
          )}
          {!track && !hasCharts && (
            <Card>
              <EmptyState title={t("detail.noSeriesTitle")}>{t("detail.noSeriesBody")}</EmptyState>
            </Card>
          )}
          <SplitsCard splits={analysis.splits} kind={kind} />
          <LapsCard laps={analysis.laps} kind={kind} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {analysis.hrZones && <HrZonesCard zones={analysis.hrZones} />}
          {analysis.paceZones && <PaceZonesCard zones={analysis.paceZones} />}
          <EffortCard effort={analysis.effort} load={analysis.load} />
          <BestEffortsCard efforts={analysis.bestEfforts} />
          {analysis.comparison && (
            <ComparisonCard comparison={analysis.comparison} analysis={analysis} />
          )}
        </div>
      </div>
    </>
  );
}
