import { Fragment, type ReactNode } from "react";
import { View, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

/**
 * Inline list metadata laid out for real: items sit in a gapped row with a
 * small neutral dot between them, instead of joining strings with " · ".
 * Falsy items drop out; nothing renders when all are empty.
 */
export function MetaLine({
  items,
  style,
  itemStyle,
}: {
  items: Array<ReactNode | null | false | undefined>;
  style?: ViewStyle;
  itemStyle?: TextStyle;
}) {
  const { theme } = useUnistyles();
  const visible = items.filter((item) => item !== null && item !== false && item !== undefined);
  if (visible.length === 0) return null;
  return (
    <View style={[styles.row, style]}>
      {visible.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <View
              style={[styles.dot, { backgroundColor: theme.colors.mutedForeground }]}
              aria-hidden
            />
          )}
          <Text style={itemStyle}>{item}</Text>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.xs,
    rowGap: 2,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    opacity: 0.6,
  },
}));
