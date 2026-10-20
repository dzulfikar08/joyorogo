import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { defaultEatenAt, eatenAtClock, eatenAtFromClock } from "@joyorogo/api/lib/eaten-at";

import { TimePickerSheet } from "@/components/reminders/time-picker-sheet";
import { Button, Field, Text } from "@/components/ui";

/**
 * Optional "Jam makan" row for the add and edit flows. No value means "now" and
 * nothing is sent, so one-tap logging stays one tap; the row only opens the
 * (WIB) time picker when tapped. `value` is unix ms or null.
 */
export function EatenAtField({
  date,
  meal,
  value,
  onChange,
}: {
  /** Diary day (WIB key) the time must fall on. */
  date: string;
  meal: string;
  value: number | null;
  onChange: (eatenAt: number | null) => void;
}) {
  const { t } = useTranslation("makan");
  const [picking, setPicking] = useState(false);
  const clock = value === null ? null : eatenAtClock(value);
  return (
    <>
      <Field label={t("eatenAt.label")}>
        <View style={styles.row}>
          <Button
            variant="ghost"
            size="sm"
            icon="time-outline"
            label={clock ?? t("eatenAt.now")}
            onPress={() => setPicking(true)}
          />
          {clock ? (
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              label={t("eatenAt.clear")}
              onPress={() => onChange(null)}
            />
          ) : null}
        </View>
        <Text style={styles.hint}>{t("eatenAt.hint")}</Text>
      </Field>
      <TimePickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title={t("eatenAt.sheetTitle")}
        value={eatenAtClock(value ?? defaultEatenAt(date, meal))}
        onSave={(next) => {
          const ms = eatenAtFromClock(date, next);
          if (ms !== null) onChange(ms);
          setPicking(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
}));
