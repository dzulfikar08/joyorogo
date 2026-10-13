import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  Button,
  Card,
  Field,
  Input,
  Num,
  SectionTitle,
  Text,
} from "@/components/ui";
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
import { errorMessage, fmtKcal } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const PR_LABEL: Record<string, string> = {
  weight: "Beban terberat",
  one_rm: "e1RM terbaik",
  reps: "Reps terbanyak",
  set_volume: "Volume set terbaik",
};

type SavePr = { exerciseId: string; kind: string; value: number; previous: number | null };

/** Collapse per-kind PR rows into one bullet per exercise for the recap. */
function prBullet(pr: SavePr, nameOf: (id: string) => string): string {
  const value =
    pr.kind === "weight" || pr.kind === "one_rm"
      ? `${fmtKcal(pr.value)} kg`
      : pr.kind === "set_volume"
        ? `${fmtKcal(pr.value)} kg`
        : `${fmtKcal(pr.value)} reps`;
  return `${nameOf(pr.exerciseId)} — ${PR_LABEL[pr.kind] ?? pr.kind}: ${value}`;
}

/** One set ready for the API, or null when it fails the contract rules. */
function toApiSet(exercise: ActiveExercise, set: ActiveSet) {
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
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const workout = useActiveWorkout();
  const [name, setName] = useState(workout?.name ?? "");
  const [note, setNote] = useState(workout?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; prs: SavePr[] } | null>(null);

  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const nameOf = (id: string) =>
    catalog.data?.exercises.find((e) => e.id === id)?.name ?? id;

  const save = useMutation(
    orpc.workout.saveSession.mutationOptions({
      onSuccess: (result) => {
        setSaved({ id: result.id, prs: result.prs });
        setActiveWorkout(null);
        void queryClient.invalidateQueries();
      },
      onError: (e) => setError(errorMessage(e)),
    }),
  );

  // Snapshot: once saved the draft is dropped from the store, but the recap
  // still needs the finished workout's numbers.
  const [snapshot] = useState(workout);
  const draft = workout ?? snapshot;

  if (gate === "loading") return null;
  if (draft === null && saved === null) {
    return (
      <>
        <Stack.Screen options={{ title: "Ringkasan" }} />
        <View style={styles.emptyRoot}>
          <Text style={styles.emptyText}>Tidak ada latihan untuk disimpan.</Text>
          <Button label="Kembali" onPress={() => router.replace("/latihan")} />
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
      setError("Beri nama sesinya dulu, mis. Push Senin.");
      return;
    }
    const apiSets = draft.exercises.flatMap((exercise) =>
      exercise.sets.filter((set) => set.done).map((set) => toApiSet(exercise, set)),
    );
    const dropped = apiSets.filter((set) => set === null).length;
    const valid = apiSets.filter((set) => set !== null);
    if (valid.length === 0) {
      setError("Set yang dicentang belum lengkap. Isi repetisi atau durasinya.");
      return;
    }
    const go = () => {
      setError(null);
      save.mutate({
        name: name.trim(),
        note: note.trim().length > 0 ? note.trim() : undefined,
        startedAt: new Date(draft.startedAt).toISOString(),
        durationMin: elapsedMin,
        sets: valid,
      });
    };
    const proceed = () => {
      if (dropped > 0) {
        Alert.alert(
          "Sebagian set dilewati",
          `${dropped} set dicentang tapi datanya kurang (tanpa repetisi/durasi), jadi tidak ikut disimpan.`,
          [{ text: "Lanjutkan", style: "default", onPress: go }],
        );
      } else {
        go();
      }
    };
    if (unchecked > 0) {
      Alert.alert(
        "Ada set belum dicentang",
        `${unchecked} set tidak ikut tersimpan. Lanjutkan?`,
        [
          { text: "Periksa lagi", style: "cancel" },
          { text: "Simpan", style: "default", onPress: proceed },
        ],
      );
      return;
    }
    proceed();
  };

  const newPrs = saved
    ? saved.prs.filter((pr) => pr.previous === null || pr.value > pr.previous)
    : [];

  return (
    <>
      <Stack.Screen options={{ title: "Ringkasan" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatClock(elapsedMs)}</Text>
            <Text style={styles.statLabel}>Durasi</Text>
          </View>
          <View style={styles.stat}>
            <Num style={styles.statValue}>{fmtKcal(volume)}</Num>
            <Text style={styles.statLabel}>Volume (kg)</Text>
          </View>
          <View style={styles.stat}>
            <Num style={styles.statValue}>{setsDone}</Num>
            <Text style={styles.statLabel}>Set</Text>
          </View>
        </View>

        {saved ? (
          <>
            <SectionTitle title="Rekor baru" />
            <Card>
              {newPrs.length === 0 ? (
                <Text style={styles.emptyText}>
                  Belum ada rekor baru kali ini. Tetap solid, sesi tercatat.
                </Text>
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
            <Button label="Selesai" onPress={() => router.replace("/latihan")} />
          </>
        ) : (
          <>
            <Field label="Nama sesi">
              <Input value={name} onChangeText={setName} placeholder="Push Senin" />
            </Field>
            <Field label="Catatan sesi (opsional)">
              <Input
                value={note}
                onChangeText={setNote}
                placeholder="Minggu depan naikkan beban squat"
                multiline
              />
            </Field>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={save.isPending ? "Menyimpan…" : "Simpan latihan"}
              onPress={submit}
              disabled={save.isPending}
              loading={save.isPending}
            />
          </>
        )}
      </ScrollView>
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
