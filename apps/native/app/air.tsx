import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { recentDayLabel, shortDateRange } from "@joyorogo/api/lib/format";
import { fmtNumber, getActiveLocale } from "@joyorogo/i18n";

import { BarChart, type BarChartDatum } from "@/components/bar-chart";
import { DayList, type DayListRow } from "@/components/day-list";
import { RangeNav } from "@/components/range-nav";
import { WaterCard } from "@/components/water-card";
import { BootLoader, Card, ErrorState, PageHeader, Screen, Skeleton, Text } from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import {
  RANGE_DAYS,
  canStepBack,
  canStepForward,
  chunk,
  daysOf,
  windowAt,
  type RangeKey,
} from "@/src/lib/range-window";
import { errorMessage, fmtDateShort } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

/** The water series is capped at 90 days a request, so a year is fetched in pieces. */
const SERIES_CHUNK_DAYS = 90;
/** How far back the arrows go: the series is always readable, but an empty past is not worth paging through. */
const HISTORY_DAYS = 730;

type Point = {
  key: string;
  from: string;
  to: string;
  /** glasses of the day; on the year's weekly bars, the average over the week's logged days */
  glasses: number;
  logged: boolean;
};

/** Air: today's glasses with − / +, then glasses per day over a week, month, quarter or year against the daily goal. */
export default function Air() {
  const { t } = useTranslation(["home", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = jakartaToday();
  // Beranda opens this for the day it is showing; without a date it is today.
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const [range, setRange] = useState<RangeKey>("w");
  const [offset, setOffset] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const spanDays = RANGE_DAYS[range];
  const win = windowAt(spanDays, offset, date);
  const weekly = range === "y";

  const series = useQuery({
    queryKey: [...orpc.water.series.key(), "window", win.from, win.to],
    queryFn: async () => {
      const parts = await Promise.all(
        chunk(daysOf(win), SERIES_CHUNK_DAYS).map((part) =>
          client.water.series({ from: part[0]!, to: part.at(-1)! }),
        ),
      );
      return { goal: parts[0]!.goal, days: parts.flatMap((part) => part.days) };
    },
    placeholderData: (previous) => previous,
  });

  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;

  const weekday = new Intl.DateTimeFormat(getActiveLocale(), { weekday: "short", timeZone: "UTC" });
  const days = series.data?.days ?? [];
  const goal = series.data?.goal ?? 8;
  const points: Point[] = weekly
    ? chunk(days, 7).map((week) => {
        const loggedDays = week.filter((day) => day.glasses > 0);
        const sum = loggedDays.reduce((total, day) => total + day.glasses, 0);
        return {
          key: week[0]!.date,
          from: week[0]!.date,
          to: week.at(-1)!.date,
          glasses: loggedDays.length > 0 ? Math.round((sum / loggedDays.length) * 10) / 10 : 0,
          logged: loggedDays.length > 0,
        };
      })
    : days.map((day) => ({
        key: day.date,
        from: day.date,
        to: day.date,
        glasses: day.glasses,
        logged: day.glasses > 0,
      }));
  const label = (point: Point, index: number): string => {
    // A week labels every bar, a month every 7th, a quarter and a year the first bar of each month.
    if (range === "w") return weekday.format(new Date(`${point.from}T00:00:00Z`));
    if (range === "m") return (points.length - 1 - index) % 7 === 0 ? fmtDateShort(point.from) : "";
    const previous = points[index - 1];
    return !previous || previous.from.slice(5, 7) !== point.from.slice(5, 7)
      ? fmtDateShort(point.from)
      : "";
  };
  const data: BarChartDatum[] = points.map((point, i) => ({
    key: point.key,
    value: point.glasses,
    label: label(point, i),
    readout: weekly
      ? t("water.trend.readoutWeek", {
          range: shortDateRange(point.from, point.to),
          avg: fmtNumber(point.glasses, 1),
          goal,
        })
      : t("water.trend.readout", { date: fmtDateShort(point.from), count: point.glasses, goal }),
  }));
  const loggedDays = days.filter((day) => day.glasses > 0);
  const hit = days.filter((day) => day.glasses >= goal).length;
  const avg =
    loggedDays.length > 0
      ? loggedDays.reduce((sum, day) => sum + day.glasses, 0) / loggedDays.length
      : 0;
  const rows: DayListRow[] = points
    .map((point) => ({
      key: point.key,
      title: weekly ? shortDateRange(point.from, point.to) : recentDayLabel(point.from, today),
      sub: weekly ? t("water.trend.weekRow") : undefined,
      value: weekly
        ? fmtNumber(point.glasses, 1)
        : t("water.trend.glasses", { count: point.glasses }),
      hit: point.glasses >= goal,
    }))
    .toReversed();
  const period = shortDateRange(win.from, win.to);
  const changeRange = (next: RangeKey) => {
    setRange(next);
    setOffset(0);
    setSelectedKey(null);
  };
  const step = (delta: number) => {
    setOffset((current) => current + delta);
    setSelectedKey(null);
  };

  return (
    <Screen>
      <PageHeader title={t("tile.water")} />
      <WaterCard date={date === today ? undefined : date} bare />

      <Card style={styles.trendCard}>
        <Text style={styles.trendTitle}>{t("water.trend.title")}</Text>
        <RangeNav
          compact
          options={[
            { value: "w", label: t("common:range.d7") },
            { value: "m", label: t("common:range.d30") },
            { value: "q", label: t("common:range.d90") },
            { value: "y", label: t("common:range.d365") },
          ]}
          value={range}
          onChange={changeRange}
          label={period}
          onPrev={
            canStepBack(spanDays, offset, date, shiftDate(today, -HISTORY_DAYS))
              ? () => step(1)
              : null
          }
          onNext={canStepForward(offset) ? () => step(-1) : null}
          onReset={canStepForward(offset) ? () => step(-offset) : null}
        />
        {series.isPending ? (
          <Skeleton width="100%" height={150} radius={18} />
        ) : series.isError ? (
          <ErrorState message={errorMessage(series.error)} onRetry={() => void series.refetch()} />
        ) : loggedDays.length === 0 ? (
          <Text style={styles.empty}>{t("water.trend.empty")}</Text>
        ) : (
          <View style={styles.chart}>
            <BarChart
              data={data}
              target={goal}
              color={theme.colors.tidur}
              softColor={`${theme.colors.tidur}73`}
              hint={t("water.trend.hint")}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              accessibilityLabel={
                points.length <= 14
                  ? t("water.trend.a11y", {
                      goal,
                      days: points
                        .map((point) =>
                          t("water.trend.a11yDay", {
                            date: fmtDateShort(point.from),
                            count: point.glasses,
                          }),
                        )
                        .join(". "),
                    })
                  : t("water.trend.a11yShort", { range: period, goal })
              }
            />
            <Text style={styles.summary}>
              {t("water.trend.summary", {
                avg: fmtNumber(avg, 1),
                hit,
                total: days.length,
              })}
            </Text>
            <DayList
              rows={rows}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              title={weekly ? t("common:range.listWeekly") : t("common:range.list")}
            />
          </View>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  trendCard: { gap: theme.spacing.md },
  trendTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  chart: { gap: theme.spacing.md },
  summary: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  empty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
}));
