import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";

import { Text } from "@/components/ui";

/**
 * Prev/next day row shared by every daily screen: chevrons around
 * "Hari ini" / "Kemarin" / "Sen, 12 Okt" (WIB day keys). Next is disabled on
 * today; tapping the label jumps back to today.
 */
export function DaySwitcher({
  date,
  onChange,
  today,
}: {
  date: string;
  onChange: (date: string) => void;
  today?: string;
}) {
  const { theme } = useUnistyles();
  const t = today ?? jakartaToday();
  const isToday = date === t;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hari sebelumnya"
        onPress={() => onChange(shiftDate(date, -1))}
        style={({ pressed }) => [styles.arrow, pressed && styles.pressedSoft]}
      >
        <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isToday ? undefined : "Kembali ke hari ini"}
        disabled={isToday}
        onPress={() => onChange(t)}
        hitSlop={8}
      >
        <Text style={styles.label} numberOfLines={1}>
          {relativeDayLabel(date, t)}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hari berikutnya"
        disabled={isToday}
        onPress={() => onChange(shiftDate(date, 1))}
        style={({ pressed }) => [styles.arrow, isToday && styles.disabled, pressed && styles.pressedSoft]}
      >
        <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
    minWidth: 120,
    textAlign: "center",
  },
  pressedSoft: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.35,
  },
}));
