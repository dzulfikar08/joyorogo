import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { weekdayName, weekdayShort, type RecapDay } from "@joyorogo/api/lib/recap";

import { Text } from "@/components/ui";

/**
 * A week as seven pills, Monday first: a check for a day on target, an arrow up for a day over it, a dash for a logged
 * day short of it, and an empty outline for a day with nothing logged or one that has not been judged yet. `today` gets
 * a heavier outline. Every state has a glyph or a shape of its own, so the colour never carries it alone.
 */
export function WeekPills({
  days,
  gain,
  today,
}: {
  days: readonly Pick<RecapDay, "date" | "status">[];
  /** Naikin BB: under-eating is the miss, so "under" reads as a short day, never as a lower mark than over. */
  gain?: boolean;
  today?: string;
}) {
  const { t } = useTranslation(["misc", "gain"]);
  const { theme } = useUnistyles();
  return (
    <View style={styles.row}>
      {days.map((day) => {
        const status =
          gain && day.status === "under"
            ? t("gain:recap.dayUnder")
            : t(`misc:recap.chart.status.${day.status}`);
        const glyph =
          day.status === "on_target"
            ? ("checkmark" as const)
            : day.status === "over"
              ? ("arrow-up" as const)
              : day.status === "under"
                ? ("remove" as const)
                : null;
        return (
          <View
            key={day.date}
            style={styles.col}
            accessible
            accessibilityLabel={`${weekdayName(day.date)}${today === day.date ? `, ${t("misc:recap.pills.today")}` : ""}: ${status}`}
          >
            <View
              style={[
                styles.pill,
                day.status === "on_target" && {
                  backgroundColor: theme.colors.makan,
                  borderColor: theme.colors.makan,
                },
                day.status === "over" && {
                  backgroundColor: theme.colors.bakarSoft,
                  borderColor: theme.colors.bakarSoft,
                },
                day.status === "under" && {
                  backgroundColor: theme.colors.muted,
                  borderColor: theme.colors.muted,
                },
                today === day.date && styles.pillToday,
              ]}
            >
              {glyph ? (
                <Ionicons
                  name={glyph}
                  size={16}
                  color={
                    day.status === "on_target"
                      ? theme.colors.primaryForeground
                      : day.status === "over"
                        ? theme.colors.bakarText
                        : theme.colors.mutedForeground
                  }
                />
              ) : null}
            </View>
            <Text style={[styles.label, today === day.date && styles.labelToday]} numberOfLines={1}>
              {weekdayShort(day.date)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", gap: theme.spacing.xs },
  col: { flex: 1, alignItems: "center", gap: 4 },
  pill: {
    width: "100%",
    maxWidth: 44,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  pillToday: { borderWidth: 2, borderColor: theme.colors.foreground },
  label: { fontSize: theme.fontSize.xs, fontWeight: "600", color: theme.colors.mutedForeground },
  labelToday: { color: theme.colors.foreground },
}));
