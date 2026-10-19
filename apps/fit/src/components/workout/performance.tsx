import {
  type AnalysisBestEffort,
  type AnalysisComparison,
  type AnalysisEffort,
  type AnalysisLoad,
  type WorkoutAnalysis,
  formatDuration,
  formatPace,
} from "@joyorogo/api/lib/workout-analysis";
import { fmtDateShort, fmtDecimal } from "@joyorogo/i18n";
import {
  comparisonDeltas,
  effortPace,
  loadWording,
  paceMode,
} from "@joyorogo/workout-view/analysis-math";
import { Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, Delta } from "@/components/kit";
import { fmtKm, fmtPaceOrSpeed, fmtSigned, wibDay } from "@/lib/format";

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="min-w-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="shrink-0 text-right text-sm font-semibold tabular-nums">
        {value}
        {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

export function BestEffortsCard({ efforts }: { efforts: readonly AnalysisBestEffort[] }) {
  const { t } = useTranslation("fitWebWorkouts");
  if (efforts.length === 0) return null;
  return (
    <Card>
      <CardHeader title={t("best.title")} subtitle={t("best.subtitle")} />
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="pb-2 text-left font-semibold">
              {t("best.distance")}
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              {t("best.time")}
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              {t("col.pace")}
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {efforts.map((effort) => (
            <tr key={effort.key} className="border-t border-border/60">
              <th scope="row" className="py-2 text-left font-semibold">
                {t(`best.names.${effort.key}`)}
                {effort.rank === 1 && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[0.6875rem] font-bold text-warning">
                    <Trophy className="size-3" aria-hidden />
                    {t("best.record")}
                  </span>
                )}
                {effort.rank !== null && effort.rank > 1 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {t("best.rank", { rank: effort.rank })}
                  </span>
                )}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t("best.at", { km: fmtDecimal(effort.atM / 1000, 1) })}
                </span>
              </th>
              <td className="py-2 text-right font-semibold">{formatDuration(effort.sec)}</td>
              <td className="py-2 text-right">
                {formatPace(effortPace(effort.key, effort.sec))}
                <span className="text-xs text-muted-foreground"> {t("unit.perKm")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Strain of the workout and the training load it sits in. */
export function EffortCard({
  effort,
  load,
}: {
  effort: AnalysisEffort | null;
  load: AnalysisLoad | null;
}) {
  const { t } = useTranslation("fitWebWorkouts");
  if (!effort && !load) return null;
  const wording = load?.ratio != null ? loadWording(load.ratio) : null;
  return (
    <Card>
      <CardHeader title={t("effort.title")} subtitle={t("effort.subtitle")} />
      <dl className="divide-y divide-border/60">
        {effort && (
          <>
            <Row
              label={t("effort.strain")}
              value={
                <>
                  {fmtDecimal(effort.strain, 1)}
                  <span className="text-xs font-normal text-muted-foreground"> /21</span>
                </>
              }
              hint={t(`effort.band.${effort.band}`)}
            />
            <Row label={t("effort.trimp")} value={fmtDecimal(effort.trimp, 0)} />
            {effort.addedToDay !== null && (
              <Row label={t("effort.addedToDay")} value={`+${fmtDecimal(effort.addedToDay, 1)}`} />
            )}
          </>
        )}
        {load && (
          <>
            <Row
              label={t("effort.acute")}
              value={fmtDecimal(load.acute, 0)}
              hint={t("effort.acuteHint")}
            />
            <Row
              label={t("effort.chronic")}
              value={fmtDecimal(load.chronicWeekly, 0)}
              hint={t("effort.chronicHint")}
            />
            {load.ratio !== null && wording && (
              <Row
                label={t("effort.ratio")}
                value={fmtDecimal(load.ratio, 2)}
                hint={t(`effort.wording.${wording}`)}
              />
            )}
            {load.aerobicEffect !== null && (
              <Row
                label={t("effort.aerobic")}
                value={fmtDecimal(load.aerobicEffect, 1)}
                hint={t("effort.effectHint")}
              />
            )}
            {load.anaerobicEffect !== null && (
              <Row
                label={t("effort.anaerobic")}
                value={fmtDecimal(load.anaerobicEffect, 1)}
                hint={t("effort.effectHint")}
              />
            )}
            {load.recoveryHours !== null && (
              <Row
                label={t("effort.recoveryHours")}
                value={t("effort.hours", { count: load.recoveryHours })}
              />
            )}
          </>
        )}
      </dl>
    </Card>
  );
}

/** This workout against the similar ones before it (same sport, close distance or duration). */
export function ComparisonCard({
  comparison,
  analysis,
}: {
  comparison: AnalysisComparison;
  analysis: WorkoutAnalysis;
}) {
  const { t } = useTranslation("fitWebWorkouts");
  const kind = analysis.sport.kind;
  const pace = paceMode(kind) !== null;
  const readsPace = paceMode(kind) === "pace";
  const deltas = comparisonDeltas(
    { paceSecKm: analysis.stats.avgPaceSecKm, avgHr: analysis.stats.avgHr },
    comparison,
  );
  if (comparison.items.length === 0) return null;

  const paceDelta = (sec: number | null) => {
    if (sec === null || Math.abs(sec) < 1) return null;
    // Negative seconds per km is faster: the good direction.
    return (
      <Delta
        text={`${sec < 0 ? "−" : "+"}${formatPace(Math.abs(sec))}`}
        direction={sec < 0 ? "down" : "up"}
        better="down"
      />
    );
  };
  const hrDelta = (bpm: number | null) =>
    bpm === null || Math.round(bpm) === 0 ? null : (
      <Delta text={`${fmtSigned(bpm)} bpm`} direction={bpm > 0 ? "up" : "down"} better="none" />
    );

  return (
    <Card>
      <CardHeader title={t("compare.title")} subtitle={t(`compare.basis.${comparison.basis}`)} />
      {(deltas.previous || deltas.average) && (
        <dl className="mb-3 grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-3 text-sm">
          {[
            { label: t("compare.previous"), delta: deltas.previous },
            { label: t("compare.average"), delta: deltas.average },
          ].map(({ label, delta }) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 flex flex-col gap-0.5">
                {delta ? (
                  <>
                    {readsPace && paceDelta(delta.paceSecKm)}
                    {hrDelta(delta.hrBpm)}
                  </>
                ) : (
                  "–"
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="pb-2 text-left font-semibold">
              {t("col.date")}
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              {t("col.distance")}
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              {pace ? t("col.pace") : t("col.duration")}
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              {t("col.hr")}
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {comparison.items.map((item) => (
            <tr key={item.startedAt} className="border-t border-border/60">
              <td className="py-2">{fmtDateShort(wibDay(item.startedAt / 1000))}</td>
              <td className="py-2 text-right">{item.distM ? fmtKm(item.distM) : "–"}</td>
              <td className="py-2 text-right">
                {pace ? fmtPaceOrSpeed(kind, item.paceSecKm) : formatDuration(item.sec)}
              </td>
              <td className="py-2 text-right">{item.avgHr ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
