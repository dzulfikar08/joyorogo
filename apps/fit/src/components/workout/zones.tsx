import {
  type AnalysisHrZones,
  type AnalysisPaceZones,
  formatPace,
} from "@joyorogo/api/lib/workout-analysis";
import { fmtDecimal } from "@joyorogo/i18n";
import { percentOf } from "@joyorogo/workout-view/analysis-math";
import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/kit";
import { fmtHm } from "@/lib/format";

/** Zones 1 to 5, easy to maximal: the same order in the heart-rate chart bands and the time-in-zone bars. */
export const HR_ZONE_COLORS = ["#6EC1DB", "#4FC987", "#E8C13A", "#EE9A3A", "#E5484D"] as const;
const PACE_ZONE_COLORS = ["#6EC1DB", "#4FC987", "#E8C13A", "#EE9A3A", "#E5484D"] as const;

function Bar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%`, background: color }}
      />
    </div>
  );
}

export function HrZonesCard({ zones }: { zones: AnalysisHrZones }) {
  const { t } = useTranslation("fitWebWorkouts");
  const total = zones.sec.reduce((a, b) => a + b, 0) + zones.belowSec;
  return (
    <Card>
      <CardHeader
        title={t("zones.hr.title")}
        subtitle={t("zones.hr.subtitle", {
          max: zones.maxHr,
          source: t(`zones.hr.source.${zones.source}`),
        })}
      />
      <ul className="flex flex-col gap-3">
        {[4, 3, 2, 1, 0].map((i) => {
          const sec = zones.sec[i] ?? 0;
          const low = zones.bounds[i] ?? 0;
          const high = zones.bounds[i + 1] ?? zones.maxHr;
          return (
            <li
              key={i}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
            >
              <span className="text-sm font-bold" style={{ color: HR_ZONE_COLORS[i] }}>
                Z{i + 1}
              </span>
              <Bar percent={percentOf(sec, total)} color={HR_ZONE_COLORS[i] ?? "var(--primary)"} />
              <span className="text-right text-sm font-semibold tabular-nums">
                {sec > 0 ? fmtHm(sec) : "–"}
              </span>
              <span />
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("zones.hr.range", { low, high })}
              </span>
              <span className="text-right text-xs text-muted-foreground tabular-nums">
                {percentOf(sec, total)}%
              </span>
            </li>
          );
        })}
      </ul>
      {zones.belowSec > 0 && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          {t("zones.hr.below", { time: fmtHm(zones.belowSec), low: zones.bounds[0] ?? 0 })}
        </p>
      )}
    </Card>
  );
}

export function PaceZonesCard({ zones }: { zones: AnalysisPaceZones }) {
  const { t } = useTranslation("fitWebWorkouts");
  const total = zones.zones.reduce((sum, z) => sum + z.sec, 0);
  // The API lists the slowest zone first; the fastest reads first on screen, like Z5 above Z1.
  const ordered = zones.zones.toReversed();
  return (
    <Card>
      <CardHeader
        title={t("zones.pace.title")}
        subtitle={t("zones.pace.subtitle", { pace: formatPace(zones.thresholdSecKm) })}
      />
      <ul className="flex flex-col gap-3">
        {ordered.map((zone, i) => {
          const color = PACE_ZONE_COLORS[PACE_ZONE_COLORS.length - 1 - i] ?? "var(--primary)";
          const from = zone.fromSecKm === null ? null : formatPace(zone.fromSecKm);
          const to = zone.toSecKm === null ? null : formatPace(zone.toSecKm);
          const range = from && to ? `${to}–${from}` : from ? `> ${from}` : to ? `< ${to}` : "";
          return (
            <li
              key={zone.key}
              className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
            >
              <span className="break-words text-sm font-bold">
                {t(`zones.pace.names.${zone.key}`)}
              </span>
              <Bar percent={percentOf(zone.sec, total)} color={color} />
              <span className="text-right text-sm font-semibold tabular-nums">
                {zone.sec > 0 ? fmtHm(zone.sec) : "–"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {range && t("zones.pace.range", { range })}
              </span>
              <span />
              <span className="text-right text-xs text-muted-foreground tabular-nums">
                {fmtDecimal(percentOf(zone.sec, total), 0)}%
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
