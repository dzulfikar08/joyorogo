import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { sessionKcal } from "@joyorogo/api/lib/workout";

import {
  Button,
  Card,
  Chip,
  Field,
  Input,
  Num,
  Sheet,
  Text,
} from "@/components/ui";
import { errorMessage, fmtInt, parseNum } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

/** One editable set; strings because the inputs own the draft values. */
export type EditorSet = { reps: string; weightKg: string; rpe: string };
export type EditorExercise = { exerciseId: string; name: string; sets: EditorSet[] };
export type SessionDraft = {
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
export function draftFromSession(item: {
  session: { name: string; durationMin: number | null; note: string | null };
  sets: { exerciseId: string; reps: number | null; weightKg: number | null; rpe: number | null }[];
}, nameOf: (exerciseId: string) => string): SessionDraft {
  const grouped = new Map<string, EditorExercise>();
  for (const set of item.sets) {
    let exercise = grouped.get(set.exerciseId);
    if (!exercise) {
      exercise = { exerciseId: set.exerciseId, name: nameOf(set.exerciseId), sets: [] };
      grouped.set(set.exerciseId, exercise);
    }
    exercise.sets.push({
      reps: set.reps != null ? String(set.reps) : "",
      weightKg: set.weightKg != null ? String(set.weightKg) : "",
      rpe: set.rpe != null ? String(set.rpe) : "",
    });
  }
  return {
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

/** Searchable movement catalog in a sheet; picking adds it to the session. */
function ExercisePicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (exercise: { id: string; name: string }) => void;
}) {
  const { theme } = useUnistyles();
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const [query, setQuery] = useState("");
  const [equipment, setEquipment] = useState("all");

  const filters = catalog.data?.equipment ?? [];
  const q = query.trim().toLowerCase();
  const filtered = (catalog.data?.exercises ?? []).filter(
    (exercise) =>
      (equipment === "all" || exercise.equipment === equipment) &&
      (q.length === 0 ||
        exercise.name.toLowerCase().includes(q) ||
        exercise.id.includes(q)),
  );
  const muscleLabel = (key: string) =>
    catalog.data?.muscles.find((m) => m.key === key)?.label ?? key;
  const equipmentLabel = (key: string) =>
    filters.find((f) => f.key === key)?.label ?? key;

  return (
    <Sheet visible={visible} onClose={onClose} title="Tambah gerakan">
      <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }}>
        <Field label="Cari gerakan">
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="mis. bench"
            autoCapitalize="none"
          />
        </Field>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pickerStyles.chipRow}>
          <Chip label="Semua" selected={equipment === "all"} onPress={() => setEquipment("all")} />
          {filters.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              selected={equipment === f.key}
              onPress={() => setEquipment(f.key)}
            />
          ))}
        </ScrollView>
        <View style={pickerStyles.list}>
          {filtered.map((exercise) => (
            <Pressable
              key={exercise.id}
              accessibilityRole="button"
              accessibilityLabel={`Tambah ${exercise.name}`}
              onPress={() => {
                onPick(exercise);
                onClose();
              }}
              style={({ pressed }) => [
                pickerStyles.row,
                pressed && { backgroundColor: theme.colors.muted },
              ]}
            >
              <View style={pickerStyles.rowText}>
                <Text style={pickerStyles.rowTitle}>{exercise.name}</Text>
                <Text style={pickerStyles.rowSub}>
                  {exercise.primary.map(muscleLabel).join(", ")}
                </Text>
              </View>
              <Text style={pickerStyles.rowTag}>{equipmentLabel(exercise.equipment)}</Text>
            </Pressable>
          ))}
          {filtered.length === 0 && !catalog.isPending ? (
            <Text style={pickerStyles.empty}>Tidak ketemu. Coba kata kunci lain.</Text>
          ) : null}
        </View>
      </KeyboardAwareScrollView>
    </Sheet>
  );
}

const pickerStyles = StyleSheet.create((theme) => ({
  chipRow: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  list: { gap: theme.spacing.xs, paddingBottom: theme.spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 16,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.foreground },
  rowSub: { fontSize: 12, color: theme.colors.mutedForeground, marginTop: 2 },
  rowTag: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
    backgroundColor: theme.colors.muted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  empty: { color: theme.colors.mutedForeground, fontSize: 13, textAlign: "center", padding: 16 },
}));

export function SessionEditor({ draft, onClose }: { draft: SessionDraft; onClose: () => void }) {
  const { theme } = useUnistyles();
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const [state, setState] = useState<SessionDraft>(draft);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weightKg = profile.data?.latestWeightKg ?? null;

  type SavedSession = { id: string };
  const save = useOptimisticMutation<
    Parameters<typeof client.workout.saveSession>[0],
    SavedSession
  >({
    mutationFn: async (input) => {
      const result = (await client.workout.saveSession(input)) as { id?: string };
      if (result.id === undefined) throw new Error("Gagal menyimpan latihan.");
      return { id: result.id };
    },
    success: (_input, data) => {
      queryClient.invalidateQueries({ queryKey: orpc.workout.key() });
      onClose();
      return {
        message: "Latihan tersimpan",
        undo: () => {
          void client.workout.deleteSession({ id: data.id }).then(() => {
            void queryClient.invalidateQueries({ queryKey: orpc.workout.key() });
            void queryClient.invalidateQueries({ queryKey: orpc.day.key() });
          });
        },
      };
    },
    onError: (e) => setError(errorMessage(e)),
    invalidate: () => [orpc.workout.key(), orpc.day.key()],
  });

  const minutes = parseNum(state.durationMin);
  const kcalEstimate = minutes !== null && weightKg !== null ? sessionKcal(minutes, weightKg) : null;

  const patchExercise = (index: number, sets: EditorSet[]) => {
    setState((prev) => ({
      ...prev,
      exercises: prev.exercises.map((exercise, i) =>
        i === index ? { ...exercise, sets } : exercise,
      ),
    }));
  };

  const addExercise = (exercise: { id: string; name: string }) => {
    setState((prev) => ({
      ...prev,
      exercises: [
        ...prev.exercises,
        { exerciseId: exercise.id, name: exercise.name, sets: [{ ...emptySet }] },
      ],
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
    save.mutate({
      name: state.name.trim(),
      durationMin: minutes !== null ? Math.max(1, Math.round(minutes)) : undefined,
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
    <Card>
      <View style={editorStyles.headRow}>
        <Text style={editorStyles.title}>Sesi baru</Text>
        <Button variant="secondary" size="sm" label="Tutup" onPress={onClose} />
      </View>

      <Field label="Nama sesi">
        <Input
          value={state.name}
          onChangeText={(name) => setState((prev) => ({ ...prev, name }))}
          placeholder="Push Senin"
        />
      </Field>
      <Field
        label="Durasi (menit)"
        hint={
          kcalEstimate !== null
            ? `Perkiraan ${fmtInt(kcalEstimate)} kcal masuk ke angka bakar saat disimpan.`
            : "Isi durasi untuk perkiraan kalori."
        }
      >
        <Input
          value={state.durationMin}
          onChangeText={(durationMin) => setState((prev) => ({ ...prev, durationMin }))}
          placeholder="45"
          keyboardType="number-pad"
        />
      </Field>

      {state.exercises.map((exercise, exerciseIndex) => (
        <View key={`${exercise.exerciseId}-${exerciseIndex}`} style={editorStyles.exerciseBox}>
          <View style={editorStyles.exerciseHead}>
            <Text style={editorStyles.exerciseName} numberOfLines={1}>
              {exercise.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Hapus ${exercise.name}`}
              hitSlop={8}
              onPress={() =>
                setState((prev) => ({
                  ...prev,
                  exercises: prev.exercises.filter((_, i) => i !== exerciseIndex),
                }))
              }
              style={({ pressed }) => [editorStyles.trash, pressed && editorStyles.pressed]}
            >
              <Ionicons name="trash-outline" size={16} color={theme.colors.destructive} />
            </Pressable>
          </View>
          <View style={editorStyles.setHeader}>
            <Text style={editorStyles.setHeaderCell}>Set</Text>
            <Text style={editorStyles.setHeaderCell}>Reps</Text>
            <Text style={editorStyles.setHeaderCell}>Kg</Text>
            <Text style={editorStyles.setHeaderCell}>RPE</Text>
          </View>
          {exercise.sets.map((set, setIndex) => (
            <View key={setIndex} style={editorStyles.setRow}>
              <Num style={editorStyles.setIndex}>{setIndex + 1}</Num>
              <Input
                value={set.reps}
                onChangeText={(text) =>
                  patchExercise(
                    exerciseIndex,
                    exercise.sets.map((s, i) => (i === setIndex ? { ...s, reps: text } : s)),
                  )
                }
                placeholder="10"
                keyboardType="number-pad"
                style={editorStyles.setInput}
              />
              <Input
                value={set.weightKg}
                onChangeText={(text) =>
                  patchExercise(
                    exerciseIndex,
                    exercise.sets.map((s, i) => (i === setIndex ? { ...s, weightKg: text } : s)),
                  )
                }
                placeholder="40"
                keyboardType="decimal-pad"
                style={editorStyles.setInput}
              />
              <Input
                value={set.rpe}
                onChangeText={(text) =>
                  patchExercise(
                    exerciseIndex,
                    exercise.sets.map((s, i) => (i === setIndex ? { ...s, rpe: text } : s)),
                  )
                }
                placeholder="–"
                keyboardType="decimal-pad"
                style={editorStyles.setInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Hapus set ${setIndex + 1}`}
                hitSlop={6}
                disabled={exercise.sets.length <= 1}
                onPress={() =>
                  patchExercise(exerciseIndex, exercise.sets.filter((_, i) => i !== setIndex))
                }
                style={({ pressed }) => [editorStyles.trash, pressed && editorStyles.pressed]}
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
            style={editorStyles.addSet}
            onPress={() => patchExercise(exerciseIndex, [...exercise.sets, { ...emptySet }])}
          />
        </View>
      ))}

      <Button
        variant="secondary"
        label="Tambah gerakan"
        icon="add"
        onPress={() => setPickerOpen(true)}
      />

      <Field label="Catatan (opsional)">
        <Input
          value={state.note}
          onChangeText={(note) => setState((prev) => ({ ...prev, note }))}
          placeholder="Naikkan beban squat minggu depan"
          multiline
        />
      </Field>

      {error ? <Text style={editorStyles.error}>{error}</Text> : null}
      <Button
        label={save.isPending ? "Menyimpan…" : "Simpan sesi"}
        onPress={submit}
        disabled={save.isPending}
        loading={save.isPending}
      />

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addExercise}
      />
    </Card>
  );
}

const editorStyles = StyleSheet.create((theme) => ({
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  title: { fontSize: 16, fontWeight: "700", color: theme.colors.foreground },
  exerciseBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
    borderRadius: 18,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  exerciseHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  exerciseName: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.colors.foreground },
  setHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  setHeaderCell: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  setRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  setIndex: {
    width: 16,
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  setInput: { flex: 1, paddingHorizontal: 10 },
  addSet: { alignSelf: "flex-start" },
  trash: { width: 24, alignItems: "center" },
  pressed: { opacity: 0.5 },
  error: { color: theme.colors.destructive, fontSize: 13, fontWeight: "600" },
}));
