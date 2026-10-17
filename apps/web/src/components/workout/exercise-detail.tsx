import { Card, PageHeader } from "@/components/kit/surface";
import {
  type CatalogExercise,
  workoutApi,
  workoutQueryPrefix,
} from "@/lib/workout-contract";
import { fmtDateLong, fmtInt } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";

const CHART_W = 560;
const CHART_H = 180;
const CHART_PAD = 28;

/** Simple SVG line of estimated 1RM over time (Hevy-style progress chart). */
function OneRmChart({ points }: { points: { date: string; oneRm: number }[] }) {
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
    return (
      <p className="text-sm text-muted-foreground">
        Butuh minimal dua sesi dengan beban untuk grafik estimasi 1RM.
      </p>
    );
  }

  return (
    <figure>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        role="img"
        aria-label={`Grafik estimasi 1RM dari ${fmtDateLong(points[0].date)} ke ${fmtDateLong(points[points.length - 1].date)}`}
      >
        <path d={path!.d} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary" />
        {path!.coords.map((coord) => (
          <circle key={coord.date + coord.x} cx={coord.x} cy={coord.y} r="3.5" className="fill-primary">
            <title>{`${fmtDateLong(coord.date)}: ${fmtInt(coord.oneRm)} kg`}</title>
          </circle>
        ))}
        <text x={CHART_PAD} y={12} className="fill-muted-foreground text-[10px]">
          {fmtInt(path!.max)} kg
        </text>
        <text x={CHART_PAD} y={CHART_H - 4} className="fill-muted-foreground text-[10px]">
          {fmtInt(path!.min)} kg
        </text>
      </svg>
      <figcaption className="text-center text-xs text-muted-foreground">
        Estimasi 1RM (Epley) per sesi
      </figcaption>
    </figure>
  );
}

/** Per-exercise history: best numbers, 1RM chart, recent sessions. */
export function ExerciseDetail({ exercise }: { exercise: CatalogExercise }) {
  const history = useQuery({
    queryKey: [...workoutQueryPrefix, "history", exercise.id],
    queryFn: () => workoutApi.exerciseHistory({ exerciseId: exercise.id, limit: 50 }),
  });

  const best = history.data?.best;
  const bestRows = [
    { label: "Terberat", value: best?.weightKg != null ? `${fmtInt(best.weightKg)} kg` : "–" },
    { label: "Estimasi 1RM", value: best?.oneRm != null ? `${fmtInt(best.oneRm)} kg` : "–" },
    { label: "Reps terbanyak", value: best?.reps != null ? `${best.reps}` : "–" },
    {
      label: "Volume set terbaik",
      value: best?.setVolume != null ? `${fmtInt(best.setVolume)} kg` : "–",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-5">
      <Link
        to="/latihan"
        className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronLeft className="size-4" aria-hidden /> Latihan beban
      </Link>
      <PageHeader title={exercise.name} subtitle="Riwayat dan rekor gerakan ini." />

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
          <p className="text-sm text-muted-foreground">Memuat riwayat…</p>
        ) : history.error ? (
          <p className="text-sm text-destructive">{history.error.message}</p>
        ) : (
          <>
            <OneRmChart points={history.data?.oneRmByDate ?? []} />
            <ul className="divide-y divide-border">
              {(history.data?.sessions ?? []).slice(0, 10).map((session) => (
                <li key={session.sessionId} className="py-2.5">
                  <p className="text-sm font-bold">{fmtDateLong(session.date)}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.sets
                      .map((set) =>
                        set.durationSec != null
                          ? fmtInt(set.durationSec) + " dtk"
                          : `${set.reps}×${set.weightKg != null ? `${fmtInt(set.weightKg)}kg` : "BW"}`,
                      )
                      .join(" · ")}
                  </p>
                </li>
              ))}
              {(history.data?.sessions.length ?? 0) === 0 && (
                <li className="py-2 text-sm text-muted-foreground">
                  Belum pernah dicatat. Selesaikan satu sesi dulu.
                </li>
              )}
            </ul>
          </>
        )}
      </Card>

    </div>
  );
}
