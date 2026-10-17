import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { dayKcalFill, monthWeeks, shiftMonth } from "@joyorogo/api/lib/diary-view";
import { eatTone, jakartaToday } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { fmtDate } from "@joyorogo/i18n";

import { StickerMini } from "@/components/sticker";
import { Card, Ring, Text } from "@/components/ui";
import { fmtInt, fmtKcalLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Kalender view: month header with totals, a grid whose cells carry the day's
 * cutout sticker (a kcal-vs-budget ring when it has none, +N for more items),
 * a footer count, and `children` (the selected day's section) below the card.
 */
export function KalenderView({
  date,
  kind,
  onSelect,
  children,
}: {
  date: string;
  kind: FoodKindFilter;
  onSelect: (date: string) => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const today = jakartaToday();
  const [month, setMonth] = useState(date.slice(0, 7));
  const totals = useQuery({
    ...orpc.diary.monthTotals.queryOptions({ input: { month, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const targetKcal = totals.data?.targetKcal ?? null;
  const days = totals.data?.days ?? [];
  const records = days.reduce((sum, day) => sum + day.count, 0);
  const canNext = month < today.slice(0, 7);
  const toneColor = {
    ok: theme.colors.makan,
    near: theme.colors.eatNear,
    over: theme.colors.destructive,
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.month}>{fmtDate(`${month}-01`, "month")}</Text>
          <Text style={styles.counts}>
            {t("monthScrubber.records", { count: records, n: fmtInt(records) })} ·{" "}
            {t("monthScrubber.daysLogged", { count: days.length, n: fmtInt(days.length) })}
          </Text>
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
              const total = days.find((day) => day.date === cell.key);
              const future = cell.key > today;
              const selected = cell.key === date;
              const tone = total ? eatTone(total.kcal, targetKcal ?? 0) : "ok";
              return (
                <View key={cell.key} style={styles.cellBox}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      total
                        ? t("calendar.dayWithEntries", {
                            count: total.count,
                            date: fmtDate(cell.key, "weekday"),
                            kcal: fmtKcalLabel(total.kcal),
                          })
                        : t("calendar.dayEmpty", { date: fmtDate(cell.key, "weekday") })
                    }
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
                    {total?.scanId ? (
                      <View style={styles.sticker} pointerEvents="none">
                        <StickerMini scanId={total.scanId} size={30} />
                      </View>
                    ) : total ? (
                      <View style={styles.ring} pointerEvents="none">
                        <Ring
                          size={30}
                          stroke={3}
                          value={dayKcalFill(total.kcal, targetKcal)}
                          max={1}
                          color={toneColor[tone]}
                          track={theme.colors.muted}
                        />
                      </View>
                    ) : null}
                    <Text
                      style={[
                        total?.scanId ? styles.dayCorner : styles.dayCenter,
                        !total && styles.dayEmpty,
                        cell.key === today && { color: theme.colors.primary },
                      ]}
                    >
                      {cell.day}
                    </Text>
                    {total?.scanId ? (
                      <View style={[styles.toneDot, { backgroundColor: toneColor[tone] }]} />
                    ) : null}
                    {total && total.count > 1 ? (
                      <View style={styles.more}>
                        <Text style={styles.moreText}>+{total.count - 1}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
        <View style={styles.footer}>
          <Ionicons name="calendar-outline" size={16} color={theme.colors.mutedForeground} />
          <Text style={styles.footerText}>
            {t("calendar.daysLoggedMonth", { count: days.length, n: fmtInt(days.length) })}
          </Text>
          {targetKcal !== null ? (
            <Text style={styles.budget}>
              {t("calendar.budget", { kcal: fmtKcalLabel(targetKcal) })}
            </Text>
          ) : null}
        </View>
      </Card>

      {children}
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
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
  },
  sticker: {
    position: "absolute",
    right: 2,
    bottom: 1,
  },
  ring: {
    position: "absolute",
  },
  dayCorner: {
    position: "absolute",
    top: 2,
    left: 5,
    fontSize: 11,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  dayCenter: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  dayEmpty: {
    fontWeight: "500",
    color: theme.colors.mutedForeground,
  },
  toneDot: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  more: {
    position: "absolute",
    right: 1,
    bottom: 1,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: {
    fontSize: 10,
    fontWeight: "800",
    color: theme.colors.primary,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  footerText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  budget: {
    marginLeft: "auto",
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  dim: {
    opacity: 0.3,
  },
  pressed: {
    opacity: 0.6,
  },
}));
