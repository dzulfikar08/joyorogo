import {
  type AnalysisBestEffort,
  type AnalysisComparison,
  type AnalysisEffort,
  type AnalysisLoad,
  type SportKind,
  type WorkoutAnalysis,
  formatDistance,
  formatDuration,
  formatPace,
} from "@joyorogo/api/lib/workout-analysis";
import { cn } from "@joyorogo/ui/lib/utils";
import { Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Ring } from "@/components/kit/ring";
import { Card, SectionTitle } from "@/components/kit/surface";

import {
  comparisonDeltas,
  effortPace,
  formatPaceOrSpeed,
  loadWording,
  paceMode,
  speedKmh,
} from "@joyorogo/workout-view/analysis-math";

/** Fastest stretches of 400 m to a half marathon, with a PR badge against recent similar workouts. */
export function BestEffortsCard({ efforts }: { efforts: AnalysisBestEffort[] }) {
  const { t } = useTranslation("feed");
  if (efforts.length === 0) return null;
  return (
    <Card className="p-4">
      <SectionTitle>{t("analysis.efforts.title")}</SectionTitle>
      <ul className="divide-y divide-border">
        {efforts.map((effort) => (
          <li key={effort.key} className="flex items-center gap-3 px-1 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t(`analysis.efforts.names.${effort.key}`)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("analysis.efforts.pace", {
                  pace: formatPace(effortPace(effort.key, effort.sec)),
                })}
                {" · "}
                {t("analysis.efforts.at", { distance: formatDistance(effort.atM) })}
              </p>
            </div>
            {effort.rank === 1 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-bakar-soft px-2 py-0.5 text-xs font-bold text-bakar-ink">
                <Trophy className="size-3" aria-hidden />
                {t("analysis.efforts.pr")}
              </span>
            )}
            {effort.rank !== null && effort.rank >= 2 && effort.rank <= 3 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {t(effort.rank === 2 ? "analysis.efforts.second" : "analysis.efforts.third")}
              </span>
            )}
            <p className="w-16 shrink-0 text-right text-base font-bold tabular-nums">
              {formatDuration(effort.sec)}
            </p>
          </li>
        ))}
      </ul>
      {efforts.some((e) => e.rank !== null) && (
        <p className="mt-2 px-1 text-xs text-muted-foreground">{t("analysis.efforts.note")}</p>
      )}
    </Card>
  );
}

/** Relative effort: strain 0 to 21 from time in heart-rate zones. */
export function EffortCard({ effort }: { effort: AnalysisEffort }) {
  const { t } = useTranslation("feed");
  return (
    <Card className="p-4">
      <SectionTitle>{t("analysis.effort.title")}</SectionTitle>
      <div className="flex items-center gap-4 px-1">
        <Ring
          value={effort.strain}
          max={21}
          metric="bakar"
          size={104}
          stroke={11}
          label={t("analysis.effort.aria", { strain: effort.strain.toFixed(1) })}
        >
          <div>
            <p className="text-2xl leading-none font-extrabold tabular-nums">
              {effort.strain.toFixed(1)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{t("analysis.effort.outOf")}</p>
          </div>
        </Ring>
        <div className="min-w-0">
          <p className="text-lg font-extrabold">{t(`analysis.effort.band.${effort.band}`)}</p>
          {effort.addedToDay !== null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("analysis.effort.addedToDay", { value: effort.addedToDay.toFixed(1) })}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">{t("analysis.effort.explain")}</p>
        </div>
      </div>
    </Card>
  );
}

const WORDING_TONE = {
  under: "bg-muted text-muted-foreground",
  steady: "bg-makan-soft text-makan-ink",
  high: "bg-bakar-soft text-bakar-ink",
  spike: "bg-destructive/15 text-destructive",
} as const;

function LoadBar({
  label,
  value,
  max,
  strong,
}: {
  label: string;
  value: number;
  max: number;
  strong?: boolean;
}) {
  return (
    <div className="px-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular-nums">{Math.round(value)}</span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", strong ? "bg-bakar" : "bg-bakar/40")}
          style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}

/** This workout's TRIMP, the last 7 days against the weekly average, and the watch's own numbers. */
export function LoadCard({ load }: { load: AnalysisLoad }) {
  const { t } = useTranslation("feed");
  const wording = load.ratio !== null ? loadWording(load.ratio) : null;
  const max = Math.max(load.acute, load.chronicWeekly) * 1.05;
  const watch = [
    load.aerobicEffect !== null
      ? { label: t("analysis.load.aerobic"), value: load.aerobicEffect.toFixed(1) }
      : null,
    load.anaerobicEffect !== null
      ? { label: t("analysis.load.anaerobic"), value: load.anaerobicEffect.toFixed(1) }
      : null,
    load.recoveryHours !== null
      ? {
          label: t("analysis.load.recovery"),
          value: t("analysis.load.hours", { hours: Math.round(load.recoveryHours) }),
        }
      : null,
    load.watchLoad !== null
      ? { label: t("analysis.load.watchLoad"), value: String(Math.round(load.watchLoad)) }
      : null,
  ].filter((item) => item !== null);

  return (
    <Card className="p-4">
      <SectionTitle
        action={
          wording && (
            <span
              className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", WORDING_TONE[wording])}
            >
              {t(`analysis.load.wording.${wording}`)}
            </span>
          )
        }
      >
        {t("analysis.load.title")}
      </SectionTitle>
      <p className="px-1 text-sm">
        <span className="text-muted-foreground">{t("analysis.load.thisWorkout")}</span>{" "}
        <span className="font-bold tabular-nums">{Math.round(load.trimp)}</span>{" "}
        <span className="text-xs text-muted-foreground">TRIMP</span>
      </p>
      <div className="mt-3 space-y-3">
        <LoadBar label={t("analysis.load.last7")} value={load.acute} max={max} strong />
        {load.chronicWeekly > 0 && (
          <LoadBar label={t("analysis.load.weeklyAvg")} value={load.chronicWeekly} max={max} />
        )}
      </div>
      <p className="mt-3 px-1 text-sm text-muted-foreground">
        {wording ? t(`analysis.load.explain.${wording}`) : t("analysis.load.noHistory")}
      </p>
      {watch.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border px-1 pt-3 min-[420px]:grid-cols-4">
          {watch.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
              <dd className="text-base font-bold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function Delta({ children, good }: { children: string; good: boolean | null }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        good === null ? "text-muted-foreground" : good ? "text-makan-ink" : "text-bakar-ink",
      )}
    >
      {children}
    </span>
  );
}

function DeltaTile({
  title,
  paceDelta,
  hrDelta,
  kind,
  currentPace,
}: {
  title: string;
  paceDelta: number | null;
  hrDelta: number | null;
  kind: SportKind;
  currentPace: number | null;
}) {
  const { t } = useTranslation("feed");
  let pace: { text: string; good: boolean | null } | null = null;
  if (paceDelta !== null && currentPace !== null) {
    if (paceMode(kind) === "speed") {
      const diff = speedKmh(currentPace) - speedKmh(currentPace - paceDelta);
      pace =
        Math.abs(diff) < 0.05
          ? { text: t("analysis.comparison.samePace"), good: null }
          : {
              text: t(
                diff > 0 ? "analysis.comparison.fasterKmh" : "analysis.comparison.slowerKmh",
                { value: Math.abs(diff).toFixed(1) },
              ),
              good: diff > 0,
            };
    } else {
      const secs = Math.round(Math.abs(paceDelta));
      pace =
        secs === 0
          ? { text: t("analysis.comparison.samePace"), good: null }
          : {
              text: t(paceDelta < 0 ? "analysis.comparison.faster" : "analysis.comparison.slower", {
                value: secs,
              }),
              good: paceDelta < 0,
            };
    }
  }
  const hr = hrDelta === null ? null : Math.round(hrDelta);
  return (
    <div className="min-w-0 rounded-2xl bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{title}</p>
      {pace && (
        <p className="text-sm">
          <Delta good={pace.good}>{pace.text}</Delta>
        </p>
      )}
      {hr !== null && (
        <p className="text-sm">
          <Delta good={null}>
            {hr === 0
              ? t("analysis.comparison.sameHr")
              : t("analysis.comparison.hrDelta", { value: `${hr > 0 ? "+" : "-"}${Math.abs(hr)}` })}
          </Delta>
        </p>
      )}
    </div>
  );
}

/** This workout against the previous similar ones. */
export function ComparisonCard({
  comparison,
  analysis,
}: {
  comparison: AnalysisComparison;
  analysis: WorkoutAnalysis;
}) {
  const { t, i18n } = useTranslation("feed");
  if (comparison.items.length === 0) return null;
  const kind = analysis.sport.kind;
  const current = {
    paceSecKm: analysis.stats.avgPaceSecKm,
    avgHr: analysis.stats.avgHr,
  };
  const { previous, average } = comparisonDeltas(current, comparison);
  const date = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });
  const showDist = analysis.distanceM !== null || comparison.items.some((i) => i.distM !== null);
  const showPace = paceMode(kind) !== null;
  const showHr = current.avgHr !== null || comparison.items.some((i) => i.avgHr !== null);

  const rows = [
    {
      key: "now",
      label: t("analysis.comparison.thisWorkout"),
      dist: analysis.distanceM,
      sec: analysis.elapsedSec,
      pace: current.paceSecKm,
      hr: current.avgHr,
      now: true,
    },
    ...comparison.items.map((item) => ({
      key: String(item.startedAt),
      label: date.format(item.startedAt),
      dist: item.distM,
      sec: item.sec,
      pace: item.paceSecKm,
      hr: item.avgHr,
      now: false,
    })),
  ];

  return (
    <Card className="p-4">
      <SectionTitle
        action={
          <span className="text-xs text-muted-foreground">
            {t(
              comparison.basis === "distance"
                ? "analysis.comparison.byDistance"
                : "analysis.comparison.byDuration",
            )}
          </span>
        }
      >
        {t("analysis.comparison.title")}
      </SectionTitle>
      {(previous || average) && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          {previous && (
            <DeltaTile
              title={t("analysis.comparison.vsPrevious")}
              paceDelta={previous.paceSecKm}
              hrDelta={previous.hrBpm}
              kind={kind}
              currentPace={current.paceSecKm}
            />
          )}
          {average && (
            <DeltaTile
              title={t("analysis.comparison.vsAverage")}
              paceDelta={average.paceSecKm}
              hrDelta={average.hrBpm}
              kind={kind}
              currentPace={current.paceSecKm}
            />
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="px-1.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                {t("analysis.comparison.date")}
              </th>
              {showDist && (
                <th className="px-1.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                  {t("analysis.distance")}
                </th>
              )}
              <th className="px-1.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                {t("analysis.time")}
              </th>
              {showPace && (
                <th className="px-1.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                  {paceMode(kind) === "speed" ? t("analysis.speed") : t("analysis.pace")}
                </th>
              )}
              {showHr && (
                <th className="px-1.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                  {t("analysis.avgHr")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={cn("border-t border-border", row.now && "bg-muted/60 font-bold")}
              >
                <td className="px-1.5 py-1.5 text-xs whitespace-nowrap">{row.label}</td>
                {showDist && (
                  <td className="px-1.5 py-1.5 text-xs tabular-nums whitespace-nowrap">
                    {row.dist !== null ? formatDistance(row.dist) : "--"}
                  </td>
                )}
                <td className="px-1.5 py-1.5 text-xs tabular-nums whitespace-nowrap">
                  {formatDuration(row.sec)}
                </td>
                {showPace && (
                  <td className="px-1.5 py-1.5 text-xs tabular-nums whitespace-nowrap">
                    {formatPaceOrSpeed(kind, row.pace)}
                  </td>
                )}
                {showHr && (
                  <td className="px-1.5 py-1.5 text-xs tabular-nums whitespace-nowrap">
                    {row.hr !== null ? Math.round(row.hr) : "--"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
