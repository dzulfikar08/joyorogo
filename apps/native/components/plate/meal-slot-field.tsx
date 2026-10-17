import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { MEAL_EDIT_LABELS, MEALS, effectiveRamadan, slotsFor } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import { Chip, Field, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

/**
 * "Waktu makan" chips for the plate and food edit sheets: Sarapan, Makan
 * siang, Makan malam, Camilan, plus Sahur / Berbuka in Ramadan mode. A slot
 * the row already has stays visible even when it is off-season.
 */
export function MealSlotField({
  value,
  current,
  onChange,
  hint,
}: {
  value: Meal;
  /** Slot stored today; shown even outside the active slot set. */
  current: Meal;
  onChange: (meal: Meal) => void;
  hint: string;
}) {
  const { t } = useTranslation("makan");
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const active = slotsFor(effectiveRamadan(profile.data?.profile?.ramadanMode));
  const options = MEALS.filter((meal) => active.includes(meal) || meal === current);
  return (
    <Field label={t("plate.mealSlot.label")}>
      <View style={styles.box}>
        <View style={styles.chips}>
          {options.map((meal) => (
            <Chip
              key={meal}
              label={MEAL_EDIT_LABELS[meal]}
              selected={value === meal}
              onPress={() => onChange(meal)}
            />
          ))}
        </View>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </Field>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.spacing.sm,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
}));
