import {
  type AnalysisHrZones,
  type AnalysisPaceZones,
  formatDuration,
  formatPace,
} from "@joyorogo/api/lib/workout-analysis";
import { useTranslation } from "react-i18next";

import { Card, SectionTitle } from "@/components/kit/surface";

import { percentOf } from "@joyorogo/workout-view/analysis-math";
import { ZONE_COLORS } from "./series-chart";

function ZoneBar({
  name,
  range,
  sec,
  percent,
  color,
}: {
  name: string;
  range: string;
  sec: number;
  percent: number;
  color: string;
}) {
  return (
    <li className="px-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-semibold">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{range}</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(percent, sec > 0 ? 2 : 0)}%`, backgroundColor: color }}
          />
        </div>
        <span className="w-20 shrink-0 text-right text-xs tabular-nums">
          <span className="font-bold">{formatDuration(sec)}</span>{" "}
          <span className="text-muted-foreground">{percent}%</span>
        </span>
      </div>
    </li>
  );
}

const HR_ZONE_KEYS = ["z1", "z2", "z3", "z4", "z5"] as const;

/** Time in the five heart-rate zones and where the maximum heart rate comes from. */
export function HrZonesCard({ zones }: { zones: AnalysisHrZones }) {
  const { t } = useTranslation("feed");
  const total = zones.sec.reduce((a, b) => a + b, 0) + zones.belowSec;
  if (total <= 0) return null;
  return (
    <Card className="p-4">
      <SectionTitle>{t("analysis.hrZones.title")}</SectionTitle>
      <ul className="space-y-3">
        {HR_ZONE_KEYS.map((key, z) => {
          const lo = zones.bounds[z];
          const hi = zones.bounds[z + 1];
          return (
            <ZoneBar
              key={key}
              name={t(`analysis.hrZones.${key}`)}
              range={
                lo !== undefined && hi !== undefined
                  ? t("analysis.hrZones.range", { from: Math.round(lo), to: Math.round(hi) })
                  : ""
              }
              sec={zones.sec[z] ?? 0}
              percent={percentOf(zones.sec[z] ?? 0, total)}
              color={ZONE_COLORS[z]!}
            />
          );
        })}
      </ul>
      {zones.belowSec > 0 && (
        <p className="mt-3 px-1 text-xs text-muted-foreground tabular-nums">
          {t("analysis.hrZones.below", {
            bpm: Math.round(zones.bounds[0] ?? 0),
            time: formatDuration(zones.belowSec),
          })}
        </p>
      )}
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        {t(
          zones.source === "age"
            ? "analysis.hrZones.maxFromAge"
            : "analysis.hrZones.maxFromSetting",
          {
            bpm: Math.round(zones.maxHr),
          },
        )}
      </p>
    </Card>
  );
}

const PACE_ZONE_COLORS: Record<string, string> = {
  recovery: ZONE_COLORS[0],
  endurance: ZONE_COLORS[1],
  tempo: ZONE_COLORS[2],
  threshold: ZONE_COLORS[3],
  vo2: ZONE_COLORS[4],
};

/** Time in the five pace zones, with the estimated threshold pace. */
export function PaceZonesCard({ zones }: { zones: AnalysisPaceZones }) {
  const { t } = useTranslation("feed");
  const total = zones.zones.reduce((a, z) => a + z.sec, 0);
  if (total <= 0) return null;
  return (
    <Card className="p-4">
      <SectionTitle>{t("analysis.paceZones.title")}</SectionTitle>
      <ul className="space-y-3">
        {zones.zones.map((zone) => {
          const range =
            zone.fromSecKm !== null && zone.toSecKm !== null
              ? t("analysis.paceZones.range", {
                  from: formatPace(zone.fromSecKm),
                  to: formatPace(zone.toSecKm),
                })
              : zone.fromSecKm === null && zone.toSecKm !== null
                ? t("analysis.paceZones.slower", { pace: formatPace(zone.toSecKm) })
                : zone.fromSecKm !== null
                  ? t("analysis.paceZones.faster", { pace: formatPace(zone.fromSecKm) })
                  : "";
          return (
            <ZoneBar
              key={zone.key}
              name={t(`analysis.paceZones.${zone.key}`)}
              range={range}
              sec={zone.sec}
              percent={percentOf(zone.sec, total)}
              color={PACE_ZONE_COLORS[zone.key]!}
            />
          );
        })}
      </ul>
      <p className="mt-3 px-1 text-xs text-muted-foreground tabular-nums">
        {t("analysis.paceZones.thresholdPace", { pace: formatPace(zones.thresholdSecKm) })}
      </p>
    </Card>
  );
}
