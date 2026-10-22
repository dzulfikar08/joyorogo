import { Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

/** A label and a switch on one line, at least 56 pt high, the whole row readable as one control by a screen reader. */
export function SwitchRow({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: theme.colors.primary }}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  label: { flex: 1, fontSize: theme.fontSize.base, lineHeight: 21 },
}));
