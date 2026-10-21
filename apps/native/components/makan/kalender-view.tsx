import { Ionicons } from "@expo/vector-icons";
import { useGain } from "@/components/gain/use-gain";
import { useMaternal } from "@/components/maternal/use-maternal";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  dayKcalFill,
  dayTargetStatus,
  monthSummary,
  monthWeeks,
  shiftMonth,
} from "@joyorogo/api/lib/diary-view";
import type { DayMode, DayStatus } from "@joyorogo/api/lib/diary-view";
import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { fmtDate } from "@joyorogo/i18n";
import { MacroLine } from "@/components/macro-line";
import { Button, Card, Num, Ring, Text } from "@/components/ui";
import { fmtInt, fmtKcalLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** What the selected day panel shows: the day's intake against the target. */
export type KalenderDay = {
  eatenKcal: number;
  targetKcal: number | null;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** Rows logged that day (after the kind chip). */
  count: number;
};

/**
 * Kalender view: the nutrition calendar. Month header with the month's stats
 * (days logged, days within / over / under the target, average intake) and a
 * legend, a grid whose cells carry the day's kcal ring in the colour of its
 * status, and a panel for the selected day with a way into the Daftar.
 */
export function KalenderView({
  date,
  kind,
  day,
  onSelect,
  onOpenDaftar,
}: {
  date: string;
  kind: FoodKindFilter;
  day: KalenderDay;
  onSelect: (date: string) => void;
  onOpenDaftar: () => void;
}) {
  const { t } = useTranslation(["makan", "gain"]);
  const { theme } = useUnistyles();
  const today = jakartaToday();
  const [month, setMonth] = useState(date.slice(0, 7));
  const totals = useQuery({
    ...orpc.diary.monthTotals.queryOptions({ input: { month, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const targetKcal = totals.data?.targetKcal ?? null;
  const maternal = useMaternal().mode !== "none";
  // Naikin BB: the target is a floor, so a day under it is the one to flag.
  const gainPlan = useGain().gain !== null;
  const mode: DayMode = maternal ? "neutral" : gainPlan ? "gain" : "lose";
  const days = totals.data?.days ?? [];
  const summary = monthSummary(days, targetKcal, mode);
  const judging = mode !== "neutral" && targetKcal !== null && targetKcal > 0;
  const canNext = month < today.slice(0, 7);
  const statusColor: Record<DayStatus, string> = {
    within: theme.colors.makan,
    over: theme.colors.bakar,
    under: theme.colors.eatNear,
  };
  const flagged: DayStatus = mode === "gain" ? "under" : "over";

  const stats = [
    t("calendar.stats.logged", { count: summary.logged, n: fmtInt(summary.logged) }),
    ...(judging
      ? [
          t("calendar.stats.within", { count: summary.within, n: fmtInt(summary.within) }),
          mode === "gain"
            ? t("calendar.stats.under", { count: summary.under, n: fmtInt(summary.under) })
            : t("calendar.stats.over", { count: summary.over, n: fmtInt(summary.over) }),
        ]
      : []),
    ...(summary.avgKcal !== null
      ? [t("calendar.stats.average", { kcal: fmtKcalLabel(summary.avgKcal) })]
      : []),
  ];
  const legend = [
    ...(judging
      ? [
          { key: "within", color: statusColor.within, label: t("calendar.legend.within") },
          { key: flagged, color: statusColor[flagged], label: t(`calendar.legend.${flagged}`) },
        ]
      : [{ key: "logged", color: theme.colors.makan, label: t("calendar.legend.logged") }]),
    { key: "none", color: theme.colors.hairline, label: t("calendar.legend.none") },
  ];

  const dayStatus = dayTargetStatus(day.eatenKcal, day.targetKcal, mode);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.month}>{fmtDate(`${month}-01`, "month")}</Text>
          <Text style={styles.counts}>{stats.join(" · ")}</Text>
          {judging ? (
            <Text style={styles.counts}>
              {gainPlan
                ? t("gain:nativeToday.calendarTarget", { kcal: fmtKcalLabel(targetKcal) })
                : t("calendar.budget", { kcal: fmtKcalLabel(targetKcal) })}
            </Text>
          ) : null}
        </View>
        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("calendar.prevMonth")}
            onPress={() => setMonth(shiftMonth(month, -1))}
            style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("calendar.nextMonth")}
            disabled={!canNext}
            onPress={() => setMonth(shiftMonth(month, 1))}
            style={({ pressed }) => [
              styles.navButton,
              pressed && styles.pressed,
              !canNext && styles.dim,
            ]}
          >
            <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
          </Pressable>
        </View>
      </View>

      <Card style={styles.card}>
        <View style={styles.week}>
          {WEEKDAY_KEYS.map((key) => (
            <View key={key} style={styles.cellBox}>
              <Text style={styles.weekday}>{t(`calendar.weekday.${key}`)}</Text>
            </View>
          ))}
        </View>
        {monthWeeks(month).map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} style={styles.week}>
            {week.map((cell, index) => {
              if (cell === null) return <View key={`empty-${index}`} style={styles.cellBox} />;
              const total = days.find((entry) => entry.date === cell.key);
              const future = cell.key > today;
              const selected = cell.key === date;
              const status = total ? dayTargetStatus(total.kcal, targetKcal, mode) : null;
              const label = total
                ? t("calendar.dayWithEntries", {
                    count: total.count,
                    date: fmtDate(cell.key, "weekday"),
                    kcal: fmtKcalLabel(total.kcal),
                  })
                : t("calendar.dayEmpty", { date: fmtDate(cell.key, "weekday") });
              return (
                <View key={cell.key} style={styles.cellBox}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={status ? `${label}, ${t(`calendar.status.${status}`)}` : label}
                    accessibilityState={{ selected, disabled: future }}
                    disabled={future}
                    onPress={() => onSelect(cell.key)}
                    style={({ pressed }) => [
                      styles.cell,
                      selected && styles.cellSelected,
                      future && styles.dim,
                      pressed && styles.pressed,
                    ]}
                  >
                    {total ? (
                      <Ring
                        size={36}
                        stroke={3}
                        value={dayKcalFill(total.kcal, targetKcal)}
                        max={1}
                        color={status === null ? theme.colors.makan : statusColor[status]}
                        track={theme.colors.muted}
                      />
                    ) : null}
                    <View style={styles.dayNumber} pointerEvents="none">
                      <Num
                        style={[
                          styles.day,
                          !total && styles.dayEmpty,
                          cell.key === today && { color: theme.colors.primary },
                        ]}
                      >
                        {cell.day}
                      </Num>
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
        <View style={styles.legend}>
          {legend.map((entry) => (
            <View key={entry.key} style={styles.legendItem}>
              <View style={[styles.swatch, { borderColor: entry.color }]} />
              <Text style={styles.legendText}>{entry.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card style={styles.dayCard}>
        <Text style={styles.dayTitle}>{relativeDayLabel(date, today)}</Text>
        {day.count === 0 && day.eatenKcal <= 0 ? (
          <Text style={styles.counts}>{t("calendar.day.empty")}</Text>
        ) : (
          <>
            <Text
              style={[
                styles.dayKcal,
                dayStatus === flagged && judging && { color: theme.colors.bakarText },
              ]}
            >
              {day.targetKcal !== null && day.targetKcal > 0
                ? t("calendar.day.ofTarget", {
                    eaten: fmtInt(day.eatenKcal),
                    target: fmtInt(day.targetKcal),
                  })
                : fmtKcalLabel(day.eatenKcal)}
            </Text>
            <MacroLine
              compact
              protein={day.protein}
              carbs={day.carbs}
              fat={day.fat}
              fiber={day.fiber}
            />
          </>
        )}
        <Button label={t("calendar.day.open")} onPress={onOpenDaftar} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  month: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  counts: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  nav: {
    flexDirection: "row",
    gap: 4,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    padding: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  week: {
    flexDirection: "row",
  },
  cellBox: {
    flex: 1,
    padding: 1.5,
  },
  weekday: {
    textAlign: "center",
    paddingVertical: 4,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  cell: {
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cellSelected: {
    backgroundColor: theme.colors.makanSoft,
  },
  dayNumber: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  day: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  dayEmpty: {
    fontWeight: "500",
    color: theme.colors.mutedForeground,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing.md,
    rowGap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  dayCard: {
    gap: theme.spacing.sm,
  },
  dayTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  dayKcal: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.kcalText,
    fontVariant: ["tabular-nums"],
  },
  dim: {
    opacity: 0.3,
  },
  pressed: {
    opacity: 0.6,
  },
}));
