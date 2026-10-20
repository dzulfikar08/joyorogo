import {
  type WorkoutAnalysis,
  formatDuration,
  formatPace,
} from "@joyorogo/api/lib/workout-analysis";
import { useTranslation } from "react-i18next";

import { Card, SectionTitle } from "@/components/kit/surface";

import { paceMode, speedKmh } from "@joyorogo/workout-view/analysis-math";

function Stat({
  label,
  value,
  unit,
  big = false,
}: {
  label: string;
  value: string;
  unit?: string;
  big?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          big
            ? "text-2xl leading-tight font-extrabold tracking-tight tabular-nums"
            : "text-base font-bold tabular-nums"
        }
      >
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>}
      </dd>
    </div>
  );
}

/** Headline numbers: distance, moving versus elapsed time, pace or speed, climb, calories, heart rate. */
export function SummaryCard({ analysis }: { analysis: WorkoutAnalysis }) {
  const { t, i18n } = useTranslation("feed");
  const { stats, elevation, calories, sport } = analysis;
  const mode = paceMode(sport.kind);
  const cadUnit = sport.kind === "ride" ? "rpm" : "spm";
  const distance = analysis.distanceM;

  const avgPace =
    stats.avgPaceSecKm ??
    (distance && analysis.movingSec > 0 ? analysis.movingSec / (distance / 1000) : null);
  const avgSpeed =
    stats.avgSpeedMs !== null ? stats.avgSpeedMs * 3.6 : avgPace ? speedKmh(avgPace) : null;

  const started = new Intl.DateTimeFormat(i18n.language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(analysis.startedAt);

  const headline = [
    distance !== null && distance > 0
      ? { label: t("analysis.distance"), value: (distance / 1000).toFixed(2), unit: "km" }
      : null,
    { label: t("analysis.movingTime"), value: formatDuration(analysis.movingSec), unit: "" },
    mode === "pace" && avgPace
      ? { label: t("analysis.avgPace"), value: formatPace(avgPace), unit: "/km" }
      : mode === "speed" && avgSpeed
        ? { label: t("analysis.avgSpeed"), value: avgSpeed.toFixed(1), unit: "km/h" }
        : null,
  ].filter((item) => item !== null);

  const minor = [
    elevation
      ? { label: t("analysis.elevationGain"), value: `+${Math.round(elevation.gainM)}`, unit: "m" }
      : null,
    calories
      ? { label: t("analysis.calories"), value: String(Math.round(calories.kcal)), unit: "kcal" }
      : null,
    stats.avgHr !== null
      ? { label: t("analysis.avgHr"), value: String(Math.round(stats.avgHr)), unit: "bpm" }
      : null,
    stats.maxHr !== null
      ? { label: t("analysis.maxHr"), value: String(Math.round(stats.maxHr)), unit: "bpm" }
      : null,
    stats.avgCad !== null
      ? { label: t("analysis.avgCadence"), value: String(Math.round(stats.avgCad)), unit: cadUnit }
      : null,
    stats.maxCad !== null
      ? { label: t("analysis.maxCadence"), value: String(Math.round(stats.maxCad)), unit: cadUnit }
      : null,
    mode === "pace" && stats.avgStrideM !== null
      ? { label: t("analysis.stepLength"), value: stats.avgStrideM.toFixed(2), unit: "m" }
      : null,
  ].filter((item) => item !== null);

  return (
    <Card className="p-4">
      <SectionTitle
        action={<span className="text-xs text-muted-foreground tabular-nums">{started}</span>}
      >
        {sport.name}
      </SectionTitle>
      <dl
        className="grid gap-3 px-1"
        style={{ gridTemplateColumns: `repeat(${headline.length}, minmax(0, 1fr))` }}
      >
        {headline.map((item) => (
          <Stat key={item.label} {...item} big />
        ))}
      </dl>
      <p className="mt-3 rounded-2xl bg-muted px-3 py-2 text-sm tabular-nums">
        <span className="font-semibold">
          {t("analysis.movingElapsed", {
            moving: formatDuration(analysis.movingSec),
            elapsed: formatDuration(analysis.elapsedSec),
          })}
        </span>
      </p>
      {minor.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 px-1 min-[420px]:grid-cols-4">
          {minor.map((item) => (
            <Stat key={item.label} {...item} />
          ))}
        </dl>
      )}
    </Card>
  );
}

/** Energy: total, per hour and the fat and carbohydrate split when the engine has one. */
export function CaloriesCard({ analysis }: { analysis: WorkoutAnalysis }) {
  const { t } = useTranslation("feed");
  const { calories } = analysis;
  if (!calories) return null;
  const perHour = analysis.elapsedSec > 0 ? (calories.kcal / analysis.elapsedSec) * 3600 : null;
  return (
    <Card className="p-4">
      <SectionTitle>{t("analysis.calories")}</SectionTitle>
      <dl className="grid grid-cols-2 gap-3 px-1 min-[420px]:grid-cols-4">
        <Stat label={t("analysis.energy")} value={String(Math.round(calories.kcal))} unit="kcal" />
        {perHour !== null && (
          <Stat label={t("analysis.perHour")} value={String(Math.round(perHour))} unit="kcal/h" />
        )}
        {calories.fatG !== null && (
          <Stat label={t("analysis.fat")} value={String(Math.round(calories.fatG))} unit="g" />
        )}
        {calories.carbG !== null && (
          <Stat label={t("analysis.carbs")} value={String(Math.round(calories.carbG))} unit="g" />
        )}
      </dl>
    </Card>
  );
}
