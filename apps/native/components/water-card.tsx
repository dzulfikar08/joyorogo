import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Card, Num, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

// Penghitung gelas air hari ini — data sama dengan kartu air di dashboard web.
export function WaterCard() {
  const { theme } = useUnistyles();
  const today = useQuery(orpc.water.today.queryOptions());

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: orpc.water.key() });
    queryClient.invalidateQueries({ queryKey: orpc.day.key() });
  };

  const [error, setError] = useState<string | null>(null);
  const onError = (e: Error) => setError(errorMessage(e));
  const add = useMutation(orpc.water.add.mutationOptions({ onSuccess: refresh, onError }));
  const remove = useMutation(orpc.water.remove.mutationOptions({ onSuccess: refresh, onError }));

  const glasses = today.data?.glasses ?? 0;
  const goal = today.data?.goal ?? 8;
  const busy = add.isPending || remove.isPending;
  const ratio = goal > 0 ? Math.min(1, glasses / goal) : 0;

  return (
    <Card style={styles.card}>
      <View style={styles.headRow}>
        <View style={[styles.iconChip, { backgroundColor: theme.colors.tidurSoft }]}>
          <Ionicons name="water" size={16} color={theme.colors.tidurText} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.label}>Air minum</Text>
          <Text style={styles.hint}>Segelas tiap habis makan bikin kenyang lebih lama.</Text>
        </View>
        <View style={styles.controls}>
          <Pressable
            onPress={() => remove.mutate()}
            disabled={busy || glasses <= 0}
            accessibilityLabel="Kurangi gelas air"
            accessibilityRole="button"
            hitSlop={4}
            style={({ pressed }) => [
              styles.roundButton,
              { backgroundColor: theme.colors.muted },
              (pressed || glasses <= 0) && styles.pressedSoft,
            ]}
          >
            <Ionicons name="remove" size={18} color={theme.colors.foreground} />
          </Pressable>
          <Pressable
            onPress={() => add.mutate()}
            disabled={busy}
            accessibilityLabel="Tambah gelas air"
            accessibilityRole="button"
            hitSlop={4}
            style={({ pressed }) => [
              styles.roundButton,
              { backgroundColor: theme.colors.primary },
              pressed && styles.pressedSoft,
            ]}
          >
            <Ionicons name="add" size={18} color={theme.colors.primaryForeground} />
          </Pressable>
        </View>
      </View>
      <View style={styles.valueRow}>
        <Num style={styles.value}>{glasses}</Num>
        <Text style={styles.unit}>/ {goal} gelas</Text>
        <View style={styles.track}>
          <View
            style={{
              width: `${ratio * 100}%`,
              height: "100%",
              borderRadius: 999,
              backgroundColor: theme.colors.tidur,
            }}
          />
        </View>
      </View>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : today.isError ? (
        <Text style={styles.errorText}>Gagal memuat data air. Coba lagi dalam sesaat.</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: {
    flex: 1,
    gap: 1,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 16,
  },
  controls: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  value: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  unit: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.tidurSoft,
    overflow: "hidden",
  },
  pressedSoft: {
    opacity: 0.7,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
}));
