import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import type { DayStatus, WeekRecap } from "@joyorogo/api/lib/recap";
import {
  defaultRecapWeek,
  recapShare,
  weekdayName,
  weekdayShort,
  weekRangeLabel,
  weekStartOf,
} from "@joyorogo/api/lib/recap";

import {
  BootLoader,
  Card,
  EmptyState,
  ErrorState,
  Num,
  PageHeader,
  Screen,
  SectionTitle,
  Skeleton,
  StatTile,
  Text,
} from "@/components/ui";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtInt, fmtKg } from "@/utils/format";
import { orpc } from "@/utils/orpc";

const BAR_AREA_H = 120;

const STATUS_LABEL: Record<DayStatus, string> = {
  on_target: "sesuai target",
  over: "di atas target",
  under: "jauh di bawah target, mungkin belum lengkap dicatat",
  empty: "tidak ada catatan makan",
  pending: "belum dinilai",
};

function RecapChart({ recap }: { recap: WeekRecap }) {
  const { theme } = useUnistyles();
  const top = Math.max(recap.targetKcal * 1.25, ...recap.days.map((day) => day.eatenKcal));
  const tone: Record<DayStatus, string> = {
    on_target: theme.colors.primary,
    over: theme.colors.bakar,
    under: theme.colors.mutedForeground,
    empty: theme.colors.muted,
    pending: theme.colors.muted,
  };
  const label = (day: WeekRecap["days"][number]) =>
    `${weekdayName(day.date)}: ${fmtInt(day.eatenKcal)} kcal, ${STATUS_LABEL[day.status]}`;
  return (
    <View>
      <View
        accessible
        accessibilityLabel={`Asupan harian dibanding target ${fmtInt(recap.targetKcal)} kcal. ${recap.days.map(label).join(". ")}`}
        style={styles.barArea}
      >
        <View
          style={[
            styles.targetLine,
            { bottom: (recap.targetKcal / top) * BAR_AREA_H, borderColor: theme.colors.hairline },
          ]}
        />
        {recap.days.map((day) => (
          <View key={day.date} style={styles.barCol}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(4, (day.eatenKcal / top) * BAR_AREA_H),
                  backgroundColor: tone[day.status],
                  opacity: day.status === "under" ? 0.45 : 1,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.barLabels} importantForAccessibility="no-hide-descendants">
        {recap.days.map((day) => (
          <Text key={day.date} style={styles.barLabel}>
            {weekdayShort(day.date)}
          </Text>
        ))}
      </View>
      <View style={styles.legend}>
        <LegendDot color={theme.colors.primary} label="Sesuai target" />
        <LegendDot color={theme.colors.bakar} label="Di atas" />
        <LegendDot color={theme.colors.mutedForeground} label="Kurang dari separuh target" faded />
      </View>
    </View>
  );
}

function LegendDot({ color, label, faded }: { color: string; label: string; faded?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color, opacity: faded ? 0.45 : 1 }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

export default function Rekap() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const params = useLocalSearchParams<{ week?: string }>();
  const today = jakartaToday();
  const thisWeek = weekStartOf(today);
  const requested =
    typeof params.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.week)
      ? weekStartOf(params.week)
      : null;
  const [weekStart, setWeekStart] = useState(
    requested && requested <= thisWeek ? requested : defaultRecapWeek(today),
  );
  const query = useQuery({
    ...orpc.stats.weekRecap.queryOptions({ input: { weekStart } }),
    placeholderData: (prev) => prev,
  });

  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;
  if (query.isPending) {
    return (
      <Screen>
        <PageHeader title="Rekap mingguan" />
        <Skeleton width="100%" height={170} radius={24} />
        <Skeleton width="100%" height={220} radius={24} />
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen>
        <PageHeader title="Rekap mingguan" />
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const recap = query.data;
  if (recap === null) return <Redirect href="/onboarding" />;

  const share = recapShare(recap);
  const change = recap.weight?.changeKg ?? null;
  const canNext = recap.weekStart < thisWeek;

  const nav = (
    <View style={styles.nav}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Minggu sebelumnya"
        hitSlop={8}
        onPress={() => setWeekStart(shiftDate(recap.weekStart, -7))}
        style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Minggu berikutnya"
        accessibilityState={{ disabled: !canNext }}
        disabled={!canNext}
        hitSlop={8}
        onPress={() => setWeekStart(shiftDate(recap.weekStart, 7))}
        style={({ pressed }) => [styles.navBtn, !canNext && styles.disabled, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
      </Pressable>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: "Rekap mingguan" }} />
      <Screen>
        <PageHeader
          title="Rekap mingguan"
          caption={
            recap.complete
              ? weekRangeLabel(recap.weekStart)
              : `${weekRangeLabel(recap.weekStart)} · masih berjalan`
          }
          right={nav}
        />

        {recap.avgKcal === null ? (
          <EmptyState
            pose="determined"
            title={recap.empty ? "Belum ada catatan di minggu ini" : "Belum ada makanan yang dicatat"}
            description={
              recap.evaluatedDays === 0
                ? "Rekap dihitung dari hari yang sudah lewat. Cek lagi besok."
                : "Catat makananmu beberapa hari, nanti rekapnya muncul di sini."
            }
          />
        ) : (
          <>
            <Card style={styles.heroCard}>
              <Text style={styles.heroLabel}>Rata-rata per hari</Text>
              <Num style={styles.heroValue}>
                {fmtInt(recap.avgKcal)} <Text style={styles.heroUnit}>kcal</Text>
              </Num>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={`Rata-rata ${fmtInt(recap.avgKcal)} dari target ${fmtInt(recap.targetKcal)} kcal`}
                accessibilityValue={{
                  min: 0,
                  max: Math.round(recap.targetKcal),
                  now: Math.round(Math.min(recap.avgKcal, recap.targetKcal)),
                }}
                style={styles.track}
              >
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.min(100, (recap.avgKcal / recap.targetKcal) * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.note}>
                Targetmu {fmtInt(recap.targetKcal)} kcal. Dihitung dari {recap.loggedDays} hari yang
                kamu catat.
              </Text>
            </Card>

            <SectionTitle title="Harian" />
            <Card>
              <RecapChart recap={recap} />
            </Card>

            <View style={styles.tileRow}>
              <StatTile
                icon="checkmark-circle"
                tint="makan"
                label="Sesuai target"
                value={`${recap.daysOnTarget} hari`}
                sub={`dari ${recap.loggedDays} hari tercatat`}
              />
              <StatTile
                macro="protein"
                tint="makan"
                label="Protein"
                value={recap.protein ? `${fmtInt(recap.protein.avgG)} g` : "–"}
                sub={
                  recap.protein
                    ? `rata-rata, target ${fmtInt(recap.protein.targetG)} g`
                    : "belum ada data protein"
                }
              />
            </View>
            <View style={styles.tileRow}>
              <StatTile
                icon="flame"
                tint="bakar"
                label="Beruntun"
                value={`${recap.streakDays} hari`}
                sub="mencatat tanpa putus"
              />
              <StatTile
                icon="barbell"
                tint="bakar"
                label="Olahraga"
                value={`${fmtInt(recap.exercise.kcal)} kcal`}
                sub={
                  recap.exercise.sessions > 0
                    ? `${fmtInt(recap.exercise.minutes)} menit, ${recap.exercise.sessions} sesi`
                    : "belum ada sesi"
                }
              />
            </View>
            <View style={styles.tileRow}>
              <StatTile
                icon="scale"
                tint="tidur"
                label="Berat (tren)"
                value={change === null ? "–" : `${change > 0 ? "+" : ""}${fmtKg(change)} kg`}
                sub={
                  change === null
                    ? "perlu 2 kali timbang"
                    : `${fmtKg(recap.weight!.startKg)} ke ${fmtKg(recap.weight!.endKg)} kg`
                }
              />
              <StatTile
                icon="trophy"
                tint="tidur"
                label="Hari terbaik"
                value={recap.bestDay ? weekdayName(recap.bestDay.date) : "–"}
                sub={
                  recap.bestDay
                    ? `${fmtInt(recap.bestDay.eatenKcal)} kcal, paling dekat target`
                    : "belum ada hari sesuai target"
                }
              />
            </View>

            {share ? (
              <ShareStoryButton
                variant="secondary"
                label="Bagikan rekap ke Story"
                story={{
                  kind: "recap",
                  ...share,
                  date: new Date(`${recap.weekEnd}T12:00:00+07:00`),
                }}
              />
            ) : null}

            <Text style={styles.footnote}>
              Hitungan dari catatanmu sendiri, bukan penilaian medis. Sesuai target berarti asupan
              sehari tidak lebih dari 5% di atas targetmu dan tidak kurang dari separuhnya. Berat
              memakai tren (rata-rata bergerak), jadi tidak ikut naik turun timbangan harian.
              {recap.complete ? "" : " Minggu ini dihitung sampai kemarin; hari ini belum ikut dinilai."}
            </Text>
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  nav: { flexDirection: "row", gap: theme.spacing.sm },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  heroCard: { gap: theme.spacing.sm },
  heroLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  heroValue: { fontSize: 48, fontWeight: "800", color: theme.colors.foreground },
  heroUnit: { fontSize: theme.fontSize.lg, fontWeight: "600", color: theme.colors.mutedForeground },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  fill: { height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, lineHeight: 20 },
  barArea: {
    height: BAR_AREA_H,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
  },
  targetLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
  barCol: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  barLabels: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  barLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing.md,
    rowGap: 4,
    marginTop: theme.spacing.md,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  tileRow: { flexDirection: "row", gap: theme.spacing.md },
  footnote: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 18,
    paddingHorizontal: theme.spacing.xs,
  },
}));
