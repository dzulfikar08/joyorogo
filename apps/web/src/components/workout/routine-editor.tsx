import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Card, FieldLabel } from "@/components/kit/surface";
import { exerciseColumns, makeSet } from "@/components/workout/active-store";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { SetTypeBadge } from "@/components/workout/set-type-menu";
import { fmtClock } from "@/components/workout/use-rest-timer";
import {
  type CatalogExercise,
  type Routine,
  type RoutineInput,
  type SetType,
  workoutApi,
  workoutQueryPrefix,
} from "@/lib/workout-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Timer, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { removeById, upsertById } from "@joyorogo/api/lib/optimistic";

import { useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { orpc } from "@/utils/orpc";

type RoutineExercise = RoutineInput["exercises"][number] & { uid: string };

type RoutineDraft = {
  id?: string;
  name: string;
  note: string;
  exercises: RoutineExercise[];
};

function draftFromRoutine(routine: Routine): RoutineDraft {
  return {
    id: routine.id,
    name: routine.name,
    note: routine.note ?? "",
    exercises: routine.exercises.map((item) => ({
      uid: Math.random().toString(36).slice(2, 10),
      exerciseId: item.exerciseId,
      restSec: item.restSec,
      note: item.note ?? "",
      sets: item.sets.map((set) => ({ ...set })),
    })),
  };
}

const REST_OPTIONS = [60, 90, 120, 180] as const;

/**
 * Create or edit a routine: name, exercises with target sets/reps/kg, rest,
 * and notes. "id" of "baru" starts a fresh draft.
 */
export function RoutineEditor({ routineId }: { routineId: string }) {
  const { t } = useTranslation(["olahraga", "common"]);
  const existing = useQuery({
    queryKey: [...workoutQueryPrefix, "routines"],
    queryFn: () => workoutApi.listRoutines(),
  });

  if (routineId !== "baru") {
    if (existing.isPending) {
      return <p className="p-6 text-sm text-muted-foreground">{t("common:state.loading")}</p>;
    }
    const routine = (existing.data ?? []).find((item) => item.id === routineId);
    if (!routine) {
      return <p className="p-6 text-sm text-muted-foreground">{t("latihan.routine.notFound")}</p>;
    }
    return <RoutineEditorForm key={routineId} initial={draftFromRoutine(routine)} />;
  }
  return (
    <RoutineEditorForm
      key="baru"
      initial={{ name: "", note: "", exercises: [] }}
    />
  );
}

function RoutineEditorForm({ initial }: { initial: RoutineDraft }) {
  const { t } = useTranslation(["olahraga", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const routineId = initial.id ?? "baru";
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });

  const [draft, setDraft] = useState<RoutineDraft>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalogById = useMemo(() => {
    const byId: Record<string, CatalogExercise> = {};
    for (const exercise of catalog.data?.exercises ?? []) byId[exercise.id] = exercise;
    return byId;
  }, [catalog.data]);

  // Optimistic routines-list upsert; undo re-saves the previous draft when
  // editing, or deletes the freshly created routine when new.
  const previousRoutine = useRef<Routine | null>(null);
  const save = useOptimisticMutation<RoutineInput, { id: string }>({
    mutationFn: (input) => workoutApi.saveRoutine(input),
    patch: (input, cache) => {
      const routines = queryClient.getQueryData<Routine[]>(["workout", "routines"]) ?? [];
      previousRoutine.current = routines.find((item) => item.id === (input.id ?? "")) ?? null;
      const provisional: Routine = {
        id: input.id ?? crypto.randomUUID(),
        name: input.name,
        note: input.note ?? null,
        exercises: input.exercises.map((item) => ({
          exerciseId: item.exerciseId,
          restSec: item.restSec ?? null,
          note: item.note ?? null,
          sets: item.sets,
        })),
        updatedAt: new Date().toISOString(),
      };
      cache.list<Routine>(["workout", "routines"], (rows) => upsertById(rows, provisional));
    },
    invalidate: () => [orpc.workout.key()],
    success: (input, data) => {
      void navigate({ to: "/latihan" });
      const prev = previousRoutine.current;
      previousRoutine.current = null;
      if (prev) {
        return {
          message: t("latihan.routine.toast.saved"),
          undo: () =>
            void workoutApi.saveRoutine({
              id: prev.id,
              name: prev.name,
              note: prev.note ?? undefined,
              exercises: prev.exercises.map((item) => ({
                exerciseId: item.exerciseId,
                restSec: item.restSec,
                note: item.note ?? undefined,
                sets: item.sets,
              })),
            }),
        };
      }
      return {
        message: t("latihan.routine.toast.saved"),
        undo: () => void workoutApi.deleteRoutine({ id: data.id }),
      };
    },
    onError: (err) => setError(err.message),
  });

  // Delayed-commit delete: gone from the list instantly, DELETE after the
  // undo window; undo restores and never calls the server.
  const removeRoutine = useDelayedDelete<Routine>({
    remove: (row) => workoutApi.deleteRoutine({ id: row.id }),
    patch: (row, cache) => {
      cache.list<Routine>(["workout", "routines"], (rows) => removeById(rows, row.id));
    },
    label: (row) => row.name,
    fallback: t("latihan.routine.fallbackName"),
    invalidate: () => [orpc.workout.key()],
  });

  const addExercises = (picked: CatalogExercise[]) => {
    setDraft((prev) => ({
      ...prev,
      exercises: [
        ...prev.exercises,
        ...picked.map((exercise) => ({
          uid: Math.random().toString(36).slice(2, 10),
          exerciseId: exercise.id,
          restSec: exerciseColumns(exercise.type).duration ? null : 90,
          sets: [{ setType: "normal" as SetType, reps: 10, weightKg: null, durationSec: null }],
        })),
      ],
    }));
  };

  const patchExercise = (uid: string, changes: Partial<RoutineExercise>) => {
    setDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((item) => (item.uid === uid ? { ...item, ...changes } : item)),
    }));
  };

  const submit = () => {
    if (draft.name.trim().length === 0) {
      setError(t("latihan.routine.error.name"));
      return;
    }
    if (draft.exercises.length === 0) {
      setError(t("latihan.routine.error.exercise"));
      return;
    }
    setError(null);
    save.mutate({
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim(),
      note: draft.note.trim() || undefined,
      exercises: draft.exercises.map((item) => ({
        exerciseId: item.exerciseId,
        restSec: item.restSec,
        note: item.note || undefined,
        sets: item.sets,
      })),
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-5">
      <Card className="space-y-3">
        <label className="block space-y-1.5">
          <FieldLabel>{t("latihan.routine.name")}</FieldLabel>
          <Input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder={t("latihan.routine.namePlaceholder")}
          />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel>{t("latihan.field.noteOptional")}</FieldLabel>
          <Input
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            placeholder={t("latihan.routine.notePlaceholder")}
          />
        </label>
      </Card>

      <div className="mt-3 space-y-3">
        {draft.exercises.map((item) => {
          const type = catalogById[item.exerciseId]?.type ?? "weight_reps";
          const columns = exerciseColumns(type);
          return (
            <section
              key={item.uid}
              className="overflow-hidden rounded-2xl border border-border bg-card"
              aria-label={catalogById[item.exerciseId]?.name ?? item.exerciseId}
            >
              <div className="flex items-center gap-1 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-sm font-extrabold">
                  {catalogById[item.exerciseId]?.name ?? item.exerciseId}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const idx = REST_OPTIONS.indexOf((item.restSec ?? -1) as (typeof REST_OPTIONS)[number]);
                    patchExercise(item.uid, {
                      restSec: item.restSec === null ? REST_OPTIONS[0] : idx === REST_OPTIONS.length - 1 ? null : REST_OPTIONS[idx + 1],
                    });
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-label={t("latihan.active.aria.rest", {
                    value: item.restSec ? fmtClock(item.restSec) : t("latihan.active.rest.off"),
                  })}
                >
                  <Timer className="size-3.5" aria-hidden />
                  {item.restSec ? fmtClock(item.restSec) : t("latihan.active.rest.off")}
                </button>
              </div>

              <div
                className={`grid items-center gap-1.5 border-t border-border px-3 py-1.5 text-[0.6875rem] font-bold tracking-wide text-muted-foreground uppercase ${
                  columns.duration
                    ? "grid-cols-[2.25rem_1fr_1fr_2.25rem]"
                    : "grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem]"
                }`}
              >
                <span>{t("latihan.active.col.set")}</span>
                <span>{t("latihan.active.col.target")}</span>
                {columns.duration ? (
                  <span>{t("latihan.active.col.seconds")}</span>
                ) : (
                  <span>{t("latihan.active.col.kg")}</span>
                )}
                {!columns.duration && <span>{t("latihan.active.col.reps")}</span>}
                <span />
              </div>

              {item.sets.map((set, setIndex) => (
                <div
                  key={setIndex}
                  className={`grid items-center gap-1.5 border-t border-border px-3 py-1.5 ${
                    columns.duration
                      ? "grid-cols-[2.25rem_1fr_1fr_2.25rem]"
                      : "grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem]"
                  }`}
                >
                  <SetTypeBadge
                    index={setIndex}
                    setType={set.setType}
                    onChange={(next) =>
                      patchExercise(item.uid, {
                        sets: item.sets.map((s, i) => (i === setIndex ? { ...s, setType: next } : s)),
                      })
                    }
                  />
                  {columns.duration ? (
                    <Input
                      data-field
                      inputMode="numeric"
                      className="h-9 text-sm"
                      value={set.durationSec ?? ""}
                      onChange={(event) =>
                        patchExercise(item.uid, {
                          sets: item.sets.map((s, i) =>
                            i === setIndex
                              ? { ...s, durationSec: event.target.value === "" ? null : Number(event.target.value) }
                              : s,
                          ),
                        })
                      }
                      placeholder="60"
                      aria-label={t("latihan.active.aria.setDuration", { n: setIndex + 1 })}
                    />
                  ) : (
                    <>
                      <Input
                        data-field
                        inputMode="decimal"
                        className="h-9 text-sm"
                        value={set.weightKg ?? ""}
                        onChange={(event) =>
                          patchExercise(item.uid, {
                            sets: item.sets.map((s, i) =>
                              i === setIndex
                                ? { ...s, weightKg: event.target.value === "" ? null : Number(event.target.value) }
                                : s,
                            ),
                          })
                        }
                        placeholder="0"
                        aria-label={t("latihan.active.aria.setWeight", { n: setIndex + 1 })}
                      />
                      <Input
                        data-field
                        inputMode="numeric"
                        className="h-9 text-sm"
                        value={set.reps ?? ""}
                        onChange={(event) =>
                          patchExercise(item.uid, {
                            sets: item.sets.map((s, i) =>
                              i === setIndex
                                ? { ...s, reps: event.target.value === "" ? null : Number(event.target.value) }
                                : s,
                            ),
                          })
                        }
                        placeholder="10"
                        aria-label={t("latihan.active.aria.setReps", { n: setIndex + 1 })}
                      />
                    </>
                  )}
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      disabled={item.sets.length <= 1}
                      onClick={() =>
                        patchExercise(item.uid, {
                          sets: item.sets.filter((_, i) => i !== setIndex),
                        })
                      }
                      aria-label={t("latihan.active.aria.removeSet", { n: setIndex + 1 })}
                      className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    patchExercise(item.uid, {
                      sets: [...item.sets, { ...(item.sets[item.sets.length - 1] ?? makeSet()) }],
                    })
                  }
                >
                  <Plus className="size-4" aria-hidden /> {t("latihan.action.addSet")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      exercises: prev.exercises.filter((ex) => ex.uid !== item.uid),
                    }))
                  }
                >
                  <Trash2 className="size-4" aria-hidden /> {t("common:actions.delete")}
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      <Button variant="secondary" className="mt-3 w-full" onClick={() => setPickerOpen(true)}>
        <Plus className="size-4" aria-hidden /> {t("latihan.action.addExercise")}
      </Button>

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {draft.id && (
          <Button
            variant="secondary"
            className="flex-1 text-destructive"
            onClick={() => {
              const row = (queryClient.getQueryData<Routine[]>(["workout", "routines"]) ?? []).find(
                (item) => item.id === routineId,
              );
              if (!row) return;
              void navigate({ to: "/latihan" });
              removeRoutine(row);
            }}
          >
            {t("latihan.routine.delete")}
          </Button>
        )}
        <Button className="flex-1" disabled={save.isPending} onClick={submit}>
          {save.isPending ? t("latihan.summary.saving") : t("latihan.routine.save")}
        </Button>
      </div>

      <ExercisePicker open={pickerOpen} onOpenChange={setPickerOpen} onAdd={addExercises} />
    </div>
  );
}
