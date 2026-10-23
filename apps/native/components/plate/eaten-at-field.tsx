import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  EATEN_AT_MAX_FUTURE_MS,
  defaultEatenAt,
  eatenAtClock,
  eatenAtFromClock,
  eatenAtNudge,
  eatenAtPresets,
} from "@joyorogo/api/lib/eaten-at";

import { TimePickerSheet } from "@/components/reminders/time-picker-sheet";
import { Chip, Field, Text } from "@/components/ui";

/**
 * "Waktu makan" for every add and edit flow. `null` means now and nothing is sent, so one-tap logging stays one tap.
 * Chips: Sekarang, the parts of the day already behind us (Tadi pagi / siang / malam) and a time picker (day zone
 * clock of the diary day `date`). When the meal slot does not suit the clock right now (Sarapan at 21:00) a one-tap
 * "Jam makan sebenarnya?" opens the picker on that slot's usual time. `value` is unix ms or null.
 */
export function EatenAtField({
  date,
  meal,
  value,
  onChange,
}: {
  /** Diary day (key) the time must fall on. */
  date: string;
  meal: string;
  value: number | null;
  onChange: (eatenAt: number | null) => void;
}) {
  const { t } = useTranslation("makan");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const presets = eatenAtPresets(date, now);
  const nudge = value === null ? eatenAtNudge(date, meal, now) : null;
  const preset = presets.find((p) => p.eatenAt === value);
  const custom = value !== null && !preset;
  const choose = (next: number | null) => {
    setError(null);
    onChange(next);
  };
  return (
    <>
      <Field label={t("eatenAt.label")}>
        <View style={styles.row}>
          <Chip compact label={t("eatenAt.now")} selected={value === null} onPress={() => choose(null)} />
          {presets.map((p) => (
            <Chip
              key={p.key}
              compact
              label={t(`eatenAt.${p.key}`)}
              selected={preset?.key === p.key}
              onPress={() => choose(p.eatenAt)}
            />
          ))}
          <Chip
            compact
            label={custom ? eatenAtClock(value) : t("eatenAt.pick")}
            selected={custom}
            onPress={() => setPicking(true)}
          />
        </View>
        {nudge !== null ? (
          <Chip compact label={t("eatenAt.nudge")} onPress={() => setPicking(true)} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.hint}>{t("eatenAt.hint")}</Text>
      </Field>
      <TimePickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title={t("eatenAt.sheetTitle")}
        value={eatenAtClock(value ?? nudge ?? defaultEatenAt(date, meal))}
        onSave={(next) => {
          const ms = eatenAtFromClock(date, next);
          setPicking(false);
          if (ms === null) return;
          if (ms > Date.now() + EATEN_AT_MAX_FUTURE_MS) setError(t("eatenAt.future"));
          else choose(ms);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  error: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
}));
