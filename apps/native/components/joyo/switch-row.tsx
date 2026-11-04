import { Pressable, Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

/**
 * A label and a switch on one line, at least 56 pt high. The whole row is one control: tapping the label toggles it, and a screen
 * reader gets a single "switch" element with its on/off state (the inner Switch is hidden from it, so it is not read twice).
 */
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
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={styles.row}
    >
      <Text style={styles.label}>{label}</Text>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Switch value={value} disabled={disabled} trackColor={{ true: theme.colors.primary }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  label: { flex: 1, fontSize: theme.fontSize.base, lineHeight: 21 },
}));
