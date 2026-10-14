import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import {
  daysInMonth,
  monthLabel,
  parseDateKey,
  recentDayLabel,
  weekdayIndex,
} from "@joyorogo/api/lib/format";

import { Chip, Sheet, Text } from "@/components/ui";

// How far back a log date may be moved: bounded recent window, WIB day keys.
const WINDOW_DAYS = 30;

const WEEKDAYS = ["Sn", "Sl", "R", "K", "J", "S", "M"] as const;

/** Chip shortcuts for the three most recent days. */
export function DayChips({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const today = jakartaToday();
  const options = [today, shiftDate(today, -1), shiftDate(today, -2)];
  return (
    <View style={styles.chipRow}>
      {options.map((date) => (
        <Chip
          key={date}
          label={recentDayLabel(date, today)}
          selected={value === date}
          onPress={() => onChange(date)}
        />
      ))}
    </View>
  );
}

/** Month grid in WIB day keys: future days and anything outside the window
 * are rendered dim and untappable. Months step one at a time within bounds.
 * `month` is a 'YYYY-MM' key — everything is parsed by hand because the
 * string Date constructor and Intl are unreliable on Hermes. */
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

  const parts = parseDateKey(`${month}-01`);
  if (!parts) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const canPrev = month > min.slice(0, 7);
  const canNext = month < today.slice(0, 7);
  const prevMonth =
    parts.month === 1 ? `${parts.year - 1}-12` : `${parts.year}-${pad(parts.month - 1)}`;
  const nextMonth =
    parts.month === 12 ? `${parts.year + 1}-01` : `${parts.year}-${pad(parts.month + 1)}`;
  const total = daysInMonth(parts.year, parts.month);
  const leading = weekdayIndex(`${month}-01`);

  const cells: Array<{ key: string; day: number } | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let day = 1; day <= total; day++) cells.push({ key: `${month}-${pad(day)}`, day });

  return (
    <View>
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bulan sebelumnya"
          disabled={!canPrev}
          onPress={() => onMonth(prevMonth)}
          style={({ pressed }) => [
            styles.monthNav,
            pressed && styles.pressedSoft,
            !canPrev && styles.dim,
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bulan berikutnya"
          disabled={!canNext}
          onPress={() => onMonth(nextMonth)}
          style={({ pressed }) => [
            styles.monthNav,
            pressed && styles.pressedSoft,
            !canNext && styles.dim,
          ]}
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
        {cells.map((cell, index) => {
          if (cell === null) {
            return <View key={`empty-${index}`} style={styles.cell} />;
          }
          const disabled = cell.key > today || cell.key < min;
          const selected = cell.key === value;
          return (
            <Pressable
              key={cell.key}
              accessibilityRole="button"
              accessibilityLabel={cell.key}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onPick(cell.key)}
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
                {cell.day}
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
  // the chip picks until one lands. Root cause of the dead calendar: the old
  // init appended "-01" to the sliced key, so `month` became "2026-10-01"
  // while the grid expects "YYYY-MM" — "2026-10-01" + "-01" parses as
  // Invalid Date and every cell label sliced back to 1. Month is a plain
  // 'YYYY-MM' key now, parsed by hand.
  const [month, setMonth] = useState(() => {
    const parts = parseDateKey(value);
    return parts
      ? `${parts.year}-${String(parts.month).padStart(2, "0")}`
      : jakartaToday().slice(0, 7);
  });
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
