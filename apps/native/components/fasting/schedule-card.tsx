import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { useEffect, useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import { fmtCountdown, MEAL_KIND_LABELS } from "@joyorogo/api/lib/fasting";

import { Card, Num, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

const idInt = new Intl.NumberFormat("id-ID");

/**
 * "Panduan jadwal makan" di Beranda: status puasa/jendela, hitung mundur,
 * jadwal makan dengan kcal, makan terakhir, sisa kalori, penanda catatan di
 * luar jendela, dan ringkasan mingguan. Nonaktif → tidak dirender.
 */
export function FastingScheduleCard() {
  const { theme } = useUnistyles();
  const today = useQuery({
    ...orpc.fasting.today.queryOptions({ input: {} }),
    refetchInterval: 5 * 60 * 1000,
  });
  const week = useQuery(orpc.fasting.week.queryOptions());

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (today.isPending) {
    return (
      <Card>
        <View style={styles.skeleton} />
      </Card>
    );
  }
  const data = today.data;
  if (today.isError || !data?.active || !data.nextEvent) return null;

  const elapsedMin = Math.max(0, (now.getTime() - today.dataUpdatedAt) / 60_000);
  const nextAway = Math.max(0, Math.ceil(data.nextEvent.minutesAway - elapsedMin));
  const stateLabel =
    data.state === "jendela_makan"
      ? `Jendela makan ${data.windowOpen ?? ""}–${data.windowClose ?? ""}`.trim()
      : "Puasa";

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>Panduan jadwal makan</Text>
        <View
          style={[
            styles.chip,
            {
              backgroundColor:
                data.state === "jendela_makan" ? theme.colors.makanSoft : theme.colors.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              { color: data.state === "jendela_makan" ? theme.colors.makanText : theme.colors.foreground },
            ]}
          >
            {stateLabel}
          </Text>
        </View>
      </View>

      <Text style={styles.countdown} accessibilityLiveRegion="polite">
        {data.nextEvent.label} dalam{" "}
        <Num style={styles.countdownStrong}>{fmtCountdown(nextAway)}</Num>
      </Text>

      <View style={styles.list}>
        {data.schedule.map((entry) => (
          <View
            key={`${entry.time}-${entry.kind}`}
            style={[
              styles.row,
              {
                backgroundColor: entry.past ? theme.colors.background : theme.colors.card,
                opacity: entry.past ? 0.6 : 1,
              },
            ]}
          >
            <Text style={styles.rowLabel} numberOfLines={1}>
              <Num style={styles.rowTime}>{entry.time}</Num> {MEAL_KIND_LABELS[entry.kind]}
              <Text style={styles.rowSlot}> · {MEAL_LABELS[entry.meal]}</Text>
            </Text>
            <Num style={styles.rowKcal}>
              {entry.kcal > 0 ? `±${idInt.format(entry.kcal)} kcal` : "0"}
            </Num>
          </View>
        ))}
      </View>

      <View style={styles.stats}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Sisa jendela ini</Text>
          <Num style={styles.statValue}>{idInt.format(data.remainingKcal)} kcal</Num>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Makan terakhir</Text>
          <Text style={styles.statValue}>
            {data.lastMeal
              ? `${data.lastMeal.time} · ${MEAL_LABELS[data.lastMeal.meal]}`
              : "belum makan"}
          </Text>
        </View>
      </View>

      {data.outsideWindowKcal > 0 ? (
        <View style={[styles.warnBox, { backgroundColor: theme.colors.bakarSoft }]}>
          <Text style={[styles.warnText, { color: theme.colors.bakarText }]}>
            {idInt.format(data.outsideWindowKcal)} kcal dicatat di luar jendela makan (
            {data.outsideWindow.map((log) => `${log.time} ${idInt.format(log.kcal)}`).join(", ")})
          </Text>
        </View>
      ) : null}

      {week.data?.active ? (
        <Text style={styles.weekNote}>
          Minggu ini {week.data.keptDays} dari{" "}
          {week.data.days.filter((day) => day.kept !== null).length} hari sesuai jadwal puasa.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  chip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  countdown: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  countdownStrong: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  list: {
    marginTop: theme.spacing.sm,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  rowTime: {
    fontWeight: "700",
  },
  rowSlot: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  rowKcal: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  stats: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  statValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  warnBox: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warnText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  weekNote: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  skeleton: {
    height: 96,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
  },
}));
