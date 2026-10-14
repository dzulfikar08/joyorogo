import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";

import { Chip, Sheet, Text } from "@/components/ui";

// How far back a log date may be moved: bounded recent window, WIB day keys.
const WINDOW_DAYS = 30;

const WEEKDAYS = ["Sn", "Sl", "R", "K", "J", "S", "M"] as const;

/** Monday-first index of a day key (YYYY-MM-DD). */
function weekdayIndex(date: string): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (dow + 6) % 7;
}

/** Chip shortcuts for the three most recent days. */
export function DayChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (date: string) => void;
}) {
  const today = jakartaToday();
  const options = [today, shiftDate(today, -1), shiftDate(today, -2)];
  return (
    <View style={styles.chipRow}>
      {options.map((date) => (
        <Chip
          key={date}
          label={relativeDayLabel(date, today)}
          selected={value === date}
          onPress={() => onChange(date)}
        />
      ))}
    </View>
  );
}

/** Month grid in WIB day keys: future days and anything outside the window
 * are rendered dim and untappable. Months step one at a time within bounds. */
function MonthGrid({
  value,
  month,
  onMonth,
  onPick,
}: {
  value: string;
  month: string;
  onMonth: (month: string) => void;
  onPick: (date: string) => void;
}) {
  const { theme } = useUnistyles();
  const today = jakartaToday();
  const min = shiftDate(today, -WINDOW_DAYS);

  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const first = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const leading = weekdayIndex(first);

  const canPrev = `${month}-01` > `${min.slice(0, 7)}-01`;
  const canNext = month < today.slice(0, 7);
  const prevMonth =
    monthIndex === 0 ? `${year - 1}-12-01` : `${year}-${String(monthIndex).padStart(2, "0")}-01`;
  const nextMonth =
    monthIndex === 11 ? `${year + 1}-01-01` : `${year}-${String(monthIndex + 2).padStart(2, "0")}-01`;
  const monthLabel = new Date(`${first}T00:00:00Z`).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const cells: Array<string | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }

  return (
    <View>
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bulan sebelumnya"
          disabled={!canPrev}
          onPress={() => onMonth(prevMonth)}
          style={({ pressed }) => [styles.monthNav, pressed && styles.pressedSoft, !canPrev && styles.dim]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bulan berikutnya"
          disabled={!canNext}
          onPress={() => onMonth(nextMonth)}
          style={({ pressed }) => [styles.monthNav, pressed && styles.pressedSoft, !canNext && styles.dim]}
        >
          <Ionicons name="chevron-forward" size={18} color={theme.colors.foreground} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {WEEKDAYS.map((label) => (
          <Text key={label} style={[styles.cell, styles.weekday]}>
            {label}
          </Text>
        ))}
        {cells.map((date, index) => {
          if (date === null) {
            return <View key={`empty-${index}`} style={styles.cell} />;
          }
          const disabled = date > today || date < min;
          const selected = date === value;
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityLabel={date}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onPick(date)}
              style={({ pressed }) => [
                styles.cell,
                styles.day,
                selected && { backgroundColor: theme.colors.foreground },
                (pressed || disabled) && styles.pressedSoft,
              ]}
            >
              <Text
                style={[
                  styles.dayLabel,
                  selected && { color: theme.colors.background },
                  disabled && styles.dim,
                ]}
              >
                {Number(date.slice(8, 10))}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Styled calendar sheet: day chips first, then the full month grid. */
export function DateSheet({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const today = jakartaToday();
  // The grid opens on the chosen day's month; browsing stays independent of
  // the chip picks until one lands.
  const [month, setMonth] = useState(`${value.slice(0, 7)}-01`);
  return (
    <Sheet visible={visible} onClose={onClose} title="Pilih tanggal">
      <DayChips value={value} onChange={onPick} />
      <MonthGrid
        value={value}
        month={month}
        onMonth={setMonth}
        onPick={(date) => {
          onPick(date);
          onClose();
        }}
      />
      <Text style={styles.hint}>Antara {shiftDate(today, -WINDOW_DAYS)} dan hari ini.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  monthNav: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  monthLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  weekday: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  day: {
    aspectRatio: 1,
    borderRadius: 999,
  },
  dayLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  dim: {
    opacity: 0.35,
  },
  pressedSoft: {
    opacity: 0.6,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    marginTop: theme.spacing.sm,
  },
}));
