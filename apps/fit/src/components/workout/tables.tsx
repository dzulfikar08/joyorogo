import {
  type AnalysisLap,
  type AnalysisSplit,
  type SportKind,
  formatDuration,
} from "@joyorogo/api/lib/workout-analysis";
import { fmtDecimal } from "@joyorogo/i18n";
import { paceBarPercent, paceMode } from "@joyorogo/workout-view/analysis-math";
import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/kit";
import { fmtKm, fmtPaceOrSpeed } from "@/lib/format";

function Th({ children, right = true }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      scope="col"
      className={`px-2 py-2 font-semibold whitespace-nowrap ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

const num = (v: number | null, digits = 0) => (v === null ? "–" : fmtDecimal(v, digits));

/** "+19" / "−28"; a climb or drop that rounds to nothing is a plain 0. */
function signed(v: number | null, sign: "+" | "−"): string {
  if (v === null) return "–";
  const rounded = Math.round(Math.abs(v));
  return rounded === 0 ? "0" : `${sign}${fmtDecimal(rounded, 0)}`;
}

/** Kilometre splits with a bar per split: the fastest fills the row and the slowest keeps 40 percent. */
export function SplitsCard({
  splits,
  kind,
}: {
  splits: readonly AnalysisSplit[];
  kind: SportKind;
}) {
  const { t } = useTranslation("fitWebWorkouts");
  if (splits.length === 0) return null;
  const mode = paceMode(kind);
  const paces = splits.flatMap((s) => (s.paceSecKm ? [s.paceSecKm] : []));
  const fastest = paces.length ? Math.min(...paces) : 0;
  const slowest = paces.length ? Math.max(...paces) : 0;
  return (
    <Card>
      <CardHeader title={t("splits.title")} subtitle={t("splits.subtitle")} />
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <Th right={false}>{t("splits.km")}</Th>
              <Th>{mode === "speed" ? t("col.speedOnly") : t("col.paceOnly")}</Th>
              <Th right={false}>
                <span className="sr-only">{t("splits.bar")}</span>
              </Th>
              <Th>{t("col.hr")}</Th>
              <Th>{t("splits.gain")}</Th>
              <Th>{t("splits.loss")}</Th>
              <Th>{t("splits.cadence")}</Th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {splits.map((split) => {
              const isFastest =
                split.paceSecKm !== null && split.paceSecKm === fastest && paces.length > 1;
              return (
                <tr key={split.n} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="px-2 py-2 text-left font-semibold">
                    {split.distM < 990 ? fmtKm(split.distM) : split.n}
                  </th>
                  <td
                    className={`px-2 py-2 text-right font-semibold ${isFastest ? "text-recovery" : ""}`}
                  >
                    {fmtPaceOrSpeed(kind, split.paceSecKm)}
                  </td>
                  <td className="w-1/3 px-2 py-2">
                    {split.paceSecKm && (
                      <div className="h-2 rounded-full bg-muted" aria-hidden>
                        <div
                          className={`h-full rounded-full ${isFastest ? "bg-recovery" : "bg-primary/70"}`}
                          style={{ width: `${paceBarPercent(split.paceSecKm, fastest, slowest)}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">{num(split.hr)}</td>
                  <td className="px-2 py-2 text-right">{signed(split.gainM, "+")}</td>
                  <td className="px-2 py-2 text-right">{signed(split.lossM, "−")}</td>
                  <td className="px-2 py-2 text-right">{num(split.cad)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function LapsCard({ laps, kind }: { laps: readonly AnalysisLap[]; kind: SportKind }) {
  const { t } = useTranslation("fitWebWorkouts");
  if (laps.length === 0) return null;
  const hasDistance = laps.some((lap) => lap.distM);
  const mode = paceMode(kind);
  return (
    <Card>
      <CardHeader title={t("laps.title")} subtitle={t("laps.subtitle")} />
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <Th right={false}>{t("laps.lap")}</Th>
              <Th>{t("col.duration")}</Th>
              {hasDistance && <Th>{t("col.distance")}</Th>}
              {mode && <Th>{mode === "speed" ? t("col.speedOnly") : t("col.paceOnly")}</Th>}
              <Th>{t("laps.avgHr")}</Th>
              <Th>{t("laps.maxHr")}</Th>
              <Th>{t("splits.cadence")}</Th>
              <Th>{t("splits.gain")}</Th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {laps.map((lap) => (
              <tr key={lap.n} className="border-b border-border/60 last:border-0">
                <th scope="row" className="px-2 py-2 text-left font-semibold">
                  {lap.n}
                </th>
                <td className="px-2 py-2 text-right">{formatDuration(lap.sec)}</td>
                {hasDistance && (
                  <td className="px-2 py-2 text-right">{lap.distM ? fmtKm(lap.distM) : "–"}</td>
                )}
                {mode && (
                  <td className="px-2 py-2 text-right font-semibold">
                    {fmtPaceOrSpeed(kind, lap.paceSecKm)}
                  </td>
                )}
                <td className="px-2 py-2 text-right">{num(lap.avgHr)}</td>
                <td className="px-2 py-2 text-right">{num(lap.maxHr)}</td>
                <td className="px-2 py-2 text-right">{num(lap.avgCad)}</td>
                <td className="px-2 py-2 text-right">{signed(lap.gainM, "+")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
