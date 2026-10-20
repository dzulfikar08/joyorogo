import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { ListGroup, Num, Text, type Tint } from "@/components/ui";

type IconName = ComponentProps<typeof Ionicons>["name"];

const ICON_COLOR = { makan: "makan", bakar: "bakar", tidur: "tidur" } as const;

/**
 * One line of the daily numbers: icon, label, a single-line secondary text, and the value with its unit inline. The surface
 * is neutral; the accent lives only on the icon and the optional progress bar. Tap goes to the detail screen (chevron), or
 * `right` replaces the chevron with a direct action (the water +1).
 */
export function StatRow({
  icon,
  tint,
  label,
  value,
  secondary,
  progress,
  right,
  onPress,
}: {
  icon: IconName;
  tint: Tint;
  label: string;
  /** Number and unit together ("6,8 jam"): the unit never sits on another line. */
  value: string;
  secondary?: string;
  /** 0..1 fill of a thin bar under the secondary text. */
  progress?: number;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const { theme } = useUnistyles();
  const accent = theme.colors[ICON_COLOR[tint]];
  const body = (
    <>
      <View style={styles.chip}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {secondary ? (
          <Text style={styles.secondary} numberOfLines={1}>
            {secondary}
          </Text>
        ) : null}
        {progress !== undefined ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, backgroundColor: accent }]} />
          </View>
        ) : null}
      </View>
      <Num style={styles.value} numberOfLines={1}>
        {value}
      </Num>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      scaleTo={1}
      dimTo={0.7}
      style={styles.row}
    >
      {body}
    </PressableScale>
  );
}

/** The StatRows in one hairline-separated card. */
export function StatList({ children }: { children: ReactNode }) {
  return <ListGroup>{children}</ListGroup>;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
    minHeight: 60,
  },
  chip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  secondary: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  track: {
    height: 4,
    borderRadius: 2,
    marginTop: 2,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
  value: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
    flexShrink: 0,
  },
}));
