import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";

import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";

/**
 * Prev/next day row shared by every daily screen: chevrons around
 * "Hari ini" / "Kemarin" / "Sen, 12 Okt" (day keys). Next is disabled on
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
  const { t: tr } = useTranslation("makan");
  const { theme } = useUnistyles();
  const t = today ?? jakartaToday();
  const isToday = date === t;
  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={tr("daySwitcher.prev")}
        onPress={() => onChange(shiftDate(date, -1))}
        scaleTo={0.88}
        style={styles.arrow}
      >
        <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={isToday ? undefined : tr("daySwitcher.backToToday")}
        disabled={isToday}
        onPress={() => onChange(t)}
        hitSlop={8}
        scaleTo={1}
        dimTo={0.7}
      >
        <Text style={styles.label} numberOfLines={1}>
          {relativeDayLabel(date, t)}
        </Text>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={tr("daySwitcher.next")}
        disabled={isToday}
        onPress={() => onChange(shiftDate(date, 1))}
        scaleTo={0.88}
        style={[styles.arrow, isToday && styles.disabled]}
      >
        <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
      </PressableScale>
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
  disabled: {
    opacity: 0.35,
  },
}));
