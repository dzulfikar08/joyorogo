import { Button } from "@joyorogo/ui/components/button";
import { Card, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { MuscleMap } from "@/components/workout/muscle-map";
import { ProgressCard } from "@/components/workout/progress-card";
import {
  type ActiveWorkout,
  clearActive,
  loadActive,
  rememberExercises,
  saveActive,
  workoutFromRoutine,
  workoutFromSessionItem,
} from "@/components/workout/active-store";
import { workoutApi, workoutQueryPrefix } from "@/lib/workout-contract";
import { fmtDateLong, fmtInt } from "@/lib/format";
import type { WorkoutStatus } from "@/lib/api-types";
import { useDelayedDelete } from "@/lib/optimistic";
import { removeById } from "@joyorogo/api/lib/optimistic";
import type { Routine } from "@/lib/workout-contract";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { Dumbbell, History, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_auth/latihan/")({
  component: LatihanPage,
});

/** Hub: resume banner, start options, routines, history, weekly progress. */
function LatihanScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });
  const routines = useQuery({
    queryKey: [...workoutQueryPrefix, "routines"],
    queryFn: () => workoutApi.listRoutines(),
  });
  const last = useQuery(orpc.workout.lastSession.queryOptions());
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));

  // Resume banner reflects localStorage; re-check after returning from /aktif.
  const [resumable, setResumable] = useState<ActiveWorkout | null>(null);
  useEffect(() => {
    setResumable(loadActive());
    return () => undefined;
  }, []);

  const catalogById = new Map((catalog.data?.exercises ?? []).map((exercise) => [exercise.id, exercise]));
  const typeOf = (exerciseId: string) => catalogById.get(exerciseId)?.type ?? "weight_reps";

  const startWorkout = (workout: ActiveWorkout) => {
    saveActive(workout);
    void navigate({ to: "/latihan/aktif" });
  };

  // Delayed-commit delete: gone from the list instantly, DELETE after the
  // undo window; undo restores and never calls the server.
  const deleteRoutine = useDelayedDelete<Routine>({
    remove: (row) => workoutApi.deleteRoutine({ id: row.id }),
    patch: (row, cache) => {
      cache.list<Routine>(["workout", "routines"], (rows) => removeById(rows, row.id));
    },
    label: (row) => row.name,
    fallback: "Rutinitas",
    invalidate: () => [orpc.workout.key()],
  });

  const nameOf = (exerciseId: string) => catalogById.get(exerciseId)?.name ?? exerciseId;

  const startEmpty = () => {
    startWorkout({
      name: "",
      note: "",
      startedAt: new Date().toISOString(),
      exercises: [],
    });
  };

  const startFromLast = () => {
    if (!last.data) return;
    const workout = workoutFromSessionItem({
      session: last.data.session,
      sets: last.data.sets,
      typeOf,
    });
    rememberExercises([...new Set(last.data.sets.map((set) => set.exerciseId))]);
    startWorkout(workout);
  };

  const startFromRoutine = (routineId: string) => {
    const routine = (routines.data ?? []).find((item) => item.id === routineId);
    if (!routine) return;
    startWorkout(workoutFromRoutine(routine, typeOf));
  };

  return (
    <Page className="max-w-xl lg:max-w-3xl">
      <PageHeader
        title="Latihan Beban"
        subtitle="Turun berat tanpa kehilangan otot. Catat gerakan, set, dan beban."
      />

      {resumable && (
        <Card className="mb-4 flex items-center gap-3 border-primary/40 bg-primary/5">
          <Dumbbell className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">Ada latihan yang belum selesai</p>
            <p className="text-xs text-muted-foreground">
              {resumable.name || "Latihan bebas"} · {resumable.exercises.length} gerakan
            </p>
          </div>
          <Link
            to="/latihan/aktif"
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            Lanjutkan latihan
          </Link>
          <button
            type="button"
            aria-label="Buang latihan yang belum selesai"
            onClick={() => {
              clearActive();
              setResumable(null);
            }}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </Card>
      )}

      <SectionTitle>Mulai</SectionTitle>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={startEmpty} disabled={resumable !== null}>
          <Plus className="size-4" aria-hidden /> Latihan kosong
        </Button>
        {last.data && (
          <Button
            variant="secondary"
            onClick={startFromLast}
            disabled={resumable !== null}
          >
            <RotateCcw className="size-4" aria-hidden /> Ulangi: {last.data.session.name}
          </Button>
        )}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-5">
        <div className="min-w-0 space-y-3 lg:space-y-5">
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle>Rutinitas</SectionTitle>
              <Link
                to="/latihan/rutinitas/$id"
                params={{ id: "baru" }}
                className="rounded-full bg-muted px-3 py-1.5 text-xs font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                Buat baru
              </Link>
            </div>
            {routines.isPending ? (
              <p className="text-sm text-muted-foreground">Memuat rutinitas…</p>
            ) : (routines.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada rutinitas. Simpan latihan favoritmu biar tinggal ulang.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {(routines.data ?? []).map((routine) => (
                  <li key={routine.id} className="flex items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{routine.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {routine.exercises.length} gerakan ·{" "}
                        {routine.exercises.reduce((sum, item) => sum + item.sets.length, 0)} set
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => startFromRoutine(routine.id)}
                      disabled={resumable !== null}
                    >
                      <Play className="size-4" aria-hidden /> Mulai
                    </Button>
                    <Link
                      to="/latihan/rutinitas/$id"
                      params={{ id: routine.id }}
                      aria-label={`Edit rutinitas ${routine.name}`}
                      className="rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-3">
            <SectionTitle>Riwayat sesi</SectionTitle>
            {history.isPending ? (
              <p className="text-sm text-muted-foreground">Memuat riwayat…</p>
            ) : (history.data?.items.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada sesi. Dua-tiga sesi seminggu cukup buat jaga otot.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {history.data!.items.map((item) => (
                  <li key={item.session.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{item.session.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDateLong(item.session.date)}
                          {item.session.durationMin != null
                            ? ` · ${fmtInt(item.session.durationMin)} menit`
                            : ""}
                          {` · ${item.sets.length} set`}
                        </p>
                      </div>
                      <ShareStoryButton
                        label=""
                        aria-label={`Bagikan sesi ${item.session.name} ke Story`}
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        story={{
                          kind: "workout",
                          name: item.session.name,
                          durationMin: item.session.durationMin,
                          volumeKg: item.sets.reduce(
                            (sum, set) =>
                              set.setType === "warmup" || set.weightKg == null || set.reps == null
                                ? sum
                                : sum + set.weightKg * set.reps,
                            0,
                          ),
                          setsDone: item.sets.filter((set) => set.setType !== "warmup").length,
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {[...new Set(item.sets.map((set) => set.exerciseId))].map((exerciseId) => (
                        <Link
                          key={exerciseId}
                          to="/latihan/gerakan/$exerciseId"
                          params={{ exerciseId }}
                          className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                        >
                          {nameOf(exerciseId)}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-3 lg:space-y-5">
          <Card className="space-y-3">
            <SectionTitle>Peta otot minggu ini</SectionTitle>
            {status.isPending ? (
              <p className="text-sm text-muted-foreground">Menghitung volume otot…</p>
            ) : status.error ? (
              <p className="text-sm text-destructive">{status.error.message}</p>
            ) : (
              <MuscleMap status={status.data} />
            )}
          </Card>

          <Card className="space-y-3">
            <SectionTitle>Progres kekuatan</SectionTitle>
            {status.data ? (
              <ProgressCard status={status.data} />
            ) : (
              <p className="text-sm text-muted-foreground">Memuat rekor…</p>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function LatihanPage() {
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });
  if (catalog.error) {
    return <ScreenError message={catalog.error.message} onRetry={() => catalog.refetch()} />;
  }
  return <LatihanScreen />;
}
