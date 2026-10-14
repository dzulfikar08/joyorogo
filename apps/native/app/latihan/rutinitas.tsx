import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ExercisePickerList } from "@/components/workout/exercise-picker-list";
import { ConfirmSheet } from "@/components/confirm-sheet";
import {
  Button,
  Card,
  Chip,
  Field,
  Input,
  Sheet,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import {
  emptySet,
  newExercise,
  SET_TYPE_LABEL,
  nextSetType,
  showsDuration,
  showsWeight,
  type ActiveSet,
  type ActiveExercise,
  type ExerciseType,
} from "@/lib/workout/active";
import { errorMessage } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { upsertById } from "@joyorogo/api/lib/optimistic";

const REST_OPTIONS = [
  { value: null, label: "Mati" },
  { value: 60, label: "1:00" },
  { value: 90, label: "1:30" },
  { value: 120, label: "2:00" },
  { value: 180, label: "3:00" },
];

/** Routine draft mirrors ActiveExercise; saved through saveRoutine. */
type RoutineExercise = Pick<
  ActiveExercise,
  "exerciseId" | "name" | "type" | "note" | "supersetGroup" | "restSec" | "sets"
>;

export default function LatihanRutinitas() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const params = useLocalSearchParams<{ id?: string }>();
  const routines = useQuery(orpc.workout.routines.listRoutines.queryOptions());
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const existing = routines.data?.find((r) => r.id === params.id);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [exercises, setExercises] = useState<RoutineExercise[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The routine arrives with the query; hydrate the form once per screen.
  const hydratedId = useRef<string | null>(null);
  useEffect(() => {
    if (!existing || hydratedId.current === existing.id) return;
    hydratedId.current = existing.id;
    setName(existing.name);
    setNote(existing.note ?? "");
    setExercises(
      existing.exercises.map((item) => ({
        exerciseId: item.exerciseId,
        name: catalog.data?.exercises.find((e) => e.id === item.exerciseId)?.name ?? item.exerciseId,
        type: (catalog.data?.exercises.find((e) => e.id === item.exerciseId)?.type ??
          "weight_reps") as ExerciseType,
        note: item.note ?? "",
        supersetGroup: null,
        restSec: item.restSec,
        sets: item.sets.map((set) => ({
          type: set.setType,
          weightKg: set.weightKg != null ? String(set.weightKg) : "",
          reps: set.reps != null ? String(set.reps) : "",
          durationSec: set.durationSec != null ? String(set.durationSec) : "",
          done: false,
        })),
      })),
    );
  }, [existing, catalog.data]);

  type RoutineInput = Parameters<typeof client.workout.routines.saveRoutine>[0];
  type RoutineRow = NonNullable<typeof routines.data>[number];
  const routinesKey = orpc.workout.routines.listRoutines.queryOptions().queryKey;

  const save = useOptimisticMutation<RoutineInput, { id: string }, RoutineRow | null>({
    mutationFn: (input) => client.workout.routines.saveRoutine(input),
    patch: (input, cache) => {
      const previous = input.id
        ? ((queryClient.getQueryData<RoutineRow[]>(routinesKey) ?? []).find(
            (row) => row.id === input.id,
          ) ?? null)
        : null;
      cache.list<RoutineRow>(routinesKey, (rows) =>
        upsertById(rows, {
          id: input.id ?? `temp-${Date.now()}`,
          name: input.name,
          note: input.note ?? null,
          exercises: input.exercises.map((exercise) => ({
            ...exercise,
            sets: exercise.sets.map((set) => ({ ...set, setType: set.setType ?? "normal" })),
          })),
          updatedAt: new Date().toISOString(),
        }),
      );
      return previous;
    },
    success: (
      _input,
      data,
      context,
    ): { message: string; undo?: () => void } | undefined => {
      const previous = context ?? null;
      void queryClient.invalidateQueries({ queryKey: orpc.workout.key() });
      router.back();
      return {
        message: "Rutinitas disimpan",
        undo:
          previous === null
            ? // New routine: undo deletes it outright.
              () => void client.workout.routines.deleteRoutine({ id: data.id })
            : // Edited: undo re-saves the previous draft.
              () =>
                save.mutate({
                  id: previous.id,
                  name: previous.name,
                  note: previous.note ?? undefined,
                  exercises: previous.exercises as RoutineInput["exercises"],
                }),
      };
    },
    onError: (e) => setError(errorMessage(e)),
    invalidate: () => [orpc.workout.key()],
  });
  const remove = useDelayedDelete<RoutineRow>({
    remove: (row) => client.workout.routines.deleteRoutine({ id: row.id }),
    patch: (row, cache) => {
      cache.list<RoutineRow>(routinesKey, (rows) => rows.filter((item) => item.id !== row.id));
    },
    label: (row) => row.name,
    fallback: "Rutinitas",
    // The screen navigates back immediately; keep the undo window alive.
    flushOnUnmount: false,
    invalidate: () => [orpc.workout.key()],
  });

  if (gate === "loading") return null;

  const patchExercise = (index: number, next: Partial<RoutineExercise>) => {
    setExercises((prev) =>
      prev.map((exercise, i) => (i === index ? { ...exercise, ...next } : exercise)),
    );
  };
  const patchSet = (exerciseIndex: number, setIndex: number, next: Partial<ActiveSet>) => {
    patchExercise(exerciseIndex, {
      sets: exercises[exerciseIndex]!.sets.map((set, si) =>
        si === setIndex ? { ...set, ...next } : set,
      ),
    });
  };

  const addPicked = () => {
    const additions = (catalog.data?.exercises ?? [])
      .filter((e) => picked.includes(e.id))
      .map((e) => newExercise(e, [emptySet()]));
    setExercises((prev) => [...prev, ...additions]);
    setPicked([]);
    setPickerOpen(false);
  };

  const submit = () => {
    if (name.trim().length === 0) {
      setError("Beri nama rutinitasnya dulu.");
      return;
    }
    if (exercises.length === 0) {
      setError("Tambahkan minimal satu gerakan.");
      return;
    }
    setError(null);
    save.mutate({
      id: params.id,
      name: name.trim(),
      note: note.trim().length > 0 ? note.trim() : undefined,
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        restSec: exercise.restSec,
        note: exercise.note.trim().length > 0 ? exercise.note.trim() : null,
        sets: exercise.sets.map((set) => ({
          setType: set.type,
          reps: showsDuration(exercise.type) || set.reps.trim() === "" ? null : Number(set.reps.replace(",", ".")),
          weightKg:
            !showsWeight(exercise.type) || set.weightKg.trim() === ""
              ? null
              : Number(set.weightKg.replace(",", ".")),
          durationSec: showsDuration(exercise.type) && set.durationSec.trim() !== ""
            ? Number(set.durationSec.replace(",", "."))
            : null,
        })),
      })),
    });
  };

  const [confirmDelete, setConfirmDelete] = useState(false);

  const askDelete = () => {
    if (params.id === undefined) return;
    setConfirmDelete(true);
  };

  return (
    <>
      <Stack.Screen options={{ title: params.id ? "Edit rutinitas" : "Rutinitas baru" }} />
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <Field label="Nama rutinitas">
          <Input value={name} onChangeText={setName} placeholder="mis. Push Senin" />
        </Field>
        <Field label="Catatan (opsional)">
          <Input value={note} onChangeText={setNote} placeholder="Target 4 set tiap gerakan" multiline />
        </Field>

        {exercises.map((exercise, exerciseIndex) => (
          <Card key={`${exercise.exerciseId}-${exerciseIndex}`} style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.exerciseName} numberOfLines={1}>
                {exercise.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Hapus ${exercise.name}`}
                hitSlop={8}
                onPress={() =>
                  setExercises((prev) => prev.filter((_, i) => i !== exerciseIndex))
                }
                style={({ pressed }) => [pressed && { opacity: 0.5 }]}
              >
                <Ionicons name="trash-outline" size={16} color={theme.colors.destructive} />
              </Pressable>
            </View>
            <View style={styles.chipRow}>
              {REST_OPTIONS.map((option) => (
                <Chip
                  key={option.label}
                  label={option.label}
                  selected={exercise.restSec === option.value}
                  onPress={() => patchExercise(exerciseIndex, { restSec: option.value })}
                />
              ))}
            </View>
            <View style={styles.setHeader}>
              <Text style={[styles.setHeaderCell, styles.colSet]}>SET</Text>
              <Text style={styles.setHeaderCell}>{showsDuration(exercise.type) ? "DETIK" : "REPS"}</Text>
              {showsWeight(exercise.type) ? <Text style={styles.setHeaderCell}>KG</Text> : null}
            </View>
            {exercise.sets.map((set, setIndex) => (
              <View key={setIndex} style={styles.setRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Tipe set ${setIndex + 1}`}
                  onPress={() => patchSet(exerciseIndex, setIndex, { type: nextSetType(set.type) })}
                  style={[styles.setType, set.type !== "normal" && { backgroundColor: theme.colors.muted }]}
                >
                  <Text style={styles.setTypeText}>
                    {set.type === "normal" ? setIndex + 1 : SET_TYPE_LABEL[set.type]}
                  </Text>
                </Pressable>
                {showsDuration(exercise.type) ? (
                  <Input
                    value={set.durationSec}
                    onChangeText={(durationSec) => patchSet(exerciseIndex, setIndex, { durationSec })}
                    placeholder="45"
                    keyboardType="number-pad"
                    style={styles.setInput}
                  />
                ) : (
                  <Input
                    value={set.reps}
                    onChangeText={(reps) => patchSet(exerciseIndex, setIndex, { reps })}
                    placeholder="10"
                    keyboardType="number-pad"
                    style={styles.setInput}
                  />
                )}
                {showsWeight(exercise.type) ? (
                  <Input
                    value={set.weightKg}
                    onChangeText={(weightKg) => patchSet(exerciseIndex, setIndex, { weightKg })}
                    placeholder="40"
                    keyboardType="decimal-pad"
                    style={styles.setInput}
                  />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Hapus set ${setIndex + 1}`}
                  disabled={exercise.sets.length <= 1}
                  onPress={() =>
                    patchExercise(exerciseIndex, {
                      sets: exercise.sets.filter((_, si) => si !== setIndex),
                    })
                  }
                  style={({ pressed }) => [styles.removeSet, pressed && { opacity: 0.5 }]}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={16}
                    color={exercise.sets.length <= 1 ? theme.colors.mutedForeground : theme.colors.destructive}
                  />
                </Pressable>
              </View>
            ))}
            <Button
              variant="secondary"
              size="sm"
              label="Tambah set"
              icon="add"
              style={styles.addSet}
              onPress={() => {
                const last = exercise.sets[exercise.sets.length - 1];
                patchExercise(exerciseIndex, {
                  sets: [...exercise.sets, last ? { ...last, done: false } : emptySet()],
                });
              }}
            />
          </Card>
        ))}

        <Button label="Tambah latihan" icon="add" onPress={() => setPickerOpen(true)} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={save.isPending ? "Menyimpan…" : "Simpan rutinitas"}
          onPress={submit}
          disabled={save.isPending}
          loading={save.isPending}
        />
        {params.id ? (
          <Button
            variant="secondary"
            destructive
            label="Hapus rutinitas"
            onPress={askDelete}
          />
        ) : null}
      </KeyboardAwareScrollView>

      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Tambah latihan"
        footer={
          <Button
            label={picked.length > 0 ? `Tambah (${picked.length})` : "Tambah"}
            onPress={addPicked}
            disabled={picked.length === 0}
          />
        }
      >
        <ExercisePickerList
          selected={picked}
          onToggle={(exercise) =>
            setPicked((prev) =>
              prev.includes(exercise.id)
                ? prev.filter((id) => id !== exercise.id)
                : [...prev, exercise.id],
            )
          }
        />
      </Sheet>

      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Hapus rutinitas?"
        message="Rutinitas ini hilang dari daftar."
        confirmLabel="Hapus"
        onConfirm={() => {
          setConfirmDelete(false);
          if (params.id !== undefined) {
            const row = (queryClient.getQueryData<RoutineRow[]>(routinesKey) ?? []).find(
              (item) => item.id === params.id,
            );
            if (row) remove(row);
            router.back();
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  card: { gap: theme.spacing.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  exerciseName: { flex: 1, fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  setHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  setHeaderCell: { flex: 1, fontSize: 10, fontWeight: "700", color: theme.colors.mutedForeground },
  colSet: { flex: 0, width: 34, textAlign: "center" },
  setRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  setType: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  setTypeText: { fontSize: theme.fontSize.sm, fontWeight: "800", color: theme.colors.foreground },
  setInput: { flex: 1, paddingHorizontal: 10, height: 40 },
  removeSet: { width: 24, alignItems: "center" },
  addSet: { alignSelf: "flex-start" },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, fontWeight: "600" },
}));
