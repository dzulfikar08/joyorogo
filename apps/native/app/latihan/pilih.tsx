import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

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
  newExercise,
  setActiveWorkout,
  useActiveWorkout,
  type ExerciseType,
} from "@/lib/workout/active";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

type CatalogExercise = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  type: ExerciseType;
  custom?: boolean;
};

const TYPE_OPTIONS: Array<{ value: ExerciseType; label: string }> = [
  { value: "weight_reps", label: "Beban + reps" },
  { value: "bodyweight_reps", label: "Berat badan" },
  { value: "assisted", label: "Berbantu" },
  { value: "duration", label: "Durasi" },
  { value: "distance_duration", label: "Jarak + durasi" },
];

/** Multi-select exercise picker; mode=add appends, mode=replace swaps one card. */
export default function LatihanPilih() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const params = useLocalSearchParams<{ mode?: string; index?: string }>();
  const mode = params.mode === "replace" ? "replace" : "add";
  const replaceIndex = params.index != null ? Number(params.index) : -1;

  const workout = useActiveWorkout();
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const recent = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 5 } }));
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState("all");
  const [equipment, setEquipment] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const exercises = catalog.data?.exercises ?? [];

  // Recently used first: order by latest appearance across the last few
  // saved sessions; untouched catalog order after that.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = exercises.filter(
      (exercise) =>
        (muscle === "all" || exercise.muscle === muscle) &&
        (equipment === "all" || exercise.equipment === equipment) &&
        (q.length === 0 || exercise.name.toLowerCase().includes(q)),
    );
    const rank = new Map<string, number>();
    for (const item of recent.data?.items ?? []) {
      for (const set of item.sets) {
        if (!rank.has(set.exerciseId)) rank.set(set.exerciseId, rank.size);
      }
    }
    return [...matched].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [exercises, query, muscle, equipment, recent.data]);

  if (gate === "loading") return null;

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const apply = () => {
    const picked = exercises.filter((e) => selected.includes(e.id));
    if (picked.length === 0) return;
    if (mode === "replace" && workout && replaceIndex >= 0) {
      const replacement = newExercise(picked[0]!);
      // Keep the card's sets, note, rest and superset pairing when swapping.
      const old = workout.exercises[replaceIndex];
      if (old) {
        replacement.sets = old.sets;
        replacement.note = old.note;
        replacement.restSec = old.restSec;
        replacement.supersetGroup = old.supersetGroup;
      }
      setActiveWorkout({
        ...workout,
        exercises: workout.exercises.map((exercise, i) => (i === replaceIndex ? replacement : exercise)),
      });
    } else {
      const additions = picked.map((exercise) => newExercise(exercise));
      if (workout) {
        setActiveWorkout({ ...workout, exercises: [...workout.exercises, ...additions] });
      } else {
        setActiveWorkout({
          name: "",
          note: "",
          startedAt: Date.now(),
          exercises: additions,
        });
      }
    }
    router.back();
  };

  const label = (list: { id: string; label: string }[], id: string) =>
    list.find((item) => item.id === id)?.label ?? id;

  return (
    <>
      <Stack.Screen options={{ title: mode === "replace" ? "Ganti latihan" : "Tambah latihan" }} />
      <View style={styles.root}>
        <View style={styles.searchArea}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Cari gerakan…"
            autoCapitalize="none"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label="Semua otot" selected={muscle === "all"} onPress={() => setMuscle("all")} />
            {(catalog.data?.muscles ?? []).map((m) => (
              <Chip key={m.id} label={m.label} selected={muscle === m.id} onPress={() => setMuscle(m.id)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label="Semua alat" selected={equipment === "all"} onPress={() => setEquipment("all")} />
            {(catalog.data?.equipment ?? []).map((e) => (
              <Chip key={e.id} label={e.label} selected={equipment === e.id} onPress={() => setEquipment(e.id)} />
            ))}
          </ScrollView>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {catalog.isPending ? (
            <Card><Text style={styles.empty}>Memuat daftar gerakan…</Text></Card>
          ) : filtered.length === 0 ? (
            <Card>
              <Text style={styles.empty}>Tidak ketemu. Coba kata kunci lain atau buat gerakan baru.</Text>
            </Card>
          ) : (
            filtered.map((exercise) => {
              const isSelected = selected.includes(exercise.id);
              return (
                <Pressable
                  key={exercise.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Pilih ${exercise.name}`}
                  onPress={() => toggle(exercise.id)}
                  style={({ pressed }) => [
                    styles.row,
                    isSelected && styles.rowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {exercise.name}
                      {exercise.custom ? " (buatanmu)" : ""}
                    </Text>
                    <Text style={styles.rowSub}>
                      {label(catalog.data?.muscles ?? [], exercise.muscle)} ·{" "}
                      {label(catalog.data?.equipment ?? [], exercise.equipment)}
                    </Text>
                  </View>
                  <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                    <Ionicons
                      name={isSelected ? "checkmark" : "add"}
                      size={16}
                      color={isSelected ? theme.colors.primaryForeground : theme.colors.mutedForeground}
                    />
                  </View>
                </Pressable>
              );
            })
          )}
          <Button variant="secondary" label="Buat gerakan baru" icon="add" onPress={() => setCreateOpen(true)} />
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={mode === "replace" ? "Ganti" : `Tambah (${selected.length})`}
            onPress={apply}
            disabled={selected.length === 0}
          />
        </View>
      </View>

      <CreateExerciseSheet
        visible={createOpen}
        muscles={catalog.data?.muscles ?? []}
        equipments={catalog.data?.equipment ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={(exercise) => {
          void queryClient.invalidateQueries({ queryKey: [] });
          setSelected((prev) => [...prev, exercise.id]);
        }}
      />
    </>
  );
}



function CreateExerciseSheet({
  visible,
  muscles,
  equipments,
  onClose,
  onCreated,
}: {
  visible: boolean;
  muscles: { id: string; label: string }[];
  equipments: { id: string; label: string }[];
  onClose: () => void;
  onCreated: (exercise: CatalogExercise) => void;
}) {
  const [name, setName] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [type, setType] = useState<ExerciseType>("weight_reps");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(
    orpc.workout.createCustomExercise.mutationOptions({
      onSuccess: (exercise) => {
        setName("");
        setError(null);
        onCreated(exercise as CatalogExercise);
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    }),
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Gerakan baru">
      <Field label="Nama gerakan">
        <Input value={name} onChangeText={setName} placeholder="mis. Leg Press Mesin" />
      </Field>
      <Field label="Otot utama">
        <View style={styles.chipRow}>
          {muscles.map((m) => (
            <Chip key={m.id} label={m.label} selected={muscle === m.id} onPress={() => setMuscle(m.id)} />
          ))}
        </View>
      </Field>
      <Field label="Alat">
        <View style={styles.chipRow}>
          {equipments.map((e) => (
            <Chip key={e.id} label={e.label} selected={equipment === e.id} onPress={() => setEquipment(e.id)} />
          ))}
        </View>
      </Field>
      <Field label="Jenis">
        <View style={styles.chipRow}>
          {TYPE_OPTIONS.map((t) => (
            <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />
          ))}
        </View>
      </Field>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={create.isPending ? "Menyimpan…" : "Buat gerakan"}
        disabled={create.isPending}
        loading={create.isPending}
        onPress={() => {
          if (name.trim().length === 0) {
            setError("Nama gerakannya diisi dulu ya.");
            return;
          }
          if (muscle === null || equipment === null) {
            setError("Pilih otot utama dan alatnya.");
            return;
          }
          create.mutate({ name: name.trim(), muscle, equipment, type } as Parameters<
            typeof create.mutate
          >[0]);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  searchArea: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  chipRow: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  list: { flex: 1 },
  listContent: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
  },
  rowSelected: { backgroundColor: theme.colors.makanSoft },
  pressed: { opacity: 0.7 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.foreground },
  rowSub: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground, marginTop: 2 },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  footer: { padding: theme.spacing.lg },
  empty: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, fontWeight: "600" },
}));
