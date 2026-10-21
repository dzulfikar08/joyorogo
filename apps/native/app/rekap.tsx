import "@/unistyles";
import { useMaternal } from "@/components/maternal/use-maternal";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { instantIn } from "@joyorogo/i18n";
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
import { RecapReflection } from "@/components/recap-reflection";
import { Disclosure } from "@/components/disclosure";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtInt, fmtKg, kcalUnit } from "@/utils/format";
import { MACRO_META } from "@/utils/macro-icons";
import { orpc } from "@/utils/orpc";

const BAR_AREA_H = 120;
/** ±0.05 kg or flatter counts as steady, matching weeklyRateLabel. */
const FLAT_CHANGE_KG = 0.05;

function RecapChart({ recap }: { recap: WeekRecap }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["misc", "gain"]);
  const top = Math.max(recap.targetKcal * 1.25, ...recap.days.map((day) => day.eatenKcal));
  const tone: Record<DayStatus, string> = {
    on_target: theme.colors.primary,
    over: theme.colors.bakar,
    under: theme.colors.mutedForeground,
    empty: theme.colors.muted,
    pending: theme.colors.muted,
  };
  const label = (day: WeekRecap["days"][number]) =>
    t("recap.chart.day", {
      day: weekdayName(day.date),
      kcal: fmtInt(day.eatenKcal),
      status:
        recap.gain && day.status === "under"
          ? t("gain:recap.dayUnder")
          : t(`recap.chart.status.${day.status}`),
    });
  return (
    <View>
      <View
        accessible
        accessibilityLabel={`${t("recap.chart.aria", { target: fmtInt(recap.targetKcal) })}. ${recap.days.map(label).join(". ")}`}
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
        <LegendDot color={theme.colors.primary} label={t("recap.chart.legend.onTarget")} />
        {recap.gain ? null : (
          <LegendDot color={theme.colors.bakar} label={t("recap.chart.legend.over")} />
        )}
        <LegendDot
          color={theme.colors.mutedForeground}
          label={recap.gain ? t("gain:recap.dayUnder") : t("recap.chart.legend.under")}
          faded
        />
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
  const { t } = useTranslation(["misc", "common", "gain"]);
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

  const maternal = useMaternal().mode !== "none";

  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;
  if (query.isPending) {
    return (
      <Screen>
        <PageHeader title={t("recap.title")} />
        <Skeleton width="100%" height={170} radius={24} />
        <Skeleton width="100%" height={220} radius={24} />
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen>
        <PageHeader title={t("recap.title")} />
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const recap = query.data;
  if (recap === null) return <Redirect href="/onboarding" />;

  const share = recapShare(recap);
  const change = recap.weight?.changeKg ?? null;
  const gainWeightLine =
    change === null
      ? null
      : change > FLAT_CHANGE_KG
        ? t("gain:recap.weightUp", { kg: fmtKg(change) })
        : change < -FLAT_CHANGE_KG
          ? t("gain:recap.weightDown", { kg: fmtKg(Math.abs(change)) })
          : t("gain:recap.weightSteady");
  const gainCelebrate =
    recap.daysOnTarget >= 5 ? "great" : recap.daysOnTarget >= 3 ? "some" : "low";
  const canNext = recap.weekStart < thisWeek;

  const nav = (
    <View style={styles.nav}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("recap.prevWeek")}
        hitSlop={8}
        onPress={() => setWeekStart(shiftDate(recap.weekStart, -7))}
        style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("recap.nextWeek")}
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
    <Screen>
        <PageHeader
          title={t("recap.title")}
          caption={
            recap.complete
              ? weekRangeLabel(recap.weekStart)
              : t("recap.subtitleOngoing", { range: weekRangeLabel(recap.weekStart) })
          }
          right={nav}
        />

        {recap.avgKcal === null ? (
          <EmptyState
            pose="determined"
            title={recap.empty ? t("recap.empty.titleNone") : t("recap.empty.titleNoFood")}
            description={
              recap.evaluatedDays === 0 ? t("recap.empty.bodyPast") : t("recap.empty.bodyLog")
            }
          />
        ) : (
          <>
            <Card style={styles.heroCard}>
              <Text style={styles.heroLabel}>{t("recap.avg.label")}</Text>
              <Num style={styles.heroValue}>
                {fmtInt(recap.avgKcal)} <Text style={styles.heroUnit}>{kcalUnit()}</Text>
              </Num>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={t("recap.avg.aria", {
                  avg: fmtInt(recap.avgKcal),
                  target: fmtInt(recap.targetKcal),
                })}
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
                {t("recap.avg.note", { count: recap.loggedDays, target: fmtInt(recap.targetKcal) })}
              </Text>
            </Card>

            {recap.gain ? (
              <Card style={styles.gainSummary}>
                <Text style={styles.gainLine}>
                  {t("gain:recap.daysOnTarget", {
                    on: recap.daysOnTarget,
                    total: recap.loggedDays,
                  })}
                </Text>
                {gainWeightLine ? <Text style={styles.note}>{gainWeightLine}</Text> : null}
                <Text style={styles.note}>{t(`gain:recap.celebrate.${gainCelebrate}`)}</Text>
              </Card>
            ) : null}
            <SectionTitle title={t("recap.daily")} />
            <Card>
              <RecapChart recap={recap} />
            </Card>

            <View style={styles.tileRow}>
              {maternal ? null : (
                <StatTile
                  icon="checkmark-circle"
                  tint="makan"
                  label={t("recap.stat.onTarget.label")}
                  value={`${recap.daysOnTarget} ${t("recap.unit.day", { count: recap.daysOnTarget })}`}
                  sub={t("recap.stat.onTarget.sub", { count: recap.loggedDays })}
                />
              )}
              <StatTile
                macro="protein"
                tint="makan"
                label={MACRO_META.protein.label}
                value={recap.protein ? `${fmtInt(recap.protein.avgG)} g` : "–"}
                sub={
                  recap.protein
                    ? t("recap.stat.protein.sub", { target: fmtInt(recap.protein.targetG) })
                    : t("recap.stat.protein.none")
                }
              />
            </View>
            <View style={styles.tileRow}>
              {maternal ? null : (
                <StatTile
                  icon="flame"
                  tint="bakar"
                  label={t("recap.stat.streak.label")}
                  value={`${recap.streakDays} ${t("recap.unit.day", { count: recap.streakDays })}`}
                  sub={recap.gain ? t("gain:nativeToday.recap.streakSub") : t("recap.stat.streak.sub")}
                />
              )}
              <StatTile
                icon="barbell"
                tint="bakar"
                label={t("common:nav.exercise")}
                value={`${fmtInt(recap.exercise.kcal)} ${kcalUnit()}`}
                sub={
                  recap.exercise.sessions > 0
                    ? t("recap.stat.exercise.sub", {
                        count: recap.exercise.sessions,
                        minutes: fmtInt(recap.exercise.minutes),
                      })
                    : t("recap.stat.exercise.none")
                }
              />
            </View>
            <View style={styles.tileRow}>
              {maternal ? null : (
              <StatTile
                icon="scale"
                tint="tidur"
                label={t("recap.stat.weight.label")}
                value={change === null ? "–" : `${change > 0 ? "+" : ""}${fmtKg(change)} kg`}
                sub={
                  change === null
                    ? t("recap.stat.weight.none")
                    : t("recap.stat.weight.range", {
                        from: fmtKg(recap.weight!.startKg),
                        to: fmtKg(recap.weight!.endKg),
                      })
                }
              />
              )}
              <StatTile
                icon="trophy"
                tint="tidur"
                label={t("recap.stat.bestDay.label")}
                value={recap.bestDay ? weekdayName(recap.bestDay.date) : "–"}
                sub={
                  recap.bestDay
                    ? t("recap.stat.bestDay.sub", { kcal: fmtInt(recap.bestDay.eatenKcal) })
                    : t("recap.stat.bestDay.none")
                }
              />
            </View>

            <RecapReflection key={recap.weekStart} weekStart={recap.weekStart} />

            {share && !maternal ? (
              <ShareStoryButton
                variant="secondary"
                label={t("recap.share")}
                story={{
                  kind: "recap",
                  ...share,
                  date: new Date(instantIn(recap.weekEnd, 12, 0)),
                }}
              />
            ) : null}

            <Disclosure title={t("recap.note.title")}>
              <Text style={styles.footnote}>
                {recap.gain ? t("gain:nativeToday.recap.note") : t("recap.note.body")}
                {recap.complete ? "" : ` ${t("recap.note.ongoing")}`}
              </Text>
            </Disclosure>
          </>
        )}
    </Screen>
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
  heroValue: { fontSize: 40, fontWeight: "800", color: theme.colors.foreground },
  heroUnit: { fontSize: theme.fontSize.lg, fontWeight: "600", color: theme.colors.mutedForeground },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  fill: { height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, lineHeight: 20 },
  gainSummary: { gap: theme.spacing.sm },
  gainLine: { fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
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
  },
}));
