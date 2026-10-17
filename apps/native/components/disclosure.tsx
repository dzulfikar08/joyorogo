import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

/**
 * Collapsed-by-default accordion row for explanations, disclaimers and
 * how-it-works text, so the core data of a screen stays on one phone screen.
 * `plain` drops the card background for use inside an existing card.
 */
export function Disclosure({
  title,
  children,
  plain,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  plain?: boolean;
  defaultOpen?: boolean;
}) {
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={plain ? undefined : styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <Text style={styles.title}>{title}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.colors.mutedForeground}
        />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: 20,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.lg,
  },
  head: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  body: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
}));
