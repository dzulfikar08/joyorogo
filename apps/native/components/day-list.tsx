import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Num, Text } from "@/components/ui";

export type DayListRow = {
  key: string;
  title: string;
  /** Second line: the target the figure is read against, a note. */
  sub?: string;
  value: string;
  /** True: the goal was reached (check mark), false: not, null: no verdict. The mark never stands alone: the figure is next to it. */
  hit?: boolean | null;
};

const COLLAPSED_ROWS = 7;

/**
 * Exact figures under a chart, newest first. The chart gives the shape and this gives the numbers (and a screen reader
 * something to walk). A row can be tapped to select its bar; the selected row is tinted. Long periods start with the
 * newest rows and open on request.
 */
export function DayList({
  rows,
  selectedKey,
  onSelect,
  title,
}: {
  rows: DayListRow[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  title: string;
}) {
  const { t } = useTranslation("common");
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  // The selected row is always visible, even when it sits past the collapsed rows.
  const selectedIndex =
    selectedKey === null ? -1 : rows.findIndex((row) => row.key === selectedKey);
  const showAll = open || selectedIndex >= COLLAPSED_ROWS;
  const shown = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View>
        {shown.map((row, index) => {
          const selected = row.key === selectedKey;
          return (
            <PressableScale
              key={row.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${row.title}, ${row.value}${row.sub ? `, ${row.sub}` : ""}`}
              onPress={() => onSelect(selected ? null : row.key)}
              scaleTo={1}
              dimTo={0.7}
              style={[styles.row, index > 0 && styles.rowDivider, selected && styles.rowSelected]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {row.title}
                </Text>
                {row.sub ? (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {row.sub}
                  </Text>
                ) : null}
              </View>
              {row.hit ? (
                <Ionicons name="checkmark-circle" size={18} color={theme.colors.makanText} />
              ) : null}
              <Num style={styles.rowValue}>{row.value}</Num>
            </PressableScale>
          );
        })}
      </View>
      {rows.length > COLLAPSED_ROWS && selectedIndex < COLLAPSED_ROWS ? (
        <PressableScale
          accessibilityRole="button"
          onPress={() => setOpen((v) => !v)}
          scaleTo={1}
          dimTo={0.7}
          style={styles.more}
        >
          <Text style={styles.moreText}>
            {open ? t("range.showLess") : t("range.showAll", { count: rows.length })}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.xs },
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    minHeight: 48,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.tile,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  rowSelected: { backgroundColor: theme.colors.muted },
  rowText: { flex: 1 },
  rowTitle: { fontSize: theme.fontSize.base, fontWeight: "600", color: theme.colors.foreground },
  rowSub: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  rowValue: { fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  moreText: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.makanText },
}));
