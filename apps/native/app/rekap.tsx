import "@/unistyles";
import { useMaternal } from "@/components/maternal/use-maternal";
import { useQueries } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { recentDayLabel, shortDateRange, shortDayLabel } from "@joyorogo/api/lib/format";
import { instantIn } from "@joyorogo/i18n";
import type { WeekRecap } from "@joyorogo/api/lib/recap";
import {
  defaultRecapWeek,
  recapShare,
  weekdayName,
  weekdayShort,
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
import { BarChart, type BarChartDatum } from "@/components/bar-chart";
import { DayList, type DayListRow } from "@/components/day-list";
import { RangeNav } from "@/components/range-nav";
import { RecapReflection } from "@/components/recap-reflection";
import { Disclosure } from "@/components/disclosure";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { useSessionGate } from "@/lib/use-session-gate";
import {
  RECAP_WEEKS,
  combineRecaps,
  weekStartsOf,
  type PeriodRecap,
  type RecapRangeKey,
} from "@/src/lib/recap-range";
import { errorMessage, fmtDateShort, fmtInt, fmtKg, kcalUnit } from "@/utils/format";
import { MACRO_META } from "@/utils/macro-icons";
import { orpc } from "@/utils/orpc";

/** ±0.05 kg or flatter counts as steady, matching weeklyRateLabel. */
const FLAT_CHANGE_KG = 0.05;

/**
 * The period's days as bars against the target (the mean budget: each day was judged against its own). A tap on a bar
 * names the day and the list below follows the selection. One week labels the bars with weekdays, longer periods with
 * the first day of each week.
 */
function RecapDays({
  days,
  targetKcal,
  gain,
  weekly,
  today,
}: {
  days: WeekRecap["days"];
  targetKcal: number;
  gain: boolean;
  /** one week (weekday labels) or several (a date at the start of each week) */
  weekly: boolean;
  today: string;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["misc", "gain", "common"]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const statusText = (day: WeekRecap["days"][number]) =>
    gain && day.status === "under" ? t("gain:recap.dayUnder") : t(`misc:recap.chart.status.${day.status}`);
  const dayName = (date: string) => (weekly ? weekdayName(date) : shortDayLabel(date));
  const data: BarChartDatum[] = days.map((day, i) => ({
    key: day.date,
    value: day.eatenKcal,
    label: weekly ? weekdayShort(day.date) : i % 7 === 0 ? fmtDateShort(day.date) : "",
    readout: t("misc:recap.chart.day", { day: dayName(day.date), kcal: fmtInt(day.eatenKcal), status: statusText(day) }),
    // On target is the strong bar, over the energy colour, a short day a quiet grey and an empty or unjudged one flat.
    tone:
      day.status === "on_target" ? "strong" : day.status === "over" ? "soft" : day.status === "under" ? "faint" : "muted",
  }));
  const rows: DayListRow[] = days
    .map((day) => {
      const counted = day.status !== "empty" && day.status !== "pending";
      return {
        key: day.date,
        title: recentDayLabel(day.date, today),
        sub: counted
          ? t("misc:recap.list.sub", { status: t(`misc:recap.list.status.${day.status}`), kcal: fmtInt(day.targetKcal) })
          : t(`misc:recap.list.status.${day.status}`),
        value: counted ? `${fmtInt(day.eatenKcal)} ${kcalUnit()}` : "–",
        hit: counted ? day.status === "on_target" : null,
      };
    })
    .toReversed();
  return (
    <View style={styles.daysWrap}>
      <BarChart
        data={data}
        target={targetKcal}
        color={theme.colors.primary}
        softColor={theme.colors.bakar}
        hint={t("misc:recap.chart.hint")}
        height={120}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        accessibilityLabel={t("misc:recap.chart.aria", { target: fmtInt(targetKcal) })}
      />
      <View style={styles.legend}>
        <LegendDot color={theme.colors.primary} label={t("misc:recap.chart.legend.onTarget")} />
        {gain ? null : <LegendDot color={theme.colors.bakar} label={t("misc:recap.chart.legend.over")} />}
        <LegendDot
          color={theme.colors.mutedForeground}
          label={gain ? t("gain:recap.dayUnder") : t("misc:recap.chart.legend.under")}
          faded
        />
      </View>
      <DayList rows={rows} selectedKey={selectedKey} onSelect={setSelectedKey} title={t("common:range.list")} />
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

/** Several weeks read as one period: the average, the days on target, every day as a bar and as a row. */
function PeriodView({ period, today, maternal }: { period: PeriodRecap; today: string; maternal: boolean }) {
  const { t } = useTranslation(["misc", "gain", "common"]);
  if (period.avgKcal === null) {
    return (
      <EmptyState
        pose="determined"
        title={t("recap.empty.titleNoFood")}
        description={period.evaluatedDays === 0 ? t("recap.empty.bodyPast") : t("recap.empty.bodyLog")}
      />
    );
  }
  const change = period.weight?.changeKg ?? null;
  return (
    <>
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>{t("recap.avg.label")}</Text>
        <Num style={styles.heroValue}>
          {fmtInt(period.avgKcal)} <Text style={styles.heroUnit}>{kcalUnit()}</Text>
        </Num>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t("recap.avg.aria", { avg: fmtInt(period.avgKcal), target: fmtInt(period.targetKcal) })}
          accessibilityValue={{
            min: 0,
            max: Math.round(period.targetKcal),
            now: Math.round(Math.min(period.avgKcal, period.targetKcal)),
          }}
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${Math.min(100, (period.avgKcal / period.targetKcal) * 100)}%` }]} />
        </View>
        <Text style={styles.note}>
          {t("recap.avg.note", { count: period.loggedDays, target: fmtInt(period.targetKcal) })}
        </Text>
      </Card>
      <SectionTitle title={t("recap.daily")} />
      <Card>
        <RecapDays days={period.days} targetKcal={period.targetKcal} gain={period.gain} weekly={false} today={today} />
      </Card>
      <View style={styles.tileRow}>
        {maternal ? null : (
          <StatTile
            icon="checkmark-circle"
            tint="makan"
            label={t("recap.stat.onTarget.label")}
            value={`${period.daysOnTarget} ${t("recap.unit.day", { count: period.daysOnTarget })}`}
            sub={t("recap.stat.onTarget.sub", { count: period.loggedDays })}
          />
        )}
        <StatTile
          icon="barbell"
          tint="bakar"
          label={t("common:nav.exercise")}
          value={`${fmtInt(period.exercise.kcal)} ${kcalUnit()}`}
          sub={
            period.exercise.sessions > 0
              ? t("recap.stat.exercise.sub", {
                  count: period.exercise.sessions,
                  minutes: fmtInt(period.exercise.minutes),
                })
              : t("recap.stat.exercise.none")
          }
        />
      </View>
      {maternal ? null : (
        <View style={styles.tileRow}>
          <StatTile
            icon="scale"
            tint="tidur"
            label={t("recap.stat.weight.label")}
            value={change === null ? "–" : `${change > 0 ? "+" : ""}${fmtKg(change)} kg`}
            sub={
              period.weight === null
                ? t("recap.stat.weight.none")
                : t("recap.stat.weight.range", { from: fmtKg(period.weight.startKg), to: fmtKg(period.weight.endKg) })
            }
          />
        </View>
      )}
      <Disclosure title={t("recap.note.title")}>
        <Text style={styles.footnote}>{period.gain ? t("gain:nativeToday.recap.note") : t("recap.note.body")}</Text>
      </Disclosure>
    </>
  );
}

export default function Rekap() {
  const { t } = useTranslation(["misc", "common", "gain"]);
  const gate = useSessionGate();
  const params = useLocalSearchParams<{ week?: string }>();
  const today = jakartaToday();
  const thisWeek = weekStartOf(today);
  const requested =
    typeof params.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.week)
      ? weekStartOf(params.week)
      : null;
  const defaultWeek = defaultRecapWeek(today);
  const [range, setRange] = useState<RecapRangeKey>("w1");
  // The Monday of the last week on screen; a longer range reaches back from it.
  const [endWeek, setEndWeek] = useState(requested && requested <= thisWeek ? requested : defaultWeek);
  const weeks = RECAP_WEEKS[range];
  const single = weeks === 1;
  const weekStarts = useMemo(() => weekStartsOf(endWeek, weeks, shiftDate), [endWeek, weeks]);
  // One request per week (a week is how the server judges a day), so a longer range is that many cached queries.
  const results = useQueries({
    queries: weekStarts.map((weekStart) => ({
      ...orpc.stats.weekRecap.queryOptions({ input: { weekStart } }),
      // Moving one week keeps the old one in view while it loads; a longer range never borrows another week's figures.
      placeholderData: single ? (prev: WeekRecap | null | undefined) => prev : undefined,
    })),
  });

  const maternal = useMaternal().mode !== "none";

  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;
  const failed = results.find((result) => result.isError);
  if (results.some((result) => result.isPending)) {
    return (
      <Screen>
        <PageHeader title={t("recap.title")} />
        <Skeleton width="100%" height={170} radius={24} />
        <Skeleton width="100%" height={220} radius={24} />
      </Screen>
    );
  }
  if (failed) {
    return (
      <Screen>
        <PageHeader title={t("recap.title")} />
        <ErrorState
          message={errorMessage(failed.error)}
          onRetry={() => results.forEach((result) => void result.refetch())}
        />
      </Screen>
    );
  }
  const loaded = results.map((result) => result.data);
  if (loaded.some((recap) => recap === null || recap === undefined)) return <Redirect href="/onboarding" />;
  const recaps = loaded as WeekRecap[];
  const recap = recaps[recaps.length - 1]!;
  const period = combineRecaps(recaps);

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
  const canNext = endWeek < thisWeek;
  const rangeText = shortDateRange(recaps[0]!.weekStart, recap.weekEnd);
  const resetWeek = single ? defaultWeek : thisWeek;
  const nextWeek = shiftDate(endWeek, 7 * weeks);

  const nav = (
    <RangeNav
      options={[
        { value: "w1", label: t("recap.range.w1") },
        { value: "w4", label: t("recap.range.w4") },
        { value: "w13", label: t("recap.range.w13") },
      ]}
      value={range}
      onChange={setRange}
      label={rangeText}
      onPrev={() => setEndWeek(shiftDate(endWeek, -7 * weeks))}
      onNext={canNext ? () => setEndWeek(nextWeek > thisWeek ? thisWeek : nextWeek) : null}
      onReset={endWeek !== resetWeek ? () => setEndWeek(resetWeek) : null}
    />
  );

  return (
    <Screen>
        <PageHeader title={t("recap.title")} caption={recap.complete ? undefined : t("recap.ongoing")} />
        {nav}

        {!single ? (
          <PeriodView period={period} today={today} maternal={maternal} />
        ) : recap.avgKcal === null ? (
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
              <RecapDays days={recap.days} targetKcal={recap.targetKcal} gain={recap.gain} weekly today={today} />
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
  daysWrap: { gap: theme.spacing.md },
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
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing.md,
    rowGap: 4,
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
