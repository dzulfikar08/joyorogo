import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { fmtKcal } from "@/utils/format";

/**
 * One day on a vertical timeline: a dot and a rail down the left edge, the
 * day title with a count pill, then `children` indented under the rail.
 */
export function Timeline({
  title,
  count,
  trailing,
  children,
}: {
  title: string;
  count: number;
  /** Right-aligned action in the day header (e.g. "Buka di Daftar"). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.rail} />
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{fmtKcal(count)} catatan</Text>
        </View>
        {trailing}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    paddingLeft: 24,
  },
  rail: {
    position: "absolute",
    top: 14,
    bottom: 0,
    left: 5.5,
    width: 1,
    backgroundColor: theme.colors.hairline,
  },
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dot: {
    position: "absolute",
    left: -24,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.background,
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.card,
  },
  pillText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  body: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
}));
