import { Card, PageHeader } from "@/components/kit/surface";
import {
  type CatalogExercise,
  workoutApi,
  workoutQueryPrefix,
} from "@/lib/workout-contract";
import { fmtDateMedium, fmtInt } from "@/lib/format";
import { fmtNumber } from "@joyorogo/i18n";
import { prKindLabel, setSummaryLabel } from "@joyorogo/api/lib/workout";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const CHART_W = 560;
const CHART_H = 180;
const CHART_PAD = 28;

/** Simple SVG line of estimated 1RM over time (Hevy-style progress chart). */
function OneRmChart({ points }: { points: { date: string; oneRm: number }[] }) {
  const { t } = useTranslation("olahraga");
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((_, index) => index / (points.length - 1));
    const values = points.map((point) => point.oneRm);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const coords = points.map((point, index) => ({
      x: CHART_PAD + xs[index] * (CHART_W - 2 * CHART_PAD),
      y: CHART_PAD + (1 - (point.oneRm - min) / span) * (CHART_H - 2 * CHART_PAD),
      ...point,
    }));
    const d = coords
      .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`)
      .join(" ");
    return { d, coords, min, max };
  }, [points]);

  if (points.length < 2) {
    return <p className="text-sm text-muted-foreground">{t("latihan.detail.chartNeed")}</p>;
  }

  return (
    <figure>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        role="img"
        aria-label={t("latihan.detail.chartAria", {
          from: fmtDateMedium(points[0].date),
          to: fmtDateMedium(points[points.length - 1].date),
        })}
      >
        <path d={path!.d} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary" />
        {path!.coords.map((coord) => (
          <circle key={coord.date + coord.x} cx={coord.x} cy={coord.y} r="3.5" className="fill-primary">
            <title>{`${fmtDateMedium(coord.date)}: ${fmtInt(coord.oneRm)} kg`}</title>
          </circle>
        ))}
        <text x={CHART_PAD} y={12} className="fill-muted-foreground text-[10px]">
          {fmtInt(path!.max)} kg
        </text>
        <text x={CHART_PAD} y={CHART_H - 4} className="fill-muted-foreground text-[10px]">
          {fmtInt(path!.min)} kg
        </text>
      </svg>
    </figure>
  );
}

/** Per-exercise history: best numbers, 1RM chart, recent sessions. */
export function ExerciseDetail({ exercise }: { exercise: CatalogExercise }) {
  const { t } = useTranslation(["olahraga", "common"]);
  const history = useQuery({
    queryKey: [...workoutQueryPrefix, "history", exercise.id],
    queryFn: () => workoutApi.exerciseHistory({ exerciseId: exercise.id, limit: 50 }),
  });

  const best = history.data?.best;
  const bestRows = [
    { label: prKindLabel("weight"), value: best?.weightKg != null ? `${fmtNumber(best.weightKg, 1)} kg` : "–" },
    { label: prKindLabel("one_rm"), value: best?.oneRm != null ? `${fmtNumber(best.oneRm, 1)} kg` : "–" },
    { label: prKindLabel("reps"), value: best?.reps != null ? `${best.reps}` : "–" },
    {
      label: prKindLabel("set_volume"),
      value: best?.setVolume != null ? `${fmtInt(best.setVolume)} kg` : "–",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-5">
      <Link
        to="/latihan"
        className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronLeft className="size-4" aria-hidden /> {t("latihan.title")}
      </Link>
      <PageHeader title={exercise.name} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        {bestRows.map((row) => (
          <Card key={row.label} className="px-4 py-3">
            <p className="text-lg font-extrabold tabular-nums">{row.value}</p>
            <p className="text-xs text-muted-foreground">{row.label}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-3 space-y-3">
        {history.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common:state.loading")}</p>
        ) : history.error ? (
          <p className="text-sm text-destructive">{history.error.message}</p>
        ) : (
          <>
            <OneRmChart points={history.data?.oneRmByDate ?? []} />
            <ul className="divide-y divide-border">
              {(history.data?.sessions ?? []).slice(0, 10).map((session) => (
                <li key={session.sessionId} className="py-2.5">
                  <p className="text-sm font-bold">{fmtDateMedium(session.date)}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.sets.map((set) => setSummaryLabel(set)).join(" · ")}
                  </p>
                </li>
              ))}
              {(history.data?.sessions.length ?? 0) === 0 && (
                <li className="py-2 text-sm text-muted-foreground">
                  <span className="block font-semibold text-foreground">
                    {t("latihan.detail.emptyTitle")}
                  </span>
                  {t("latihan.detail.emptyHint")}
                </li>
              )}
            </ul>
          </>
        )}
      </Card>

      <details className="group mt-3 rounded-2xl bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-2xl px-4 select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-bold">{t("latihan.detail.how.title")}</span>
          <ChevronDown
            className="size-5 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t("latihan.detail.how.body")}</p>
      </details>
    </div>
  );
}
