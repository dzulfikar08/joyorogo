import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { Card, FieldLabel } from "@/components/kit/surface";
import { ShareStoryButton } from "@/components/story/share-story-button";
import type { ActiveExercise, ActiveWorkout } from "@/components/workout/active-store";
import {
  type PreviousEntry,
  workoutApi,
  workoutQueryPrefix,
} from "@/lib/workout-contract";
import { fmtInt, parseNum } from "@/lib/format";
import { fmtNumber, i18n } from "@joyorogo/i18n";
import { prKindLabel } from "@joyorogo/api/lib/workout";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Share2, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useOptimisticMutation } from "@/lib/optimistic";
import type { SaveSessionOutput } from "@/lib/workout-contract";
import { orpc } from "@/utils/orpc";
import { client } from "@/utils/orpc";

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
      prs.push({
        exerciseName: name,
        label: prKindLabel("weight"),
        value: `${fmtNumber(bestWeight, 1)} kg`,
      });
    }

    const bestOneRm = Math.max(0, ...working.map((s) => epley(s.weightKg ?? 0, s.reps ?? 0)));
    const prevOneRm = Math.max(0, ...prevWorking.map((s) => epley(s.weightKg ?? 0, s.reps ?? 0)));
    if (bestWeight > 0 && bestOneRm > prevOneRm) {
      prs.push({
        exerciseName: name,
        label: prKindLabel("one_rm"),
        value: `${fmtNumber(bestOneRm, 1)} kg`,
      });
    }

    const atWeight = working.filter((s) => (s.weightKg ?? 0) === bestWeight && bestWeight > 0);
    const bestReps = Math.max(0, ...atWeight.map((s) => s.reps ?? 0));
    const prevAtWeight = prevWorking.filter((s) => (s.weightKg ?? 0) === prevWeight && prevWeight > 0);
    const prevReps = Math.max(0, ...prevAtWeight.map((s) => s.reps ?? 0));
    if (bestReps > 0 && (bestWeight > prevWeight || bestReps > prevReps)) {
      prs.push({
        exerciseName: name,
        label: i18n.t("olahraga:latihan.pr.repsAtWeight", { kg: fmtNumber(bestWeight, 1) }),
        value: i18n.t("olahraga:latihan.set.reps", { count: bestReps }),
      });
    }

    const bestVolume = Math.max(0, ...working.map((s) => (s.weightKg ?? 0) * (s.reps ?? 0)));
    const prevVolume = Math.max(0, ...prevWorking.map((s) => (s.weightKg ?? 0) * (s.reps ?? 0)));
    if (bestVolume > 0 && bestVolume > prevVolume) {
      prs.push({
        exerciseName: name,
        label: prKindLabel("set_volume"),
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
 * Post-finish review screen: totals, new-records list, editable title and
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
  const { t } = useTranslation(["olahraga", "common"]);
  const queryClient = useQueryClient();
  const [name, setName] = useState(workout.name || t("latihan.list.resume.untitled"));
  const [note, setNote] = useState(workout.note);
  const [error, setError] = useState<string | null>(null);
  const [saveRoutineOpen, setSaveRoutineOpen] = useState(false);
  const [routineName, setRoutineName] = useState(workout.name || t("latihan.list.resume.untitled"));
  // Sheet bagikan-ke-feed: menyimpan sesi dulu, lalu membuat postingan.
  const [shareOpen, setShareOpen] = useState(false);

  const exerciseIds = useMemo(
    () => [...new Set(workout.exercises.map((exercise) => exercise.exerciseId))],
    [workout.exercises],
  );
  const previous = useQuery({
    queryKey: [...workoutQueryPrefix, "previous", exerciseIds],
    queryFn: () => workoutApi.previous({ exerciseIds }),
  });

  /** Satu sumber payload sesi: dipakai simpan biasa dan simpan-+-bagikan. */
  const sessionPayload = () => ({
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
  });

  const invalidateWorkout = () => {
    void queryClient.invalidateQueries({ queryKey: [...workoutQueryPrefix] });
    void queryClient.invalidateQueries({ queryKey: ["day"] });
    void queryClient.invalidateQueries({ queryKey: ["exercise"] });
  };

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

  const save = useOptimisticMutation<void, SaveSessionOutput>({
    mutationFn: () => workoutApi.saveSession(sessionPayload()),
    invalidate: () => [orpc.workout.key(), orpc.day.key()],
    success: (_input, result) => {
      const prCount = result.prs.length;
      onClose();
      return {
        message:
          prCount > 0
            ? t("latihan.summary.toast.savedPr", { count: prCount })
            : t("latihan.summary.toast.saved"),
        undo: () => void client.workout.deleteSession({ id: result.id }),
      };
    },
    onError: (err) => setError(err.message),
  });

  /** Simpan sesi dulu, lalu bagikan snapshotnya ke feed. */
  const saveAndShare = async (input: { caption: string; visibility: "publik" | "grup" }) => {
    const saved = await workoutApi.saveSession(sessionPayload());
    invalidateWorkout();
    await client.social.createPost({
      kind: "latihan",
      refId: saved.id,
      caption: input.caption || undefined,
      visibility: input.visibility,
    });
  };

  const saveRoutine = useOptimisticMutation<void, { id: string }>({
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
    invalidate: () => [orpc.workout.key()],
    success: (_input, result) => {
      setSaveRoutineOpen(false);
      return {
        message: t("latihan.routine.toast.saved"),
        undo: () => void workoutApi.deleteRoutine({ id: result.id }),
      };
    },
    onError: (err) => setError(err.message),
  });

  const minutes = Math.round(totals.durationMs / 60000);

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center justify-center gap-2">
          <Trophy className="size-5 text-amber-500" aria-hidden />
          <p className="text-lg font-extrabold">{t("latihan.summary.done")}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <p className="font-extrabold tabular-nums">{fmtInt(minutes)}</p>
            <p className="text-xs text-muted-foreground">{t("latihan.stat.minutes")}</p>
          </div>
          <div>
            <p className="font-extrabold tabular-nums">{fmtInt(totals.volumeKg)}</p>
            <p className="text-xs text-muted-foreground">{t("latihan.stat.volumeKg")}</p>
          </div>
          <div>
            <p className="font-extrabold tabular-nums">{totals.setsDone}</p>
            <p className="text-xs text-muted-foreground">{t("latihan.stat.setsDone")}</p>
          </div>
        </div>
      </Card>

      {localPrs.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-extrabold">{t("latihan.summary.records")}</p>
          <ul className="space-y-1">
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
          <FieldLabel>{t("latihan.field.sessionName")}</FieldLabel>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel>{t("latihan.field.noteOptional")}</FieldLabel>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("latihan.summary.notePlaceholder")}
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
          <p className="text-sm font-extrabold">{t("latihan.summary.saveRoutine")}</p>
          <Input
            value={routineName}
            onChange={(event) => setRoutineName(event.target.value)}
            placeholder={t("latihan.routine.name")}
            aria-label={t("latihan.routine.name")}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setSaveRoutineOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              className="flex-1"
              disabled={routineName.trim().length === 0 || saveRoutine.isPending}
              onClick={() => saveRoutine.mutate()}
            >
              {saveRoutine.isPending ? t("latihan.summary.saving") : t("latihan.routine.save")}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t("latihan.summary.saving") : t("latihan.summary.save")}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setShareOpen(true)}>
              <Share2 className="size-4" aria-hidden />
              {t("latihan.summary.shareFeed")}
            </Button>
            <ShareStoryButton
              variant="secondary"
              story={{
                kind: "workout",
                name,
                durationMin: minutes,
                volumeKg: totals.volumeKg,
                setsDone: totals.setsDone,
                prs: localPrs.map((pr) => ({
                  exercise: pr.exerciseName,
                  label: pr.label,
                  value: pr.value,
                })),
              }}
            />
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setSaveRoutineOpen(true)}>
            {t("latihan.summary.saveRoutine")}
          </Button>
          <Link
            to="/latihan"
            className="block w-full rounded-full py-2 text-center text-sm font-semibold text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            onClick={onClose}
          >
            {t("latihan.summary.discard")}
          </Link>
        </div>
      )}

      <ShareToFeedSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={t("latihan.summary.shareTitle")}
        preview={[
          name.trim() || t("latihan.list.resume.untitled"),
          t("latihan.count.minutes", { count: minutes }),
          `${fmtInt(totals.volumeKg)} kg`,
        ].join(" · ")}
        share={saveAndShare}
        onShared={onClose}
      />
    </div>
  );
}
