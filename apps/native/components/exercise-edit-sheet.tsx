import "@/unistyles";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
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

import { Disclosure } from "@/components/disclosure";
import { DateSheet, DayChips } from "@/components/plate/date-sheet";
import { Button, Field, Input, Num, Sheet, Text } from "@/components/ui";
import { OptimisticCache, useOptimisticMutation } from "@/lib/optimistic";
import { fmtDateMedium, fmtInt, fmtKcalLabel, parseNum } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

type ExerciseUpdateInput = Parameters<typeof client.exercise.update>[0];

/** One exercise_log row as exercise.listByDate / exercise.recent return it. */
export type ExerciseEditRow = {
  id: string;
  userId: string;
  date: string;
  type: string | null;
  name: string;
  durationMin: number | null;
  kcal: number;
  source: string;
  externalId: string | null;
  createdAt: Date;
};

type ExerciseListData = { items: ExerciseEditRow[]; totalKcal: number };
type ExerciseRecentData = { items: ExerciseEditRow[]; startDate: string; endDate: string };

const SOURCE_NAMES: Record<string, string> = {
  strava: "Strava",
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
function patchExerciseEdit(
  cache: OptimisticCache,
  before: ExerciseEditRow,
  after: ExerciseEditRow,
) {
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
      old ? { items: [...old.items, after], totalKcal: old.totalKcal + after.kcal } : old,
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
export function ExerciseEditSheet({
  row,
  onClose,
}: {
  row: ExerciseEditRow;
  onClose: () => void;
}) {
  const { t } = useTranslation(["olahraga", "common"]);
  const { theme } = useUnistyles();
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
    !kcalChanged || (typedKcal !== null && typedKcal >= 0 && typedKcal <= EXERCISE_MAX_KCAL);
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
  const edited = (input: ExerciseUpdateInput): ExerciseEditRow => ({
    ...row,
    name: input.name ?? row.name,
    durationMin: input.durationMin === undefined ? row.durationMin : input.durationMin,
    kcal: input.kcal ?? row.kcal,
    date: input.date ?? row.date,
  });

  const update = useOptimisticMutation<ExerciseUpdateInput, unknown>({
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
      <Sheet
        visible
        onClose={onClose}
        title={t("edit.title")}
        footer={
          <Button
            label={t("common:actions.save")}
            onPress={submit}
            disabled={!valid || !changed}
            loading={update.isPending}
          />
        }
      >
        <View style={styles.body}>
          <Field label={t("edit.name")}>
            <Input
              value={name}
              onChangeText={setName}
              maxLength={200}
              accessibilityLabel={t("form.name")}
            />
          </Field>

          <View style={styles.pair}>
            <View style={styles.pairField}>
              <Field label={t("form.duration")}>
                <Input
                  value={durationText}
                  onChangeText={onDuration}
                  keyboardType="number-pad"
                  accessibilityLabel={t("edit.durationA11y")}
                />
              </Field>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: linked }}
              accessibilityLabel={linked ? t("edit.linkOn") : t("edit.linkOff")}
              onPress={toggleLink}
              style={({ pressed }) => [
                styles.link,
                { backgroundColor: linked ? theme.colors.bakarSoft : theme.colors.muted },
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name={linked ? "link-variant" : "link-variant-off"}
                size={20}
                color={linked ? theme.colors.bakarText : theme.colors.mutedForeground}
              />
            </Pressable>
            <View style={styles.pairField}>
              <Field label={t("form.kcal")}>
                <Input
                  value={kcalText}
                  onChangeText={onKcal}
                  keyboardType="number-pad"
                  accessibilityLabel={t("edit.kcalA11y")}
                />
              </Field>
            </View>
          </View>

          <View style={styles.preview} accessibilityLiveRegion="polite">
            <Num style={styles.previewKcal}>
              {shownKcal === null
                ? t("edit.invalid")
                : !durationBlank && durationOk && typedDuration !== null
                  ? t("edit.summary", {
                      kcal: fmtKcalLabel(shownKcal),
                      minutes: fmtInt(Math.round(typedDuration)),
                    })
                  : fmtKcalLabel(shownKcal)}
            </Num>
          </View>

          <Disclosure title={t("about.title")} plain>
            <Text style={styles.hint}>
              {!linked
                ? t("edit.hint.unlinked")
                : rate === null
                  ? t("edit.hint.empty")
                  : t("edit.hint.linked")}
            </Text>
            {sourceName ? (
              <Text style={styles.hint}>{t("edit.fromSource", { source: sourceName })}</Text>
            ) : null}
          </Disclosure>

          <Field label={t("edit.date")}>
            <View style={styles.dateBox}>
              <DayChips value={date} onChange={setDate} />
              <Button
                variant="ghost"
                size="sm"
                icon="calendar"
                label={recentDayLabel(date, jakartaToday())}
                onPress={() => setPickingDate(true)}
              />
              {dateChanged ? (
                <Text style={styles.hint}>{t("edit.moveTo", { date: fmtDateMedium(date) })}</Text>
              ) : null}
            </View>
          </Field>
        </View>
      </Sheet>
      <DateSheet
        visible={pickingDate}
        value={date}
        onPick={setDate}
        onClose={() => setPickingDate(false)}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  pair: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
  },
  pairField: {
    flex: 1,
  },
  link: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  preview: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  previewKcal: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  dateBox: {
    gap: theme.spacing.sm,
  },
}));
