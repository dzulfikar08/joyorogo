import {
  type AnalysisLap,
  type AnalysisSplit,
  type SportKind,
  formatDistance,
  formatDuration,
} from "@joyorogo/api/lib/workout-analysis";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

import { Card, SectionTitle } from "@/components/kit/surface";

import { formatPaceOrSpeed, paceBarPercent, paceMode } from "./analysis-math";

const TH = "px-1 py-1.5 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap";
const TD = "px-1 py-1.5 text-xs tabular-nums whitespace-nowrap";

function PaceLabel({ kind }: { kind: SportKind }) {
  const { t } = useTranslation("feed");
  return <>{paceMode(kind) === "speed" ? t("analysis.speed") : t("analysis.pace")}</>;
}

/** One row per kilometre with a pace bar relative to the fastest and slowest split. */
export function SplitsCard({ splits, kind }: { splits: AnalysisSplit[]; kind: SportKind }) {
  const { t } = useTranslation("feed");
  if (splits.length === 0) return null;

  const paces = splits.flatMap((s) => (s.paceSecKm !== null ? [s.paceSecKm] : []));
  const fastest = paces.length ? Math.min(...paces) : 0;
  const slowest = paces.length ? Math.max(...paces) : 0;
  const showPace = paces.length > 0 && paceMode(kind) !== null;
  const showElev = splits.some((s) => s.gainM !== null || s.lossM !== null);
  const showHr = splits.some((s) => s.hr !== null);
  const showCad = splits.some((s) => s.cad !== null);
  const unit = paceMode(kind) === "speed" ? "km/h" : "/km";

  return (
    <Card className="p-4">
      <SectionTitle>{t("analysis.splits.title")}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={TH}>{t("analysis.splits.km")}</th>
              {showPace && (
                <th className={TH} colSpan={2}>
                  <PaceLabel kind={kind} /> <span className="font-normal">({unit})</span>
                </th>
              )}
              {!showPace && <th className={TH}>{t("analysis.time")}</th>}
              {showElev && <th className={TH}>{t("analysis.splits.elev")}</th>}
              {showHr && <th className={TH}>{t("analysis.splits.hr")}</th>}
              {showCad && <th className={TH}>{t("analysis.splits.cad")}</th>}
            </tr>
          </thead>
          <tbody>
            {splits.map((split) => {
              const partial = split.n === splits[splits.length - 1]!.n && split.distM < 995;
              const isFastest = showPace && split.paceSecKm !== null && split.paceSecKm === fastest;
              return (
                <tr key={split.n} className="border-t border-border">
                  <td className={cn(TD, "font-semibold")}>
                    {partial ? formatDistance(split.distM) : split.n}
                  </td>
                  {showPace && (
                    <>
                      <td className={cn(TD, isFastest && "font-bold text-primary")}>
                        {formatPaceOrSpeed(kind, split.paceSecKm)}
                      </td>
                      <td className="w-full min-w-14 py-1.5 pr-2 pl-0.5">
                        {split.paceSecKm !== null && (
                          <div
                            className={cn(
                              "h-3 rounded-full",
                              isFastest ? "bg-primary" : "bg-primary/35",
                            )}
                            style={{
                              width: `${paceBarPercent(split.paceSecKm, fastest, slowest)}%`,
                            }}
                          />
                        )}
                      </td>
                    </>
                  )}
                  {!showPace && <td className={TD}>{formatDuration(split.sec)}</td>}
                  {showElev && (
                    <td className={TD}>
                      <span className="text-foreground">
                        {split.gainM !== null ? `+${Math.round(split.gainM)}` : "--"}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        {split.lossM !== null ? `-${Math.round(split.lossM)}` : ""}
                      </span>
                    </td>
                  )}
                  {showHr && (
                    <td className={TD}>{split.hr !== null ? Math.round(split.hr) : "--"}</td>
                  )}
                  {showCad && (
                    <td className={TD}>{split.cad !== null ? Math.round(split.cad) : "--"}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Watch laps: time, distance, pace and heart rate per lap. Shown for two laps or more. */
export function LapsCard({ laps, kind }: { laps: AnalysisLap[]; kind: SportKind }) {
  const { t } = useTranslation("feed");
  if (laps.length < 2) return null;

  const showDist = laps.some((l) => l.distM !== null);
  const showPace = paceMode(kind) !== null && laps.some((l) => l.paceSecKm !== null);
  const showAvgHr = laps.some((l) => l.avgHr !== null);
  const showMaxHr = laps.some((l) => l.maxHr !== null);
  const showCad = laps.some((l) => l.avgCad !== null);
  const showGain = laps.some((l) => l.gainM !== null);

  return (
    <Card className="p-4">
      <SectionTitle>{t("analysis.laps.title")}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={TH}>{t("analysis.laps.lap")}</th>
              <th className={TH}>{t("analysis.time")}</th>
              {showDist && <th className={TH}>{t("analysis.distance")}</th>}
              {showPace && (
                <th className={TH}>
                  <PaceLabel kind={kind} />
                </th>
              )}
              {showAvgHr && <th className={TH}>{t("analysis.laps.avgHr")}</th>}
              {showMaxHr && <th className={TH}>{t("analysis.laps.maxHr")}</th>}
              {showCad && <th className={TH}>{t("analysis.laps.cad")}</th>}
              {showGain && <th className={TH}>{t("analysis.laps.gain")}</th>}
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.n} className="border-t border-border">
                <td className={cn(TD, "font-semibold")}>{lap.n}</td>
                <td className={TD}>{formatDuration(lap.sec)}</td>
                {showDist && (
                  <td className={TD}>{lap.distM !== null ? formatDistance(lap.distM) : "--"}</td>
                )}
                {showPace && <td className={TD}>{formatPaceOrSpeed(kind, lap.paceSecKm)}</td>}
                {showAvgHr && (
                  <td className={TD}>{lap.avgHr !== null ? Math.round(lap.avgHr) : "--"}</td>
                )}
                {showMaxHr && (
                  <td className={TD}>{lap.maxHr !== null ? Math.round(lap.maxHr) : "--"}</td>
                )}
                {showCad && (
                  <td className={TD}>{lap.avgCad !== null ? Math.round(lap.avgCad) : "--"}</td>
                )}
                {showGain && (
                  <td className={TD}>{lap.gainM !== null ? `+${Math.round(lap.gainM)}` : "--"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
