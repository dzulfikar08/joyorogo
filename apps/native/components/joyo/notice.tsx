import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Text } from "@/components/ui";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * One inline notice: a short text on a soft surface, with at most one action. `danger` is for something that failed; `info` for
 * something the person should know (a model without tools, no sign-in).
 */
export function Notice({
  children,
  tone = "info",
  icon,
  action,
}: {
  children: ReactNode;
  tone?: "info" | "danger";
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}) {
  const { theme } = useUnistyles();
  const danger = tone === "danger";
  return (
    <View
      style={[styles.box, danger && { backgroundColor: theme.colors.destructiveSoft }]}
      accessibilityRole={danger ? "alert" : undefined}
    >
      <View style={styles.line}>
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={danger ? theme.colors.destructiveText : theme.colors.mutedForeground}
          />
        ) : null}
        <Text style={[styles.text, danger && { color: theme.colors.destructiveText }]}>
          {children}
        </Text>
      </View>
      {action ? (
        <Button variant="secondary" size="sm" label={action.label} onPress={action.onPress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.input,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  line: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm },
  text: { flex: 1, fontSize: theme.fontSize.sm, lineHeight: 20 },
}));
