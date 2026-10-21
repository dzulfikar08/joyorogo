import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Card, CountNum, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

type WaterToday = { glasses: number; goal: number };
type WaterInput = { date?: string };

/** Glass count of the viewed day plus optimistic add/remove (with undo toast). */
export function useWater(date?: string) {
  const { t } = useTranslation("home");
  const today = useQuery(
    orpc.water.today.queryOptions({ input: date === undefined ? {} : { date } }),
  );

  const [error, setError] = useState<string | null>(null);
  const onError = (e: Error) => setError(errorMessage(e));

  const add = useOptimisticMutation<WaterInput, unknown>({
    mutationFn: (input) => client.water.add(input),
    patch: (input, cache) => {
      const key = orpc.water.today.queryOptions({ input }).queryKey;
      cache.value<WaterToday>(key, (prev) => ({
        glasses: (prev?.glasses ?? 0) + 1,
        goal: prev?.goal ?? 8,
      }));
    },
    success: (_input, _data) => ({
      message: t("water.added"),
      undo: () => remove.mutate(date === undefined ? {} : { date }),
    }),
    onError,
    invalidate: () => [orpc.water.key(), orpc.day.key()],
  });
  const remove = useOptimisticMutation<WaterInput, unknown>({
    mutationFn: (input) => client.water.remove(input),
    patch: (input, cache) => {
      const key = orpc.water.today.queryOptions({ input }).queryKey;
      cache.value<WaterToday>(key, (prev) => ({
        glasses: Math.max((prev?.glasses ?? 1) - 1, 0),
        goal: prev?.goal ?? 8,
      }));
    },
    success: (_input, _data) => ({
      message: t("water.removed"),
      undo: () => add.mutate(date === undefined ? {} : { date }),
    }),
    onError,
    invalidate: () => [orpc.water.key(), orpc.day.key()],
  });

  return {
    glasses: today.data?.glasses ?? 0,
    goal: today.data?.goal ?? 8,
    busy: add.isPending || remove.isPending,
    loadError: today.isError,
    error,
    add: () => add.mutate(date === undefined ? {} : { date }),
    remove: () => remove.mutate(date === undefined ? {} : { date }),
  };
}

/**
 * Penghitung gelas air per hari — data sama dengan kartu air di dashboard web. `bare` is for the Air
 * screen, whose page title already says what this is: just the count, the goal, the bar and − / +.
 */
export function WaterCard({ date, bare = false }: { date?: string; bare?: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("home");
  const { glasses, goal, busy, loadError, error, add, remove } = useWater(date);
  const ratio = goal > 0 ? Math.min(1, glasses / goal) : 0;

  const controls = (
    <View style={styles.controls}>
      <PressableScale
        onPress={remove}
        disabled={busy || glasses <= 0}
        accessibilityLabel={t("water.less")}
        accessibilityRole="button"
        hitSlop={4}
        scaleTo={0.88}
        style={[
          styles.roundButton,
          { backgroundColor: theme.colors.muted },
          glasses <= 0 && styles.pressedSoft,
        ]}
      >
        <Ionicons name="remove" size={18} color={theme.colors.foreground} />
      </PressableScale>
      <PressableScale
        onPress={add}
        disabled={busy}
        accessibilityLabel={t("water.more")}
        accessibilityRole="button"
        hitSlop={4}
        scaleTo={0.88}
        style={[styles.roundButton, { backgroundColor: theme.colors.primary }]}
      >
        <Ionicons name="add" size={18} color={theme.colors.primaryForeground} />
      </PressableScale>
    </View>
  );
  const fill = (
    <View
      style={{
        width: `${ratio * 100}%`,
        height: "100%",
        borderRadius: 999,
        backgroundColor: theme.colors.tidur,
      }}
    />
  );
  const status = error ? (
    <Text style={styles.errorText}>{error}</Text>
  ) : loadError ? (
    <Text style={styles.errorText}>{t("water.loadError")}</Text>
  ) : null;

  if (bare) {
    return (
      <Card style={styles.card}>
        <View style={styles.headRow}>
          <View style={styles.bareValue}>
            <CountNum value={glasses} format={String} style={styles.valueBare} />
            <Text style={styles.unit}>{t("water.ofGoal", { count: goal })}</Text>
          </View>
          {controls}
        </View>
        <View style={styles.trackBare}>{fill}</View>
        {status}
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.headRow}>
        <View style={[styles.iconChip, { backgroundColor: theme.colors.tidurSoft }]}>
          <Ionicons name="water" size={16} color={theme.colors.tidurText} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.label}>{t("water.title")}</Text>
          <Text style={styles.hint}>{t("water.hint")}</Text>
        </View>
        {controls}
      </View>
      <View style={styles.valueRow}>
        <CountNum value={glasses} format={String} style={styles.value} />
        <Text style={styles.unit}>{t("water.ofGoal", { count: goal })}</Text>
        <View style={styles.track}>{fill}</View>
      </View>
      {status}
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
  bareValue: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
  },
  valueBare: {
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  trackBare: {
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
