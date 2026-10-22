import { StyleSheet } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";

/** A starter question as a tappable pill. It wraps to as many lines as the question needs, so none is cut off. */
export function SuggestionChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.97}
      style={styles.chip}
    >
      <Text style={styles.label}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
  },
  label: { fontSize: theme.fontSize.sm, lineHeight: 19, fontWeight: "600" },
}));
