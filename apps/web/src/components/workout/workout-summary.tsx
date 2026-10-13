import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Card, FieldLabel } from "@/components/kit/surface";
import type { ActiveExercise, ActiveWorkout } from "@/components/workout/active-store";
import {
  type PreviousEntry,
  workoutApi,
  workoutQueryPrefix,
} from "@/lib/workout-contract";
import { fmtInt, parseNum } from "@/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export type FinishedSet = {
  exerciseId: string;
  setType: ActiveExercise["sets"][number]["setType"];
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
};

/** Epley estimated 1RM; meaningless without load. */
function epley(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

export type LocalPr = { exerciseName: string; label: string; value: string };

/**
 * Compare this session's completed (non-warmup) sets against every previous
 * session for the same movement: heaviest weight, best e1RM, most reps at any
 * weight, best single-set volume.
 */
export function computeLocalPrs(
  exercises: { exercise: ActiveExercise; name: string; sets: FinishedSet[] }[],
  previous: Record<string, PreviousEntry[]>,
): LocalPr[] {
  const prs: LocalPr[] = [];
  for (const { exercise, name, sets } of exercises) {
    const working = sets.filter((set) => set.setType !== "warmup");
    const prev = previous[exercise.exerciseId] ?? [];
    const prevWorking = prev.filter((entry) => entry.setType !== "warmup");

    const bestWeight = Math.max(0, ...working.map((s) => s.weightKg ?? 0));
    const prevWeight = Math.max(0, ...prevWorking.map((s) => s.weightKg ?? 0));
    if (bestWeight > 0 && bestWeight > prevWeight) {
      prs.push({ exerciseName: name, label: "Beban terberat", value: `${fmtInt(bestWeight)} kg` });
    }

    const bestOneRm = Math.max(0, ...working.map((s) => epley(s.weightKg ?? 0, s.reps ?? 0)));
    const prevOneRm = Math.max(0, ...prevWorking.map((s) => epley(s.weightKg ?? 0, s.reps ?? 0)));
    if (bestWeight > 0 && bestOneRm > prevOneRm) {
      prs.push({ exerciseName: name, label: "Estimasi 1RM", value: `${fmtInt(bestOneRm)} kg` });
    }

    const atWeight = working.filter((s) => (s.weightKg ?? 0) === bestWeight && bestWeight > 0);
    const bestReps = Math.max(0, ...atWeight.map((s) => s.reps ?? 0));
    const prevAtWeight = prevWorking.filter((s) => (s.weightKg ?? 0) === prevWeight && prevWeight > 0);
    const prevReps = Math.max(0, ...prevAtWeight.map((s) => s.reps ?? 0));
    if (bestReps > 0 && (bestWeight > prevWeight || bestReps > prevReps)) {
      prs.push({
        exerciseName: name,
        label: `Reps terbanyak @ ${fmtInt(bestWeight)} kg`,
        value: `${bestReps} reps`,
      });
    }

    const bestVolume = Math.max(0, ...working.map((s) => (s.weightKg ?? 0) * (s.reps ?? 0)));
    const prevVolume = Math.max(0, ...prevWorking.map((s) => (s.weightKg ?? 0) * (s.reps ?? 0)));
    if (bestVolume > 0 && bestVolume > prevVolume) {
      prs.push({
        exerciseName: name,
        label: "Volume set terbaik",
        value: `${fmtInt(bestVolume)} kg`,
      });
    }
  }
  return prs;
}

export type WorkoutTotals = { durationMs: number; volumeKg: number; setsDone: number; setsTotal: number };

export function computeTotals(workout: ActiveWorkout, now: number): WorkoutTotals {
  let volumeKg = 0;
  let setsDone = 0;
  let setsTotal = 0;
  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      setsTotal += 1;
      if (!set.done) continue;
      setsDone += 1;
      const weight = parseNum(set.weightKg) ?? 0;
      const reps = parseNum(set.reps) ?? 0;
      volumeKg += weight * reps;
    }
  }
  return {
    durationMs: Math.max(0, now - new Date(workout.startedAt).getTime()),
    volumeKg,
    setsDone,
    setsTotal,
  };
}

/**
 * Post-finish review screen: totals, "Rekor baru" list, editable title and
 * note, then save (or save as a routine for next time).
 */
export function WorkoutSummary({
  workout,
  finished,
  totals,
  nameOf,
  onClose,
}: {
  workout: ActiveWorkout;
  finished: FinishedSet[][];
  totals: WorkoutTotals;
  nameOf: (exerciseId: string) => string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(workout.name || "Latihan bebas");
  const [note, setNote] = useState(workout.note);
  const [error, setError] = useState<string | null>(null);
  const [saveRoutineOpen, setSaveRoutineOpen] = useState(false);
  const [routineName, setRoutineName] = useState(workout.name || "Latihan bebas");

  const exerciseIds = useMemo(
    () => [...new Set(workout.exercises.map((exercise) => exercise.exerciseId))],
    [workout.exercises],
  );
  const previous = useQuery({
    queryKey: [...workoutQueryPrefix, "previous", exerciseIds],
    queryFn: () => workoutApi.previous({ exerciseIds }),
  });

  const localPrs = useMemo(() => {
    if (!previous.data) return [];
    return computeLocalPrs(
      workout.exercises.map((exercise, index) => ({
        exercise,
        name: nameOf(exercise.exerciseId),
        sets: finished[index] ?? [],
      })),
      previous.data,
    );
  }, [previous.data, workout.exercises, finished, nameOf]);

  const save = useMutation({
    mutationFn: () =>
      workoutApi.saveSession({
        date: new Date().toISOString().slice(0, 10),
        name: name.trim(),
        note: note.trim().length > 0 ? note.trim() : undefined,
        startedAt: workout.startedAt,
        durationMin: Math.max(1, Math.round(totals.durationMs / 60000)),
        sets: finished.flatMap((sets, index) =>
          (sets ?? []).map((set) => ({
            exerciseId: workout.exercises[index]?.exerciseId ?? "",
            setType: set.setType,
            reps: set.reps,
            weightKg: set.weightKg,
            durationSec: set.durationSec,
            note: workout.exercises[index]?.note.trim() || undefined,
            supersetGroup: workout.exercises[index]?.supersetGroup,
          })),
        ),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: [...workoutQueryPrefix] });
      void queryClient.invalidateQueries({ queryKey: ["day"] });
      void queryClient.invalidateQueries({ queryKey: ["exercise"] });
      const prCount = result.prs.length;
      toast.success(
        prCount > 0 ? `Tersimpan. ${prCount} rekor baru, mantap!` : "Sesi latihan tersimpan.",
      );
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const saveRoutine = useMutation({
    mutationFn: () =>
      workoutApi.saveRoutine({
        name: routineName.trim(),
        exercises: workout.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          restSec: exercise.restSec,
          note: exercise.note.trim() || undefined,
          sets: (finished[workout.exercises.indexOf(exercise)] ?? []).map((set) => ({
            setType: set.setType,
            reps: set.reps,
            weightKg: set.weightKg,
            durationSec: set.durationSec,
          })),
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...workoutQueryPrefix] });
      toast.success("Rutinitas tersimpan.");
      setSaveRoutineOpen(false);
    },
    onError: (err) => setError(err.message),
  });

  const minutes = Math.round(totals.durationMs / 60000);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 text-center">
        <Trophy className="mx-auto size-6 text-amber-500" aria-hidden />
        <p className="text-lg font-extrabold">Latihan selesai!</p>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="font-extrabold tabular-nums">{fmtInt(minutes)}</p>
            <p className="text-xs text-muted-foreground">menit</p>
          </div>
          <div>
            <p className="font-extrabold tabular-nums">{fmtInt(totals.volumeKg)}</p>
            <p className="text-xs text-muted-foreground">kg volume</p>
          </div>
          <div>
            <p className="font-extrabold tabular-nums">{totals.setsDone}</p>
            <p className="text-xs text-muted-foreground">set selesai</p>
          </div>
        </div>
      </Card>

      {localPrs.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-extrabold">Rekor baru</p>
          <ul className="space-y-1.5">
            {localPrs.map((pr, index) => (
              <li key={index} className="flex items-start gap-2 text-sm">
                <Trophy className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
                <span>
                  <span className="font-bold">{pr.exerciseName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {pr.label}: {pr.value}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3">
        <label className="block space-y-1.5">
          <FieldLabel>Nama sesi</FieldLabel>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel>Catatan (opsional)</FieldLabel>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Naikkan beban minggu depan"
          />
        </label>
      </Card>

      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      {saveRoutineOpen ? (
        <Card className="space-y-3">
          <p className="text-sm font-extrabold">Simpan sebagai rutinitas</p>
          <Input
            value={routineName}
            onChange={(event) => setRoutineName(event.target.value)}
            placeholder="Nama rutinitas"
            aria-label="Nama rutinitas"
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setSaveRoutineOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="flex-1"
              disabled={routineName.trim().length === 0 || saveRoutine.isPending}
              onClick={() => saveRoutine.mutate()}
            >
              {saveRoutine.isPending ? "Menyimpan…" : "Simpan rutinitas"}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          <Button
            className="w-full"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Menyimpan…" : "Simpan latihan"}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setSaveRoutineOpen(true)}
          >
            Simpan sebagai rutinitas
          </Button>
          <Link
            to="/latihan"
            className="block w-full rounded-full py-2 text-center text-sm font-semibold text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            onClick={onClose}
          >
            Buang perubahan dan kembali
          </Link>
        </div>
      )}
    </div>
  );
}
