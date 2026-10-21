import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { fmtNumber, getActiveLocale } from "@joyorogo/i18n";

import { BarChart, type BarChartDatum } from "@/components/bar-chart";
import { WaterCard } from "@/components/water-card";
import {
  BootLoader,
  Card,
  ErrorState,
  PageHeader,
  Screen,
  Segmented,
  Skeleton,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtDateShort } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type Range = "7" | "30";

/** Air: today's glasses with − / +, then glasses per day over the last 7 or 30 days against the daily goal. */
export default function Air() {
  const { t } = useTranslation("home");
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = jakartaToday();
  // Beranda opens this for the day it is showing; without a date it is today.
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const [range, setRange] = useState<Range>("7");
  const count = Number(range);
  const series = useQuery({
    ...orpc.water.series.queryOptions({
      input: { from: shiftDate(date, -(count - 1)), to: date },
    }),
    placeholderData: (previous) => previous,
  });

  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;

  const weekday = new Intl.DateTimeFormat(getActiveLocale(), { weekday: "short", timeZone: "UTC" });
  const days = series.data?.days ?? [];
  const goal = series.data?.goal ?? 8;
  const data: BarChartDatum[] = days.map((day, i) => ({
    key: day.date,
    value: day.glasses,
    // A week labels every bar; a month labels every 7th, counted back from the last day.
    label:
      count === 7
        ? weekday.format(new Date(`${day.date}T00:00:00Z`))
        : (days.length - 1 - i) % 7 === 0
          ? fmtDateShort(day.date)
          : "",
    readout: t("water.trend.readout", { date: fmtDateShort(day.date), count: day.glasses, goal }),
  }));
  const logged = days.filter((day) => day.glasses > 0);
  const hit = days.filter((day) => day.glasses >= goal).length;
  const avg = logged.length > 0 ? logged.reduce((sum, day) => sum + day.glasses, 0) / logged.length : 0;

  return (
    <Screen>
      <PageHeader title={t("tile.water")} />
      <WaterCard date={date === today ? undefined : date} bare />

      <Card style={styles.trendCard}>
        <Text style={styles.trendTitle}>{t("water.trend.title")}</Text>
        <Segmented
          compact
          options={[
            { value: "7", label: t("water.trend.range7") },
            { value: "30", label: t("water.trend.range30") },
          ]}
          value={range}
          onChange={setRange}
        />
        {series.isPending ? (
          <Skeleton width="100%" height={150} radius={18} />
        ) : series.isError ? (
          <ErrorState message={errorMessage(series.error)} onRetry={() => void series.refetch()} />
        ) : logged.length === 0 ? (
          <Text style={styles.empty}>{t("water.trend.empty")}</Text>
        ) : (
          <View style={styles.chart}>
            <BarChart
              data={data}
              target={goal}
              color={theme.colors.tidur}
              softColor={`${theme.colors.tidur}73`}
              hint={t("water.trend.hint")}
              accessibilityLabel={t("water.trend.a11y", {
                goal,
                days: days
                  .map((day) => t("water.trend.a11yDay", { date: fmtDateShort(day.date), count: day.glasses }))
                  .join(". "),
              })}
            />
            <Text style={styles.summary}>
              {t("water.trend.summary", {
                avg: fmtNumber(avg, 1),
                hit,
                total: days.length,
              })}
            </Text>
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
