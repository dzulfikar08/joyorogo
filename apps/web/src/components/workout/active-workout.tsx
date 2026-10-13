import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Chip } from "@/components/chip";
import {
  type ActiveExercise,
  type ActiveSet,
  type ActiveWorkout,
  exerciseColumns,
  loadActive,
  makeSet,
  rememberExercises,
  saveActive,
} from "@/components/workout/active-store";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { SetTypeBadge } from "@/components/workout/set-type-menu";
import { useRestTimer, fmtClock, fmtElapsed } from "@/components/workout/use-rest-timer";
import {
  type CatalogExercise,
  workoutApi,
  workoutQueryPrefix,
} from "@/lib/workout-contract";
import { fmtInt, parseNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Link2,
  MoreVertical,
  Plus,
  Repeat,
  StickyNote,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { WorkoutSummary, computeTotals, type FinishedSet } from "@/components/workout/workout-summary";

const REST_OPTIONS = [60, 90, 120, 180] as const;

const setTypeFill = (set: { reps: number | null; weightKg: number | null; durationSec: number | null }) => ({
  reps: set.reps != null ? String(set.reps) : "",
  weightKg: set.weightKg != null ? String(set.weightKg) : "",
  durationSec: set.durationSec != null ? String(set.durationSec) : "",
});

function previousLabel(
  entry: { reps: number | null; weightKg: number | null; durationSec: number | null } | undefined,
  columns: { weight: boolean; reps: boolean; duration: boolean },
): string {
  if (!entry) return "–";
  if (columns.duration) {
    return entry.durationSec != null ? fmtClock(entry.durationSec) : "–";
  }
  const reps = entry.reps != null ? `${entry.reps}` : "?";
  if (columns.weight) {
    return entry.weightKg != null ? `${fmtInt(entry.weightKg)} kg × ${reps}` : `${reps}× BW`;
  }
  return `${reps}× BW`;
}

/**
 * Hevy-style active workout: live timer, set table with previous column,
 * check-to-done with rest timer, all persisted locally until saved.
 */
export function ActiveWorkoutScreen({ resume }: { resume: ActiveWorkout | null }) {
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });
  const [workout, setWorkout] = useState<ActiveWorkout>(
    () => resume ?? loadActive() ?? { name: "", note: "", startedAt: new Date().toISOString(), exercises: [] },
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replaceUid, setReplaceUid] = useState<string | null>(null);
  const [menuUid, setMenuUid] = useState<string | null>(null);
  const [finishState, setFinishState] = useState<"idle" | "confirm" | "done">("idle");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [finished, setFinished] = useState<FinishedSet[][]>([]);
  const [now, setNow] = useState(() => Date.now());
  const rest = useRestTimer();
  const rootRef = useRef<HTMLDivElement>(null);

  const catalogById = useMemo(() => {
    const byId: Record<string, CatalogExercise> = {};
    for (const exercise of catalog.data?.exercises ?? []) byId[exercise.id] = exercise;
    return byId;
  }, [catalog.data]);

  const typeOf = useCallback(
    (exerciseId: string) => catalogById[exerciseId]?.type ?? ("weight_reps" as const),
    [catalogById],
  );
  const nameOf = useCallback(
    (exerciseId: string) => catalogById[exerciseId]?.name ?? exerciseId,
    [catalogById],
  );

  const exerciseIds = useMemo(
    () => [...new Set(workout.exercises.map((exercise) => exercise.exerciseId))],
    [workout.exercises],
  );
  const previous = useQuery({
    queryKey: [...workoutQueryPrefix, "previous", exerciseIds],
    queryFn: () => workoutApi.previous({ exerciseIds }),
  });

  // Live duration timer while the workout is running.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Persist after every change: refresh or app kill resumes cleanly.
  useEffect(() => {
    saveActive(workout);
  }, [workout]);

  const patch = useCallback((updater: (prev: ActiveWorkout) => ActiveWorkout) => {
    setWorkout(updater);
  }, []);

  const patchExercise = (uid: string, updater: (exercise: ActiveExercise) => ActiveExercise) => {
    patch((prev) => ({
      ...prev,
      exercises: prev.exercises.map((exercise) => (exercise.uid === uid ? updater(exercise) : exercise)),
    }));
  };

  const patchSet = (uid: string, setId: string, changes: Partial<ActiveSet>) => {
    patchExercise(uid, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => (set.id === setId ? { ...set, ...changes } : set)),
    }));
  };

  const addExercises = (picked: CatalogExercise[]) => {
    if (replaceUid) {
      const target = replaceUid;
      const first = picked[0];
      patch((prev) => ({
        ...prev,
        exercises: prev.exercises.map((exercise) =>
          exercise.uid === target
            ? {
                ...exercise,
                exerciseId: first.id,
                sets: exercise.sets.map((set) => ({ ...set, ...setTypeFill({ reps: null, weightKg: null, durationSec: null }) })),
              }
            : exercise,
        ),
      }));
      setReplaceUid(null);
      return;
    }
    rememberExercises(picked.map((exercise) => exercise.id));
    patch((prev) => ({
      ...prev,
      exercises: [
        ...prev.exercises,
        ...picked.map((exercise) => ({
          uid: Math.random().toString(36).slice(2, 10),
          exerciseId: exercise.id,
          note: "",
          restSec: exerciseColumns(exercise.type).duration ? null : 90,
          supersetGroup: null,
          sets: [makeSet()],
        })),
      ],
    }));
  };

  const toggleSuperset = (index: number) => {
    const exercise = workout.exercises[index];
    const next = workout.exercises[index + 1];
    if (!next) {
      toast.info("Tidak ada latihan berikutnya untuk dipasangkan.");
      return;
    }
    const group =
      exercise.supersetGroup !== null && exercise.supersetGroup === next.supersetGroup
        ? null
        : (Math.max(-1, ...workout.exercises.map((item) => item.supersetGroup ?? -1)) + 1);
    patch((prev) => ({
      ...prev,
      exercises: prev.exercises.map((item, i) =>
        i === index || i === index + 1 ? { ...item, supersetGroup: group } : item,
      ),
    }));
  };

  const moveExercise = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= workout.exercises.length) return;
    patch((prev) => {
      const exercises = [...prev.exercises];
      [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
      return { ...prev, exercises };
    });
  };

  const removeExercise = (uid: string) => {
    patch((prev) => ({ ...prev, exercises: prev.exercises.filter((item) => item.uid !== uid) }));
  };

  const cycleRest = (exercise: ActiveExercise) => {
    if (exercise.restSec === null) {
      patchExercise(exercise.uid, (item) => ({ ...item, restSec: REST_OPTIONS[0] }));
      return;
    }
    const idx = REST_OPTIONS.indexOf(exercise.restSec as (typeof REST_OPTIONS)[number]);
    patchExercise(exercise.uid, (item) => ({
      ...item,
      restSec: idx === REST_OPTIONS.length - 1 ? null : REST_OPTIONS[idx + 1],
    }));
  };

  const checkSet = (exercise: ActiveExercise, set: ActiveSet) => {
    const willBeDone = !set.done;
    patchSet(exercise.uid, set.id, { done: willBeDone });
    if (willBeDone && exercise.restSec) rest.start(exercise.restSec);
  };

  const fillFromPrevious = (exercise: ActiveExercise, setIndex: number) => {
    const entry = (previous.data?.[exercise.exerciseId] ?? [])[setIndex];
    if (!entry) return;
    patchExercise(exercise.uid, (item) => ({
      ...item,
      sets: item.sets.map((set, i) => (i === setIndex ? { ...set, ...setTypeFill(entry) } : set)),
    }));
  };

  const addSet = (exercise: ActiveExercise) => {
    const last = exercise.sets[exercise.sets.length - 1];
    patchExercise(exercise.uid, (item) => ({
      ...item,
      sets: [
        ...item.sets,
        makeSet({
          setType: last?.setType ?? "normal",
          reps: last?.reps ?? "",
          weightKg: last?.weightKg ?? "",
          durationSec: last?.durationSec ?? "",
        }),
      ],
    }));
  };

  /** Enter inside a set field jumps to the next field, like a spreadsheet. */
  const onFieldKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const fields = Array.from(
      rootRef.current?.querySelectorAll<HTMLInputElement>("input[data-field]") ?? [],
    );
    const idx = fields.findIndex((field) => field === event.currentTarget);
    fields[idx + 1]?.focus();
  };

  const startFinish = () => {
    const hasDone = workout.exercises.some((exercise) => exercise.sets.some((set) => set.done));
    if (!hasDone) {
      toast.error("Centang minimal satu set dulu sebelum selesai.");
      return;
    }
    // Server rules: reps >= 1 for rep types, durationSec >= 1 for timed types.
    for (const exercise of workout.exercises) {
      const timed = exerciseColumns(typeOf(exercise.exerciseId)).duration;
      const bad = exercise.sets.find((set) => {
        if (!set.done) return false;
        const seconds = parseNum(set.durationSec);
        const reps = parseNum(set.reps);
        return timed ? seconds === null || seconds < 1 : reps === null || reps < 1;
      });
      if (bad) {
        toast.error(
          `${nameOf(exercise.exerciseId)}: isi ${timed ? "durasi (detik)" : "repetisi"} pada set yang dicentang.`,
        );
        return;
      }
    }
    const unchecked = workout.exercises.some((exercise) =>
      exercise.sets.some((set) => !set.done),
    );
    if (unchecked && finishState !== "confirm") {
      setFinishState("confirm");
      return;
    }
    const snapshot: FinishedSet[][] = workout.exercises.map((exercise) =>
      exercise.sets
        .filter((set) => set.done)
        .map((set) => ({
          exerciseId: exercise.exerciseId,
          setType: set.setType,
          reps: exerciseColumns(typeOf(exercise.exerciseId)).reps ? Math.round(parseNum(set.reps) ?? 0) : null,
          weightKg: parseNum(set.weightKg),
          durationSec: parseNum(set.durationSec),
        })),
    );
    setFinished(snapshot);
    setFinishState("done");
  };

  const finishAndClose = () => {
    rememberExercises(exerciseIds);
    localStorage.removeItem("jrg-active-workout");
    void navigate({ to: "/latihan" });
  };

  const discard = () => {
    localStorage.removeItem("jrg-active-workout");
    void navigate({ to: "/latihan" });
  };

  if (finishState === "done") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-5">
        <WorkoutSummary
          workout={workout}
          finished={finished}
          totals={computeTotals(workout, now)}
          nameOf={nameOf}
          onClose={finishAndClose}
        />
      </div>
    );
  }

  const totals = computeTotals(workout, now);

  // Group id → letter, in order of first appearance (A, B, C…).
  const supersetLetters = ["A", "B", "C", "D", "E", "F"];
  const supersetOrder: Record<number, string> = {};
  let nextGroup = 0;
  for (const item of workout.exercises) {
    if (item.supersetGroup !== null && !(item.supersetGroup in supersetOrder)) {
      supersetOrder[item.supersetGroup] = supersetLetters[nextGroup] ?? "?";
      nextGroup += 1;
    }
  }

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-xl px-4 pt-4 pb-40">
      {/* Header: live stats + finish */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums">
            <Timer className="size-4 text-muted-foreground" aria-hidden />
            {fmtElapsed(totals.durationMs)}
          </div>
          <div className="text-sm font-bold tabular-nums">{fmtInt(totals.volumeKg)} kg</div>
          <div className="text-sm font-bold tabular-nums">
            {totals.setsDone}/{totals.setsTotal} set
          </div>
          <Button className="ml-auto" size="sm" onClick={startFinish}>
            Selesai
          </Button>
          <button
            type="button"
            aria-label="Buang latihan"
            onClick={() => {
              if (discardConfirm) discard();
              else setDiscardConfirm(true);
            }}
            onBlur={() => setDiscardConfirm(false)}
            className={`rounded-full p-2 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none ${
              discardConfirm ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <MoreVertical className="size-4" aria-hidden />
          </button>
        </div>
        {finishState === "confirm" && (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm">
            <span className="flex-1">Masih ada set yang belum dicentang. Tetap selesai?</span>
            <Button size="sm" variant="secondary" onClick={() => setFinishState("idle")}>
              Periksa
            </Button>
            <Button size="sm" onClick={startFinish}>
              Tetap selesai
            </Button>
          </div>
        )}
      </div>

      {workout.exercises.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Sesi masih kosong. Tambah latihan pertamamu di bawah.
        </p>
      )}

      <div className="space-y-3">
        {workout.exercises.map((exercise, exerciseIndex) => {
          const type = typeOf(exercise.exerciseId);
          const columns = exerciseColumns(type);
          const prev = previous.data?.[exercise.exerciseId] ?? [];
          const isOpen = menuUid === exercise.uid;
          const letter =
            exercise.supersetGroup !== null ? supersetOrder[exercise.supersetGroup] : null;

          return (
            <section
              key={exercise.uid}
              className="overflow-hidden rounded-2xl border border-border bg-card"
              aria-label={nameOf(exercise.exerciseId)}
            >
              <div className="flex items-center gap-1 px-3 py-2">
                {letter && (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                    {letter}
                  </span>
                )}
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm font-extrabold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  onClick={() => setMenuUid(isOpen ? null : exercise.uid)}
                >
                  {nameOf(exercise.exerciseId)}
                  <ChevronDown className="ml-1 inline size-3.5 text-muted-foreground" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => cycleRest(exercise)}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-label={`Timer istirahat: ${exercise.restSec ? fmtClock(exercise.restSec) : "mati"}. Ketuk untuk ganti.`}
                >
                  <Timer className="size-3.5" aria-hidden />
                  {exercise.restSec ? fmtClock(exercise.restSec) : "off"}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-border bg-muted/30 px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Chip onClick={() => { setReplaceUid(exercise.uid); setMenuUid(null); setPickerOpen(true); }}>
                      <Repeat className="mr-1 inline size-3.5" aria-hidden /> Ganti latihan
                    </Chip>
                    <Chip
                      active={exercise.note.trim().length > 0}
                      onClick={() =>
                        patchExercise(exercise.uid, (item) => ({
                          ...item,
                          note: item.note.trim().length > 0 ? "" : " ",
                        }))
                      }
                    >
                      <StickyNote className="mr-1 inline size-3.5" aria-hidden /> Catatan
                    </Chip>
                    <Chip
                      active={
                        exercise.supersetGroup !== null &&
                        workout.exercises[exerciseIndex + 1]?.supersetGroup === exercise.supersetGroup
                      }
                      onClick={() => toggleSuperset(exerciseIndex)}
                    >
                      <Link2 className="mr-1 inline size-3.5" aria-hidden /> Superset
                    </Chip>
                    <Chip onClick={() => moveExercise(exerciseIndex, -1)} disabled={exerciseIndex === 0}>
                      <ArrowUp className="size-3.5" aria-hidden /> Naik
                    </Chip>
                    <Chip
                      onClick={() => moveExercise(exerciseIndex, 1)}
                      disabled={exerciseIndex === workout.exercises.length - 1}
                    >
                      <ArrowDown className="size-3.5" aria-hidden /> Turun
                    </Chip>
                    <Chip
                      onClick={() => {
                        removeExercise(exercise.uid);
                        setMenuUid(null);
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-1 inline size-3.5" aria-hidden /> Hapus
                    </Chip>
                  </div>
                  <label className="mt-2 block">
                    <span className="sr-only">Catatan latihan</span>
                    <Input
                      value={exercise.note.trim()}
                      onChange={(event) =>
                        patchExercise(exercise.uid, (item) => ({ ...item, note: event.target.value }))
                      }
                      placeholder="Catatan: mis. fokus kencangkan scapula"
                    />
                  </label>
                </div>
              )}

              {/* Column headers */}
              <div
                className={`grid items-center gap-1.5 border-t border-border px-3 py-1.5 text-[0.6875rem] font-bold tracking-wide text-muted-foreground uppercase ${
                  columns.duration
                    ? "grid-cols-[2.25rem_1fr_1fr_2.25rem]"
                    : "grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem]"
                }`}
              >
                <span>Set</span>
                <span>Sebelumnya</span>
                {columns.duration ? <span>Detik</span> : <span>Kg</span>}
                {!columns.duration && <span>Reps</span>}
                <span />
              </div>

              {exercise.sets.map((set, setIndex) => (
                <div
                  key={set.id}
                  className={`grid items-center gap-1.5 border-t border-border px-3 py-1.5 ${
                    columns.duration
                      ? "grid-cols-[2.25rem_1fr_1fr_2.25rem]"
                      : "grid-cols-[2.25rem_1fr_1fr_1fr_2.25rem]"
                  } ${set.done ? "bg-primary/5" : ""}`}
                >
                  <SetTypeBadge
                    index={setIndex}
                    setType={set.setType}
                    done={set.done}
                    onChange={(next) => patchSet(exercise.uid, set.id, { setType: next })}
                  />
                  <button
                    type="button"
                    className="truncate text-left text-xs text-muted-foreground tabular-nums focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                    onClick={() => fillFromPrevious(exercise, setIndex)}
                    aria-label={`Isi dari sesi sebelumnya: ${previousLabel(prev[setIndex], columns)}`}
                  >
                    {previousLabel(prev[setIndex], columns)}
                  </button>
                  {columns.duration ? (
                    <Input
                      data-field
                      inputMode="decimal"
                      className="h-9 text-sm"
                      value={set.durationSec}
                      onChange={(event) =>
                        patchSet(exercise.uid, set.id, { durationSec: event.target.value })
                      }
                      onKeyDown={onFieldKeyDown}
                      placeholder="60"
                      aria-label={`Set ${setIndex + 1} durasi detik`}
                    />
                  ) : (
                    <>
                      <Input
                        data-field
                        inputMode="decimal"
                        className="h-9 text-sm"
                        value={set.weightKg}
                        onChange={(event) =>
                          patchSet(exercise.uid, set.id, { weightKg: event.target.value })
                        }
                        onKeyDown={onFieldKeyDown}
                        placeholder={prev[setIndex]?.weightKg != null ? String(prev[setIndex]!.weightKg) : "0"}
                        aria-label={`Set ${setIndex + 1} beban kg`}
                      />
                      <Input
                        data-field
                        inputMode="numeric"
                        className="h-9 text-sm"
                        value={set.reps}
                        onChange={(event) => patchSet(exercise.uid, set.id, { reps: event.target.value })}
                        onKeyDown={onFieldKeyDown}
                        placeholder={prev[setIndex]?.reps != null ? String(prev[setIndex]!.reps) : "0"}
                        aria-label={`Set ${setIndex + 1} repetisi`}
                      />
                    </>
                  )}
                  <div className="flex items-center justify-center">
                    {set.done ? (
                      <button
                        type="button"
                        onClick={() => checkSet(exercise, set)}
                        aria-label={`Batalkan set ${setIndex + 1}`}
                        className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        <Check className="size-4" aria-hidden />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => checkSet(exercise, set)}
                        aria-label={`Tandai set ${setIndex + 1} selesai`}
                        className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        <Check className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                <Button variant="secondary" size="sm" onClick={() => addSet(exercise)}>
                  <Plus className="size-4" aria-hidden /> Tambah set
                </Button>
                {exercise.sets.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Hapus set terakhir"
                    onClick={() =>
                      patchExercise(exercise.uid, (item) => ({ ...item, sets: item.sets.slice(0, -1) }))
                    }
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                )}
                {letter && exercise.supersetGroup !== null && (
                  <span className="ml-auto text-xs font-semibold text-muted-foreground">
                    Superset {letter}
                  </span>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Bottom bar: add exercise + rest timer */}
      <div className="fixed inset-x-0 bottom-16 z-20 mx-auto w-full max-w-xl px-4 md:bottom-4">
        {rest.remaining !== null && (
          <div className="mb-2 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-float">
            <span className="text-2xl font-extrabold tabular-nums" aria-live="polite">
              {fmtClock(rest.remaining)}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => rest.adjust(-15)}>
                −15s
              </Button>
              <Button variant="secondary" size="sm" onClick={() => rest.adjust(15)}>
                +15s
              </Button>
              <Button variant="ghost" size="sm" onClick={rest.stop} aria-label="Lewati istirahat">
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
        <Button variant="secondary" className="w-full shadow-float" onClick={() => setPickerOpen(true)}>
          <Plus className="size-4" aria-hidden /> Tambah latihan
        </Button>
      </div>

      <ExercisePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onAdd={addExercises}
        title={replaceUid ? "Ganti latihan" : "Tambah latihan"}
      />
    </div>
  );
}
