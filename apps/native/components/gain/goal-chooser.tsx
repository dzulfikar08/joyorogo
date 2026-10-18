import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { GOALS, type Goal } from "@joyorogo/api/lib/gain";

import { Segmented, Text } from "@/components/ui";

/** Turunin BB / Jaga BB / Naikin BB, with the one-line hint of the chosen goal underneath. */
export function GoalChooser({
  value,
  onChange,
}: {
  value: Goal;
  onChange: (goal: Goal) => void;
}) {
  const { t } = useTranslation("gain");
  return (
    <View style={styles.wrap}>
      <Segmented
        options={GOALS.map((goal) => ({ value: goal, label: t(`goal.${goal}`) }))}
        value={value}
        onChange={onChange}
      />
      <Text style={styles.hint}>{t(`goal.hint.${value}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.sm,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
}));
