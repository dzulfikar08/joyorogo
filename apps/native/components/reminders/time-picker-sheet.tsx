import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { fmtHHMM, parseHHMM } from "@joyorogo/api/lib/fasting";

import { Button, Num, Sheet, Text } from "@/components/ui";

const COLUMNS = 6;

function rowsOf(values: number[]): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < values.length; i += COLUMNS) rows.push(values.slice(i, i + COLUMNS));
  return rows;
}

const HOUR_ROWS = rowsOf(Array.from({ length: 24 }, (_, i) => i));
const MINUTE_ROWS = rowsOf(Array.from({ length: 12 }, (_, i) => i * 5));

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Styled time picker in the house bottom sheet: tap an hour, tap a minute
 * (5-minute steps). Replaces the OS clock dialog, which ignores the app theme.
 */
export function TimePickerSheet({
  visible,
  onClose,
  title,
  value,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** 'HH:MM' */
  value: string;
  onSave: (value: string) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [minutes, setMinutes] = useState(parseHHMM(value) ?? 0);

  // Fresh draft per open: an unsaved pick must not leak into the next visit.
  useEffect(() => {
    if (visible) setMinutes(parseHHMM(value) ?? 0);
  }, [visible, value]);

  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <Button label={t("common:actions.save")} onPress={() => onSave(fmtHHMM(minutes))} />
      }
    >
      <View style={styles.readout} accessibilityLiveRegion="polite">
        <Num style={styles.readoutText}>{fmtHHMM(minutes)}</Num>
      </View>

      <Text style={styles.groupLabel}>{t("reminders.timePicker.hour")}</Text>
      <View style={styles.grid}>
        {HOUR_ROWS.map((row) => (
          <View key={row[0]} style={styles.gridRow}>
            {row.map((h) => (
              <Cell
                key={h}
                label={pad(h)}
                selected={h === hour}
                accessibilityLabel={t("reminders.timePicker.hourAria", { value: pad(h) })}
                onPress={() => setMinutes(h * 60 + minute)}
              />
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.groupLabel}>{t("reminders.timePicker.minute")}</Text>
      <View style={styles.grid}>
        {MINUTE_ROWS.map((row) => (
          <View key={row[0]} style={styles.gridRow}>
            {row.map((m) => (
              <Cell
                key={m}
                label={pad(m)}
                selected={m === minute}
                accessibilityLabel={t("reminders.timePicker.minuteAria", { value: pad(m) })}
                onPress={() => setMinutes(hour * 60 + m)}
              />
            ))}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function Cell({
  label,
  selected,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        selected && styles.cellSelected,
        pressed && !selected && styles.cellPressed,
      ]}
    >
      <Num style={[styles.cellLabel, selected && styles.cellLabelSelected]}>{label}</Num>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  readout: {
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
  },
  readoutText: {
    fontSize: theme.fontSize.display,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  groupLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  grid: {
    gap: theme.spacing.sm,
  },
  gridRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  cell: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
  },
  cellSelected: {
    backgroundColor: theme.colors.primary,
  },
  cellPressed: {
    opacity: 0.7,
  },
  cellLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  cellLabelSelected: {
    color: theme.colors.primaryForeground,
  },
}));
