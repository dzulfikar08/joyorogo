import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  EXERCISE_TYPES,
  type EquipmentKey,
  type MuscleKey,
} from "@joyorogo/api/lib/exercises";
import { equipmentLabel, exerciseTypeLabel, muscleLabel } from "@joyorogo/api/lib/workout";

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
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

type CatalogExercise = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  type: ExerciseType;
  custom?: boolean;
};

/** Multi-select exercise picker; mode=add appends, mode=replace swaps one card. */
export default function LatihanPilih() {
  const { t } = useTranslation(["olahraga", "common"]);
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

  return (
    <>
      <Stack.Screen
        options={{
          title: mode === "replace" ? t("latihan.action.replaceExercise") : t("latihan.action.addExercise"),
        }}
      />
      <View style={styles.root}>
        <View style={styles.searchArea}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={t("latihan.picker.search")}
            autoCapitalize="none"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label={t("latihan.picker.allMuscles")} selected={muscle === "all"} onPress={() => setMuscle("all")} />
            {(catalog.data?.muscles ?? []).map((m) => (
              <Chip
                key={m.id}
                label={muscleLabel(m.id as MuscleKey)}
                selected={muscle === m.id}
                onPress={() => setMuscle(m.id)}
              />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label={t("latihan.picker.allEquipment")} selected={equipment === "all"} onPress={() => setEquipment("all")} />
            {(catalog.data?.equipment ?? []).map((e) => (
              <Chip
                key={e.id}
                label={equipmentLabel(e.id as EquipmentKey)}
                selected={equipment === e.id}
                onPress={() => setEquipment(e.id)}
              />
            ))}
          </ScrollView>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {catalog.isPending ? (
            <Card><Text style={styles.empty}>{t("common:state.loading")}</Text></Card>
          ) : filtered.length === 0 ? (
            <Card>
              <Text style={styles.emptyTitle}>{t("latihan.picker.empty.title")}</Text>
              <Text style={styles.empty}>{t("latihan.picker.empty.hint")}</Text>
            </Card>
          ) : (
            filtered.map((exercise) => {
              const isSelected = selected.includes(exercise.id);
              return (
                <Pressable
                  key={exercise.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("latihan.picker.select", { name: exercise.name })}
                  onPress={() => toggle(exercise.id)}
                  style={({ pressed }) => [
                    styles.row,
                    isSelected && styles.rowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {exercise.custom
                        ? t("latihan.picker.customName", { name: exercise.name })
                        : exercise.name}
                    </Text>
                    <Text style={styles.rowSub}>
                      {muscleLabel(exercise.muscle as MuscleKey)} ·{" "}
                      {equipmentLabel(exercise.equipment as EquipmentKey)}
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
          <Button variant="secondary" label={t("latihan.picker.create")} icon="add" onPress={() => setCreateOpen(true)} />
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={
              mode === "replace"
                ? t("latihan.picker.replace")
                : t("latihan.picker.addCount", { n: selected.length })
            }
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
  const { t } = useTranslation("olahraga");
  const [name, setName] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [type, setType] = useState<ExerciseType>("weight_reps");
  const [error, setError] = useState<string | null>(null);

  const create = useOptimisticMutation<
    Parameters<typeof client.workout.createCustomExercise>[0],
    CatalogExercise
  >({
    mutationFn: (input) => client.workout.createCustomExercise(input),
    patch: (input, cache) => {
      cache.value<{ exercises: CatalogExercise[] }>(
        orpc.workout.catalog.queryOptions().queryKey,
        (old) =>
          old === undefined
            ? undefined
            : {
                ...old,
                exercises: [
                  ...old.exercises,
                  {
                    id: `temp-${Date.now()}`,
                    name: input.name,
                    muscle: input.muscle,
                    equipment: input.equipment,
                    type: input.type,
                    custom: true,
                  },
                ],
              },
      );
    },
    success: (input, data) => {
      setName("");
      setError(null);
      onCreated(data);
      onClose();
      return {
        message: t("latihan.picker.toast.created", { name: input.name }),
        undo: () => void client.workout.deleteCustomExercise({ id: data.id }),
      };
    },
    onError: (e) => setError(errorMessage(e)),
    invalidate: () => [orpc.workout.key()],
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={t("latihan.picker.form.title")}>
      <Field label={t("latihan.picker.form.name")}>
        <Input value={name} onChangeText={setName} placeholder={t("latihan.picker.form.namePlaceholder")} />
      </Field>
      <Field label={t("latihan.picker.form.muscle")}>
        <View style={styles.chipRow}>
          {muscles.map((m) => (
            <Chip
              key={m.id}
              label={muscleLabel(m.id as MuscleKey)}
              selected={muscle === m.id}
              onPress={() => setMuscle(m.id)}
            />
          ))}
        </View>
      </Field>
      <Field label={t("latihan.picker.form.equipment")}>
        <View style={styles.chipRow}>
          {equipments.map((e) => (
            <Chip
              key={e.id}
              label={equipmentLabel(e.id as EquipmentKey)}
              selected={equipment === e.id}
              onPress={() => setEquipment(e.id)}
            />
          ))}
        </View>
      </Field>
      <Field label={t("latihan.picker.form.type")}>
        <View style={styles.chipRow}>
          {EXERCISE_TYPES.map((item) => (
            <Chip
              key={item}
              label={exerciseTypeLabel(item)}
              selected={type === item}
              onPress={() => setType(item)}
            />
          ))}
        </View>
      </Field>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={create.isPending ? t("latihan.summary.saving") : t("latihan.picker.form.create")}
        disabled={create.isPending}
        loading={create.isPending}
        onPress={() => {
          if (name.trim().length === 0) {
            setError(t("latihan.picker.error.name"));
            return;
          }
          if (muscle === null || equipment === null) {
            setError(t("latihan.picker.error.choose"));
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
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "700" },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, fontWeight: "600" },
}));
