import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * A round icon button with a 44 pt hit area. `filled` is the one primary action of a bar (send); the rest are quiet muted icons
 * (copy, regenerate, history). The label is the accessible name: an icon alone says nothing to a screen reader.
 */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  filled,
  size = 20,
  tone = "muted",
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
  size?: number;
  tone?: "muted" | "foreground";
}) {
  const { theme } = useUnistyles();
  const color = filled
    ? theme.colors.primaryForeground
    : tone === "foreground"
      ? theme.colors.foreground
      : theme.colors.mutedForeground;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.94}
      style={[
        styles.base,
        filled && { backgroundColor: theme.colors.primary },
        disabled && styles.disabled,
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
});
