import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { fmtDate, getActiveLocale } from "@joyorogo/i18n";
import { shiftDate } from "@joyorogo/api/lib/engine";

import { Num, Text } from "@/components/ui";

const pad = (n: number) => String(n).padStart(2, "0");

/** 1 = first of the month, 'YYYY-MM' -> 'YYYY-MM-01'. */
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

function addMonths(monthIso: string, delta: number): string {
  const y = Number(monthIso.slice(0, 4));
  const m = Number(monthIso.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${year}-${pad(month + 1)}-01`;
}

function daysInMonth(monthIso: string): number {
  return new Date(
    Date.UTC(Number(monthIso.slice(0, 4)), Number(monthIso.slice(5, 7)), 0),
  ).getUTCDate();
}

/** Weekday headers, Monday first, in the active language. */
function weekdayLabels(): string[] {
  const format = new Intl.DateTimeFormat(getActiveLocale() === "en" ? "en-US" : "id-ID", {
    weekday: "short",
    timeZone: "UTC",
  });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

/**
 * In-app month calendar (Senin first). Days outside [minDate, maxDate] are
 * dimmed and not tappable. All values are 'YYYY-MM-DD' calendar days.
 */
export function Calendar({
  value,
  onChange,
  minDate,
  maxDate,
  prevLabel,
  nextLabel,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  minDate: string;
  maxDate: string;
  prevLabel: string;
  nextLabel: string;
}) {
  const { theme } = useUnistyles();
  const [month, setMonth] = useState(() => monthStart(value ?? minDate));

  // Follow the selection when it jumps to another month (quick chips).
  useEffect(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) setMonth(monthStart(value));
  }, [value]);

  const cells = useMemo(() => {
    const lead = (new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % 7;
    const total = daysInMonth(month);
    const out: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d += 1) out.push(`${month.slice(0, 8)}${pad(d)}`);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const weekdays = useMemo(weekdayLabels, []);
  const canPrev = monthStart(shiftDate(month, -1)) >= monthStart(minDate);
  const canNext = addMonths(month, 1) <= monthStart(maxDate);

  const rows: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={prevLabel}
          disabled={!canPrev}
          onPress={() => setMonth((m) => addMonths(m, -1))}
          style={({ pressed }) => [styles.nav, (!canPrev || pressed) && styles.dim]}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {fmtDate(month, "month")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nextLabel}
          disabled={!canNext}
          onPress={() => setMonth((m) => addMonths(m, 1))}
          style={({ pressed }) => [styles.nav, (!canNext || pressed) && styles.dim]}
        >
          <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {weekdays.map((label, i) => (
          <Text key={i} style={styles.weekday} numberOfLines={1}>
            {label}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={styles.week}>
          {row.map((iso, c) => {
            if (!iso) return <View key={c} style={styles.cell} />;
            const disabled = iso < minDate || iso > maxDate;
            const selected = iso === value;
            return (
              <View key={c} style={styles.cell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fmtDate(iso, "long")}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => onChange(iso)}
                  style={({ pressed }) => [
                    styles.day,
                    selected && { backgroundColor: theme.colors.primary },
                    pressed && !selected && { backgroundColor: theme.colors.muted },
                  ]}
                >
                  <Num
                    style={[
                      styles.dayText,
                      disabled && styles.dayDisabled,
                      selected && { color: theme.colors.primaryForeground },
                    ]}
                  >
                    {Number(iso.slice(8, 10))}
                  </Num>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    gap: theme.spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nav: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
  },
  dim: {
    opacity: 0.4,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  week: {
    flexDirection: "row",
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
    paddingVertical: theme.spacing.xs,
  },
  cell: {
    flex: 1,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  day: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
  },
  dayText: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  dayDisabled: {
    color: theme.colors.mutedForeground,
    opacity: 0.35,
  },
}));
