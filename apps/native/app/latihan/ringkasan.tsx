import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { prKindLabel } from "@joyorogo/api/lib/workout";
import { fmtNumber, i18n } from "@joyorogo/i18n";

import {
  Button,
  Card,
  Field,
  Input,
  Num,
  SectionTitle,
  Text,
} from "@/components/ui";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { useSessionGate } from "@/lib/use-session-gate";
import {
  completedSetCount,
  formatClock,
  setActiveWorkout,
  showsDuration,
  showsWeight,
  setDurationSec,
  setReps,
  setWeightKg,
  uncheckedSetCount,
  useActiveWorkout,
  workoutVolume,
  type ActiveExercise,
  type ActiveSet,
} from "@/lib/workout/active";
import { errorMessage, fmtInt } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

type SavePr = { exerciseId: string; kind: string; value: number; previous: number | null };

/** Formatted right-hand side of a PR bullet: kg for load PRs, reps for reps. */
function prValueText(pr: SavePr): string {
  return pr.kind === "reps"
    ? i18n.t("olahraga:latihan.set.reps", { count: Math.round(pr.value) })
    : `${fmtNumber(pr.value, 1)} kg`;
}

const PR_KINDS = ["weight", "one_rm", "reps", "set_volume"] as const;

/** Server-sent PR kind as a label; unknown kinds fall back to the raw value. */
function prLabel(kind: string): string {
  const known = PR_KINDS.find((item) => item === kind);
  return known ? prKindLabel(known) : kind;
}

/** One bullet per PR row for the recap. */
function prBullet(pr: SavePr, nameOf: (id: string) => string): string {
  return `${nameOf(pr.exerciseId)} — ${prLabel(pr.kind)}: ${prValueText(pr)}`;
}

/** One set ready for the API, or null when it fails the contract rules. */
type ApiSet =
  | {
      exerciseId: string;
      reps: null;
      weightKg: null;
      rpe: null;
      setType: ActiveSet["type"];
      durationSec: number;
      note: string | undefined;
      supersetGroup: ActiveExercise["supersetGroup"];
    }
  | {
      exerciseId: string;
      reps: number;
      weightKg: number | null;
      rpe: null;
      setType: ActiveSet["type"];
      note: string | undefined;
      supersetGroup: ActiveExercise["supersetGroup"];
    };

function toApiSet(exercise: ActiveExercise, set: ActiveSet): ApiSet | null {
  const setType = set.type;
  const note = exercise.note.trim().length > 0 ? exercise.note.trim() : undefined;
  const supersetGroup = exercise.supersetGroup;
  if (showsDuration(exercise.type)) {
    const durationSec = setDurationSec(set);
    if (durationSec < 1) return null;
    return {
      exerciseId: exercise.exerciseId,
      reps: null,
      weightKg: null,
      rpe: null,
      setType,
      durationSec,
      note,
      supersetGroup,
    };
  }
  const reps = setReps(set);
  if (reps < 1) return null;
  return {
    exerciseId: exercise.exerciseId,
    reps,
    weightKg: showsWeight(exercise.type) ? setWeightKg(set) : null,
    rpe: null,
    setType,
    note,
    supersetGroup,
  };
}

export default function LatihanRingkasan() {
  const { t } = useTranslation(["olahraga", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const workout = useActiveWorkout();
  const [name, setName] = useState(workout?.name ?? "");
  const [note, setNote] = useState(workout?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; prs: SavePr[] } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [pending, setPending] = useState<
    null | {
      kind: "dropped" | "unchecked";
      count: number;
      payload: {
        name: string;
        note: string | undefined;
        startedAt: string;
        durationMin: number;
        sets: ApiSet[];
      };
    }
  >(null);

  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const nameOf = (id: string) =>
    catalog.data?.exercises.find((e) => e.id === id)?.name ?? id;

  const save = useOptimisticMutation<
    Parameters<typeof client.workout.saveSession>[0],
    { id: string; prs: SavePr[] }
  >({
    mutationFn: async (input) => {
      const result = (await client.workout.saveSession(input)) as {
        id?: string;
        prs?: SavePr[];
      };
      if (result.id === undefined) throw new Error(t("latihan.summary.error.saveFailed"));
      return { id: result.id, prs: result.prs ?? [] };
    },
    success: (_input, result) => {
      setSaved({ id: result.id, prs: result.prs });
      setActiveWorkout(null);
      void queryClient.invalidateQueries({ queryKey: orpc.workout.key() });
      return {
        message: t("latihan.summary.toast.saved"),
        undo: () => {
          void client.workout.deleteSession({ id: result.id }).then(() => {
            void queryClient.invalidateQueries({ queryKey: orpc.workout.key() });
            void queryClient.invalidateQueries({ queryKey: orpc.day.key() });
          });
        },
      };
    },
    onError: (e) => setError(errorMessage(e)),
    invalidate: () => [orpc.workout.key(), orpc.day.key()],
  });

  // Snapshot: once saved the draft is dropped from the store, but the recap
  // still needs the finished workout's numbers.
  const [snapshot] = useState(workout);
  const draft = workout ?? snapshot;

  if (gate === "loading") return null;
  if (draft === null && saved === null) {
    return (
      <>
        <Stack.Screen options={{ title: t("latihan.summary.screenTitle") }} />
        <View style={styles.emptyRoot}>
          <Text style={styles.emptyText}>{t("latihan.summary.nothing")}</Text>
          <Button label={t("common:actions.back")} onPress={() => router.replace("/latihan")} />
        </View>
      </>
    );
  }

  const elapsedMs = draft !== null ? Date.now() - draft.startedAt : 0;
  const elapsedMin = Math.max(1, Math.round(elapsedMs / 60000));
  const volume = draft !== null ? workoutVolume(draft) : 0;
  const setsDone = draft !== null ? completedSetCount(draft) : 0;
  const unchecked = draft !== null ? uncheckedSetCount(draft) : 0;

  const submit = () => {
    if (draft === null) return;
    if (name.trim().length === 0) {
      setError(t("latihan.summary.error.name"));
      return;
    }
    const apiSets = draft.exercises.flatMap((exercise) =>
      exercise.sets.filter((set) => set.done).map((set) => toApiSet(exercise, set)),
    );
    const dropped = apiSets.filter((set) => set === null).length;
    const valid = apiSets.filter((set) => set !== null);
    if (valid.length === 0) {
      setError(t("latihan.summary.error.incomplete"));
      return;
    }
    const payload = {
      name: name.trim(),
      note: note.trim().length > 0 ? note.trim() : undefined,
      startedAt: new Date(draft.startedAt).toISOString(),
      durationMin: elapsedMin,
      sets: valid,
    };
    const doSave = () => {
      setError(null);
      save.mutate(payload);
    };
    if (unchecked > 0) {
      setPending({ kind: "unchecked", count: unchecked, payload });
      return;
    }
    if (dropped > 0) {
      setPending({ kind: "dropped", count: dropped, payload });
      return;
    }
    doSave();
  };

  const newPrs = saved
    ? saved.prs.filter((pr) => pr.previous === null || pr.value > pr.previous)
    : [];

  return (
    <>
      <Stack.Screen options={{ title: t("latihan.summary.screenTitle") }} />
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatClock(elapsedMs)}</Text>
            <Text style={styles.statLabel}>{t("latihan.stat.duration")}</Text>
          </View>
          <View style={styles.stat}>
            <Num style={styles.statValue}>{fmtInt(volume)}</Num>
            <Text style={styles.statLabel}>{t("latihan.stat.volumeKg")}</Text>
          </View>
          <View style={styles.stat}>
            <Num style={styles.statValue}>{setsDone}</Num>
            <Text style={styles.statLabel}>{t("latihan.active.col.set")}</Text>
          </View>
        </View>

        {saved ? (
          <>
            <SectionTitle title={t("latihan.summary.records")} />
            <Card>
              {newPrs.length === 0 ? (
                <Text style={styles.emptyText}>{t("latihan.summary.noRecords")}</Text>
              ) : (
                <View style={styles.prList}>
                  {newPrs.map((pr, i) => (
                    <View key={`${pr.exerciseId}-${pr.kind}-${i}`} style={styles.prRow}>
                      <Ionicons name="trophy" size={16} color={theme.colors.bakarText} />
                      <Text style={styles.prText}>{prBullet(pr, nameOf)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
            <ShareStoryButton
              variant="secondary"
              story={{
                kind: "workout",
                name: name.trim().length > 0 ? name.trim() : t("latihan.list.resume.untitled"),
                durationMin: elapsedMin,
                volumeKg: volume,
                setsDone,
                prs: newPrs.map((pr) => ({
                  exercise: nameOf(pr.exerciseId),
                  label: prLabel(pr.kind),
                  value: prValueText(pr),
                })),
              }}
            />
            <Button
              variant="secondary"
              label={t("latihan.summary.shareFeed")}
              onPress={() => setShareOpen(true)}
            />
            <Button label={t("common:actions.done")} onPress={() => router.replace("/latihan")} />
          </>
        ) : (
          <>
            <Field label={t("latihan.field.sessionName")}>
              <Input value={name} onChangeText={setName} placeholder={t("latihan.summary.namePlaceholder")} />
            </Field>
            <Field label={t("latihan.field.noteOptional")}>
              <Input
                value={note}
                onChangeText={setNote}
                placeholder={t("latihan.summary.notePlaceholder")}
                multiline
              />
            </Field>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={save.isPending ? t("latihan.summary.saving") : t("latihan.summary.save")}
              onPress={submit}
              disabled={save.isPending}
              loading={save.isPending}
            />
          </>
        )}
      </KeyboardAwareScrollView>

      <ShareToFeedSheet
        visible={shareOpen && saved !== null}
        onClose={() => setShareOpen(false)}
        title={saved !== null && name.trim().length > 0 ? name.trim() : t("latihan.title")}
        preview={[
          `${fmtInt(volume)} kg`,
          t("latihan.count.sets", { count: setsDone }),
          t("latihan.count.minutes", { count: elapsedMin }),
        ].join(" · ")}
        kind="latihan"
        refId={saved?.id ?? ""}
      />

      <ConfirmSheet
        visible={pending?.kind === "unchecked"}
        onClose={() => setPending(null)}
        title={t("latihan.unchecked.title")}
        message={t("latihan.summary.confirm.unchecked", { count: pending?.count ?? 0 })}
        confirmLabel={t("common:actions.save")}
        cancelLabel={t("latihan.summary.confirm.review")}
        onConfirm={() => {
          const payload = pending?.payload;
          setPending(null);
          if (payload) save.mutate(payload);
        }}
      />

      <ConfirmSheet
        visible={pending?.kind === "dropped"}
        onClose={() => setPending(null)}
        title={t("latihan.summary.confirm.droppedTitle")}
        message={t("latihan.summary.confirm.dropped", { count: pending?.count ?? 0 })}
        confirmLabel={t("latihan.summary.confirm.continue")}
        destructive={false}
        onConfirm={() => {
          const payload = pending?.payload;
          setPending(null);
          if (payload) save.mutate(payload);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  emptyRoot: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.lg, padding: theme.spacing.lg },
  emptyText: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm },
  statRow: { flexDirection: "row", gap: theme.spacing.sm },
  stat: {
    flex: 1,
    alignItems: "center",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.tile,
    paddingVertical: theme.spacing.md,
    gap: 2,
  },
  statValue: { fontSize: theme.fontSize.md, fontWeight: "800", color: theme.colors.foreground },
  statLabel: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  prList: { gap: theme.spacing.sm },
  prRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  prText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, fontWeight: "600" },
}));
