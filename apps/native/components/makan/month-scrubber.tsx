import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { fmtDate } from "@joyorogo/i18n";
import { jakartaToday } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { daysInMonth } from "@joyorogo/api/lib/format";

import { Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * Month header for Daftar: "Oktober 2026", the month's totals, and a dot
 * strip, one mark per day (a tall pill once something is logged, the viewed
 * day in the accent colour). Tapping a mark jumps to that day; future days are
 * off. The DaySwitcher stays the precise control, this is the quick scrub.
 */
export function MonthScrubber({
  date,
  kind,
  onPick,
}: {
  date: string;
  kind: FoodKindFilter;
  onPick: (date: string) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const today = jakartaToday();
  const month = date.slice(0, 7);
  const totals = useQuery({
    ...orpc.diary.monthTotals.queryOptions({ input: { month, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const days = totals.data?.days ?? [];
  const records = days.reduce((sum, day) => sum + day.count, 0);
  const total = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

  return (
    <View style={styles.wrap}>
      <Text style={styles.month}>{fmtDate(`${month}-01`, "month")}</Text>
      <Text style={styles.counts}>
        {t("monthScrubber.records", { count: records, n: fmtInt(records) })} ·{" "}
        {t("monthScrubber.daysLogged", { count: days.length, n: fmtInt(days.length) })}
      </Text>
      <View style={styles.strip} accessibilityRole="toolbar">
        {Array.from({ length: total }, (_, index) => {
          const key = `${month}-${String(index + 1).padStart(2, "0")}`;
          const logged = days.some((day) => day.date === key);
          const future = key > today;
          const current = key === date;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={
                logged
                  ? t("monthScrubber.dayWithEntries", { date: fmtDate(key, "weekday") })
                  : fmtDate(key, "weekday")
              }
              accessibilityState={{ selected: current, disabled: future }}
              disabled={future}
              onPress={() => onPick(key)}
              style={styles.hit}
            >
              <View
                style={[
                  styles.mark,
                  logged ? styles.markLogged : styles.markEmpty,
                  {
                    backgroundColor: current
                      ? theme.colors.primary
                      : future
                        ? theme.colors.muted
                        : logged
                          ? theme.colors.makan
                          : theme.colors.hairline,
                  },
                  logged && !current && styles.markSoft,
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: 2,
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
  strip: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: theme.spacing.sm,
  },
  hit: {
    flex: 1,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    width: 5,
    borderRadius: 3,
  },
  markLogged: {
    height: 16,
  },
  markEmpty: {
    height: 5,
  },
  markSoft: {
    opacity: 0.55,
  },
}));
