import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { Card, FieldLabel, SectionTitle } from "@/components/kit/surface";
import type { CatalogExercise, WorkoutSessionItem } from "@/lib/api-types";
import { fmtInt, parseNum } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { sessionKcal } from "@joyorogo/api/lib/workout";

/** One editable set; strings because the inputs own the draft values. */
export type EditorSet = { reps: string; weightKg: string; rpe: string };
export type EditorExercise = { exerciseId: string; name: string; sets: EditorSet[] };
export type SessionDraft = {
  id?: string;
  date: string;
  name: string;
  durationMin: string;
  note: string;
  exercises: EditorExercise[];
};

const emptySet: EditorSet = { reps: "", weightKg: "", rpe: "" };

/** Template presets arrive with target reps and no weight yet. */
export function draftFromTemplate(
  templateId: string,
  templates: { id: string; name: string; exercises: { exerciseId: string; sets: number; targetReps: number }[] }[],
  nameOf: (exerciseId: string) => string,
): SessionDraft | null {
  const template = templates.find((t) => t.id === templateId);
  if (!template) return null;
  return {
    date: jakartaToday(),
    name: template.name,
    durationMin: "45",
    note: "",
    exercises: template.exercises.map((item) => ({
      exerciseId: item.exerciseId,
      name: nameOf(item.exerciseId),
      sets: Array.from({ length: item.sets }, () => ({
        reps: String(item.targetReps),
        weightKg: "",
        rpe: "",
      })),
    })),
  };
}

/** "Ulangi sesi terakhir" — same movements and sets, new session. */
export function draftFromSession(item: WorkoutSessionItem): SessionDraft {
  const grouped = new Map<string, EditorExercise>();
  for (const set of item.sets) {
    let exercise = grouped.get(set.exerciseId);
    if (!exercise) {
      exercise = { exerciseId: set.exerciseId, name: set.exerciseId, sets: [] };
      grouped.set(set.exerciseId, exercise);
    }
    exercise.sets.push({
      reps: String(set.reps),
      weightKg: set.weightKg != null ? String(set.weightKg) : "",
      rpe: set.rpe != null ? String(set.rpe) : "",
    });
  }
  return {
    date: jakartaToday(),
    name: item.session.name,
    durationMin: item.session.durationMin != null ? String(item.session.durationMin) : "",
    note: item.session.note ?? "",
    exercises: [...grouped.values()],
  };
}

function setsValid(exercises: EditorExercise[]): boolean {
  return exercises.every((exercise) =>
    exercise.sets.every((set) => (parseNum(set.reps) ?? 0) >= 1),
  );
}

export function SessionEditor({ draft, onClose }: { draft: SessionDraft; onClose: () => void }) {
  const queryClient = useQueryClient();
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const [state, setState] = useState<SessionDraft>(() => {
    // Drafts carry ids only; resolve display names from the catalog.
    const nameOf = (id: string) =>
      catalog.data?.exercises.find((e) => e.id === id)?.name ?? id;
    return {
      ...draft,
      exercises: draft.exercises.map((exercise) => ({
        ...exercise,
        name: exercise.name || nameOf(exercise.exerciseId),
      })),
    };
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weightKg = profile.data?.latestWeightKg ?? null;

  const save = useMutation(
    orpc.workout.saveSession.mutationOptions({
      onSuccess: () => {
        toast.success("Sesi latihan tersimpan.");
        queryClient.invalidateQueries({ queryKey: orpc.workout.key() });
        queryClient.invalidateQueries({ queryKey: orpc.day.key() });
        queryClient.invalidateQueries({ queryKey: orpc.exercise.key() });
        onClose();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const kcalEstimate = useMemo(() => {
    const minutes = parseNum(state.durationMin);
    if (minutes === null || weightKg === null) return null;
    return sessionKcal(minutes, weightKg);
  }, [state.durationMin, weightKg]);

  const patchExercise = (index: number, sets: EditorSet[]) => {
    setState((prev) => ({
      ...prev,
      exercises: prev.exercises.map((exercise, i) =>
        i === index ? { ...exercise, sets } : exercise,
      ),
    }));
  };

  const addExercise = (exercise: CatalogExercise) => {
    setState((prev) => ({
      ...prev,
      exercises: [
        ...prev.exercises,
        { exerciseId: exercise.id, name: exercise.name, sets: [{ ...emptySet }] },
      ],
    }));
  };

  const removeExercise = (index: number) => {
    setState((prev) => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== index),
    }));
  };

  const submit = () => {
    if (state.name.trim().length === 0) {
      setError("Beri nama sesinya dulu, mis. Push Senin.");
      return;
    }
    if (state.exercises.length === 0) {
      setError("Tambahkan minimal satu gerakan.");
      return;
    }
    if (!setsValid(state.exercises)) {
      setError("Semua set butuh repetisi (angka).");
      return;
    }
    setError(null);
    const duration = parseNum(state.durationMin);
    save.mutate({
      ...(state.id ? { id: state.id } : {}),
      date: state.date,
      name: state.name.trim(),
      durationMin: duration !== null ? Math.max(1, Math.round(duration)) : undefined,
      note: state.note.trim().length > 0 ? state.note.trim() : undefined,
      sets: state.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => ({
          exerciseId: exercise.exerciseId,
          reps: Math.round(parseNum(set.reps) ?? 0),
          weightKg: parseNum(set.weightKg),
          rpe: parseNum(set.rpe),
        })),
      ),
    });
  };

  return (
    <Card className="space-y-4">
      <SectionTitle
        action={
          <Button variant="secondary" size="sm" onClick={onClose}>
            Tutup
          </Button>
        }
      >
        {state.id ? "Edit sesi" : "Sesi baru"}
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 space-y-1.5">
          <FieldLabel>Nama sesi</FieldLabel>
          <Input
            value={state.name}
            onChange={(e) => setState((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Push Senin"
          />
        </label>
        <label className="space-y-1.5">
          <FieldLabel>Tanggal</FieldLabel>
          <Input
            type="date"
            value={state.date}
            max={jakartaToday()}
            onChange={(e) => setState((prev) => ({ ...prev, date: e.target.value }))}
          />
        </label>
        <label className="space-y-1.5">
          <FieldLabel>Durasi (menit)</FieldLabel>
          <Input
            inputMode="numeric"
            value={state.durationMin}
            onChange={(e) => setState((prev) => ({ ...prev, durationMin: e.target.value }))}
            placeholder="45"
          />
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {kcalEstimate !== null
          ? `Perkiraan ${fmtInt(kcalEstimate)} kcal masuk ke angka bakar saat disimpan.`
          : "Isi durasi untuk perkiraan kalori."}
      </p>

      {state.exercises.map((exercise, exerciseIndex) => (
        <div
          key={`${exercise.exerciseId}-${exerciseIndex}`}
          className="rounded-2xl border border-border p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">{exercise.name}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeExercise(exerciseIndex)}
              aria-label={`Hapus ${exercise.name}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-[1.5rem_1fr_1fr_1fr_2rem] items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
            <span>Set</span>
            <span>Reps</span>
            <span>Kg</span>
            <span>RPE</span>
            <span />
          </div>
          {exercise.sets.map((set, setIndex) => (
            <div
              key={setIndex}
              className="mt-1 grid grid-cols-[1.5rem_1fr_1fr_1fr_2rem] items-center gap-2"
            >
              <span className="text-sm font-bold text-muted-foreground tabular-nums">
                {setIndex + 1}
              </span>
              <Input
                inputMode="numeric"
                value={set.reps}
                onChange={(e) =>
                  patchExercise(
                    exerciseIndex,
                    exercise.sets.map((s, i) =>
                      i === setIndex ? { ...s, reps: e.target.value } : s,
                    ),
                  )
                }
                placeholder="10"
                aria-label={`Set ${setIndex + 1} repetisi`}
              />
              <Input
                inputMode="decimal"
                value={set.weightKg}
                onChange={(e) =>
                  patchExercise(
                    exerciseIndex,
                    exercise.sets.map((s, i) =>
                      i === setIndex ? { ...s, weightKg: e.target.value } : s,
                    ),
                  )
                }
                placeholder="40"
                aria-label={`Set ${setIndex + 1} beban kg`}
              />
              <Input
                inputMode="decimal"
                value={set.rpe}
                onChange={(e) =>
                  patchExercise(
                    exerciseIndex,
                    exercise.sets.map((s, i) => (i === setIndex ? { ...s, rpe: e.target.value } : s)),
                  )
                }
                placeholder="–"
                aria-label={`Set ${setIndex + 1} RPE`}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patchExercise(exerciseIndex, exercise.sets.filter((_, i) => i !== setIndex))
                }
                disabled={exercise.sets.length <= 1}
                aria-label={`Hapus set ${setIndex + 1}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => patchExercise(exerciseIndex, [...exercise.sets, { ...emptySet }])}
          >
            <Plus className="size-4" aria-hidden /> Tambah set
          </Button>
        </div>
      ))}

      <Button variant="secondary" className="w-full" onClick={() => setPickerOpen(true)}>
        <Plus className="size-4" aria-hidden /> Tambah gerakan
      </Button>

      <label className="space-y-1.5">
        <FieldLabel>Catatan (opsional)</FieldLabel>
        <Input
          value={state.note}
          onChange={(e) => setState((prev) => ({ ...prev, note: e.target.value }))}
          placeholder="Naikkan beban squat 2,5 kg minggu depan"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <Button className="w-full" onClick={submit} disabled={save.isPending}>
        {save.isPending ? "Menyimpan…" : "Simpan sesi"}
      </Button>

      <ExercisePicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={addExercise} />
    </Card>
  );
}
