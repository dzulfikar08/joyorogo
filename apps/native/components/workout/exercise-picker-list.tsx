import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Chip, Input, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

type CatalogExercise = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  custom?: boolean;
};

/**
 * Searchable catalog list with muscle/equipment chips, used inside sheets.
 * Selection is owned by the caller; rows report taps via onToggle.
 */
export function ExercisePickerList({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (exercise: { id: string; name: string }) => void;
}) {
  const { theme } = useUnistyles();
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState("all");
  const [equipment, setEquipment] = useState("all");

  const exercises = catalog.data?.exercises ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter(
      (exercise) =>
        (muscle === "all" || exercise.muscle === muscle) &&
        (equipment === "all" || exercise.equipment === equipment) &&
        (q.length === 0 || exercise.name.toLowerCase().includes(q)),
    );
  }, [exercises, query, muscle, equipment]);

  const label = (list: { id: string; label: string }[], id: string) =>
    list.find((item) => item.id === id)?.label ?? id;

  return (
    <View style={styles.root}>
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
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {filtered.map((exercise) => {
          const isSelected = selected.includes(exercise.id);
          return (
            <Pressable
              key={exercise.id}
              accessibilityRole="button"
              accessibilityLabel={`Pilih ${exercise.name}`}
              onPress={() => onToggle(exercise)}
              style={({ pressed }) => [
                styles.row,
                isSelected && { backgroundColor: theme.colors.makanSoft },
                pressed && { opacity: 0.7 },
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
              <Text style={styles.rowAction}>{isSelected ? "Dipilih" : "Pilih"}</Text>
            </Pressable>
          );
        })}
        {filtered.length === 0 && !catalog.isPending ? (
          <Text style={styles.empty}>Tidak ketemu. Coba kata kunci lain.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing.sm, maxHeight: 420 },
  chipRow: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  list: { minHeight: 160 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.foreground },
  rowSub: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground, marginTop: 2 },
  rowAction: { fontSize: theme.fontSize.xs, fontWeight: "700", color: theme.colors.primary },
  empty: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm, textAlign: "center", padding: theme.spacing.lg },
}));
