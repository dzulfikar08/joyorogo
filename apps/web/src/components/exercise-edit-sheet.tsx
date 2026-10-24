import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, Link2, Link2Off } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import {
  EXERCISE_MAX_DURATION,
  EXERCISE_MAX_KCAL,
  EXERCISE_MIN_DURATION,
  burnRate,
  kcalForDuration,
} from "@joyorogo/api/lib/exercise-edit";
import { recentDayLabel } from "@joyorogo/api/lib/format";

import { FieldLabel } from "@/components/kit/surface";
import { InfoAccordion } from "@/components/onboarding/info-accordion";
import { CalendarSheet, DayChips } from "@/components/plate/plate-group";
import type { ExerciseItem } from "@/lib/api-types";
import { fmtDateLong, fmtInt, fmtKcalLabel, parseNum } from "@/lib/format";
import { OptimisticCache, useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type ExerciseUpdateInput = Parameters<typeof client.exercise.update>[0];
type ExerciseListData = { items: ExerciseItem[]; totalKcal: number };
type ExerciseRecentData = { items: ExerciseItem[]; startDate: string; endDate: string };

const SOURCE_NAMES: Record<string, string> = {
  strava: "Strava",
  coros: "COROS",
  garmin: "Garmin",
  health_connect: "Health Connect",
  apple_health: "Apple Health",
};

const listKey = (date: string) =>
  orpc.exercise.listByDate.queryOptions({ input: { date } }).queryKey;
const recentKey = orpc.exercise.recent.queryOptions({ input: { days: 7 } }).queryKey;
const INVALIDATE = () => [orpc.exercise.key(), orpc.day.key()] as const;

/** Whole-number text for an input. */
const fmtField = (n: number) => String(Math.round(n));

/**
 * Cache patch for one edited row: same-day edits replace the row in place and
 * move the day total by the delta; a date change relocates it between the two
 * day caches. The 7-day history and the day summaries follow.
 */
function patchExerciseEdit(cache: OptimisticCache, before: ExerciseItem, after: ExerciseItem) {
  if (after.date !== before.date) {
    cache.value<ExerciseListData>(listKey(before.date), (old) =>
      old
        ? {
            items: old.items.filter((item) => item.id !== before.id),
            totalKcal: Math.max(0, old.totalKcal - before.kcal),
          }
        : old,
    );
    cache.value<ExerciseListData>(listKey(after.date), (old) =>
      old
        ? { items: [...old.items, after], totalKcal: old.totalKcal + after.kcal }
        : old,
    );
    cache.summary({ date: before.date, burnKcal: -before.kcal });
    cache.summary({ date: after.date, burnKcal: after.kcal });
  } else {
    const delta = after.kcal - before.kcal;
    cache.value<ExerciseListData>(listKey(before.date), (old) =>
      old
        ? {
            items: old.items.map((item) => (item.id === before.id ? after : item)),
            totalKcal: Math.max(0, old.totalKcal + delta),
          }
        : old,
    );
    if (delta !== 0) cache.summary({ date: before.date, burnKcal: delta });
  }
  cache.value<ExerciseRecentData>(recentKey, (old) =>
    old
      ? {
          ...old,
          // History is date-descending; a stable sort keeps same-day order.
          items: old.items
            .map((item) => (item.id === before.id ? after : item))
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
        }
      : old,
  );
}

/**
 * Edit sheet for one logged exercise: name, duration, kcal and day.
 *
 * Duration and kcal are linked through the row's burn rate (kcal per minute):
 * changing the duration rescales kcal along it, typing kcal sets a new rate.
 * The link button breaks the tie for entries where the two are known separately.
 * Imported rows keep their source and external id, so a resync leaves the edit alone.
 */
export function ExerciseEditSheet({ row, onClose }: { row: ExerciseItem; onClose: () => void }) {
  const { t } = useTranslation(["olahraga", "common"]);
  const queryClient = useQueryClient();
  const initialDuration = row.durationMin == null ? "" : fmtField(row.durationMin);
  const initialKcal = fmtField(row.kcal);
  const [name, setName] = useState(row.name);
  const [date, setDate] = useState(row.date);
  const [pickingDate, setPickingDate] = useState(false);
  const [linked, setLinked] = useState(true);
  const [rate, setRate] = useState(() => burnRate(row.kcal, row.durationMin));
  const [durationText, setDurationText] = useState(initialDuration);
  const [kcalText, setKcalText] = useState(initialKcal);

  const typedDuration = parseNum(durationText);
  const typedKcal = parseNum(kcalText);
  const durationBlank = durationText.trim() === "";
  const durationChanged = durationText !== initialDuration;
  const kcalChanged = kcalText !== initialKcal;
  // An untouched field is never re-validated: imported rows can carry
  // sub-minute durations that the whole-minute field would reject.
  const durationOk =
    !durationChanged ||
    durationBlank ||
    (typedDuration !== null &&
      typedDuration >= EXERCISE_MIN_DURATION &&
      typedDuration <= EXERCISE_MAX_DURATION);
  const kcalOk =
    !kcalChanged ||
    (typedKcal !== null && typedKcal >= 0 && typedKcal <= EXERCISE_MAX_KCAL);
  const valid = name.trim() !== "" && durationOk && kcalOk;

  const nameChanged = name.trim() !== row.name;
  const dateChanged = date !== row.date;
  const changed = nameChanged || durationChanged || kcalChanged || dateChanged;

  const onDuration = (text: string) => {
    setDurationText(text);
    const minutes = parseNum(text);
    if (linked && rate !== null && minutes !== null && minutes > 0) {
      setKcalText(fmtField(kcalForDuration(rate, minutes)));
    }
  };

  const onKcal = (text: string) => {
    setKcalText(text);
    const kcal = parseNum(text);
    if (linked && kcal !== null && kcal >= 0) {
      const next = burnRate(kcal, typedDuration);
      if (next !== null) setRate(next);
    }
  };

  const toggleLink = () => {
    // Re-linking lets the typed kcal lead: the rate follows what is on screen.
    if (!linked && typedKcal !== null) {
      const next = burnRate(typedKcal, typedDuration);
      if (next !== null) setRate(next);
    }
    setLinked(!linked);
  };

  /** Payload for exactly the fields that changed. */
  const changes = (): Omit<ExerciseUpdateInput, "id"> => ({
    ...(nameChanged ? { name: name.trim() } : {}),
    ...(durationChanged
      ? { durationMin: durationBlank || typedDuration === null ? null : Math.round(typedDuration) }
      : {}),
    ...(kcalChanged && typedKcal !== null ? { kcal: Math.round(typedKcal) } : {}),
    ...(dateChanged ? { date } : {}),
  });

  /** Row as it will be stored after this edit. */
  const edited = (input: ExerciseUpdateInput): ExerciseItem => ({
    ...row,
    name: input.name ?? row.name,
    durationMin: input.durationMin === undefined ? row.durationMin : input.durationMin,
    kcal: input.kcal ?? row.kcal,
    date: input.date ?? row.date,
  });

  const update = useOptimisticMutation<ExerciseUpdateInput, ExerciseItem | null>({
    mutationFn: (input) => client.exercise.update(input),
    patch: (input, cache) => patchExerciseEdit(cache, row, edited(input)),
    invalidate: INVALIDATE,
    success: (input) => {
      const moved = input.date !== undefined && input.date !== row.date;
      return {
        message: moved
          ? t("edit.toast.moved", { day: relativeDayLabel(input.date!, jakartaToday()) })
          : t("edit.toast.updated", { name: input.name ?? row.name }),
        undo: () => {
          patchExerciseEdit(new OptimisticCache(queryClient), edited(input), row);
          void client.exercise
            .update({
              id: row.id,
              ...(input.name !== undefined ? { name: row.name } : {}),
              ...(input.durationMin !== undefined ? { durationMin: row.durationMin } : {}),
              ...(input.kcal !== undefined ? { kcal: row.kcal } : {}),
              ...(input.date !== undefined ? { date: row.date } : {}),
            })
            .finally(() => {
              for (const key of INVALIDATE()) void queryClient.invalidateQueries({ queryKey: key });
            });
        },
      };
    },
  });

  const submit = () => {
    if (!valid || !changed) return;
    update.mutate({ id: row.id, ...changes() });
    onClose();
  };

  const sourceName = SOURCE_NAMES[row.source];
  const shownKcal = kcalOk && typedKcal !== null ? Math.round(typedKcal) : null;

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()} title={t("edit.title")}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div>
            <FieldLabel htmlFor="exercise-edit-name">{t("edit.name")}</FieldLabel>
            <Input
              id="exercise-edit-name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <FieldLabel htmlFor="exercise-edit-duration">{t("form.duration")}</FieldLabel>
              <Input
                id="exercise-edit-duration"
                inputMode="numeric"
                value={durationText}
                onChange={(event) => onDuration(event.target.value)}
                aria-invalid={durationOk ? undefined : true}
              />
            </div>
            <Button
              type="button"
              variant={linked ? "secondary" : "outline"}
              size="icon"
              aria-pressed={linked}
              aria-label={linked ? t("edit.linkOn") : t("edit.linkOff")}
              title={linked ? t("edit.linked") : t("edit.unlinked")}
              onClick={toggleLink}
              className="mb-0.5"
            >
              {linked ? <Link2 aria-hidden /> : <Link2Off aria-hidden />}
            </Button>
            <div className="min-w-0 flex-1">
              <FieldLabel htmlFor="exercise-edit-kcal">{t("form.kcal")}</FieldLabel>
              <Input
                id="exercise-edit-kcal"
                inputMode="numeric"
                value={kcalText}
                onChange={(event) => onKcal(event.target.value)}
                aria-invalid={kcalOk ? undefined : true}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-muted px-4 py-3 text-sm" aria-live="polite">
            <p className="font-semibold tabular-nums">
              {shownKcal === null
                ? t("edit.invalid")
                : !durationBlank && durationOk && typedDuration !== null
                  ? t("edit.summary", {
                      kcal: fmtKcalLabel(shownKcal),
                      minutes: fmtInt(Math.round(typedDuration)),
                    })
                  : fmtKcalLabel(shownKcal)}
            </p>
          </div>

          <InfoAccordion title={t("about.title")}>
            <p>
              {!linked
                ? t("edit.hint.unlinked")
                : rate === null
                  ? t("edit.hint.empty")
                  : t("edit.hint.linked")}
            </p>
            {sourceName && <p>{t("edit.fromSource", { source: sourceName })}</p>}
          </InfoAccordion>

          <div>
            <FieldLabel htmlFor="exercise-edit-date">{t("edit.date")}</FieldLabel>
            <div className="mt-1.5 space-y-2">
              <DayChips value={date} onChange={setDate} />
              <Button
                id="exercise-edit-date"
                type="button"
                variant={dateChanged ? "secondary" : "outline"}
                size="sm"
                aria-expanded={pickingDate}
                aria-label={t("edit.pickDate", { day: recentDayLabel(date, jakartaToday()) })}
                onClick={() => setPickingDate(true)}
              >
                <CalendarIcon aria-hidden />
                {recentDayLabel(date, jakartaToday())}
              </Button>
              {dateChanged && (
                <p className="text-xs text-muted-foreground">
                  {t("edit.moveTo", { date: fmtDateLong(date) })}
                </p>
              )}
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={update.isPending || !valid || !changed}
          >
            {update.isPending ? t("form.saving") : t("common:actions.save")}
          </Button>
        </form>
      </Sheet>
      {pickingDate && (
        <CalendarSheet value={date} onPick={setDate} onClose={() => setPickingDate(false)} />
      )}
    </>
  );
}
