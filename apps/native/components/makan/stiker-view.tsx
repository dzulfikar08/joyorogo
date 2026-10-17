import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { monthRange, shiftMonth, weekRange } from "@joyorogo/api/lib/diary-view";
import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import type { StickerRow } from "@joyorogo/api/routers/diary";
import { fmtDate } from "@joyorogo/i18n";

import { FoodSticker } from "@/components/sticker";
import { Card, Segmented, Text } from "@/components/ui";
import { fmtInt, fmtKcalLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type Span = "minggu" | "bulan";

const SPANS: ReadonlyArray<Span> = ["minggu", "bulan"];

const COLUMNS = 3;
/** Small fixed tilts so the grid reads like a sticker sheet. */
const TILTS = ["-2deg", "1deg", "2deg", "-1deg"] as const;

function useStickerQuery(from: string, to: string, kind: FoodKindFilter) {
  return useQuery({
    ...orpc.diary.stickers.queryOptions({ input: { from, to, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

function dayMonth(key: string): string {
  return fmtDate(key, "short");
}

/**
 * Stiker view: the food cutouts of the viewed week or month as a sticker
 * book. Tapping one opens the food sheet through `onOpen`.
 */
export function StikerView({
  date,
  kind,
  onOpen,
}: {
  date: string;
  kind: FoodKindFilter;
  onOpen: (item: StickerRow) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const today = jakartaToday();
  const [span, setSpan] = useState<Span>("minggu");
  const [anchor, setAnchor] = useState(date);
  const [from, to] = span === "minggu" ? weekRange(anchor) : monthRange(anchor.slice(0, 7));
  const query = useStickerQuery(from, to, kind);
  const items = query.data?.items ?? [];
  const title =
    span === "minggu"
      ? t("stickers.range", { from: dayMonth(from), to: dayMonth(to) })
      : fmtDate(`${anchor.slice(0, 7)}-01`, "month");
  const step = (direction: 1 | -1) =>
    setAnchor(
      span === "minggu"
        ? shiftDate(anchor, 7 * direction)
        : `${shiftMonth(anchor.slice(0, 7), direction)}-01`,
    );
  const canNext = to < today;

  const rows: StickerRow[][] = [];
  for (let i = 0; i < items.length; i += COLUMNS) rows.push(items.slice(i, i + COLUMNS));

  return (
    <View style={styles.wrap}>
      <Segmented
        options={SPANS.map((value) => ({ value, label: t(`stickers.span.${value}`) }))}
        value={span}
        onChange={setSpan}
      />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.counts}>
            {t("stickers.count", { count: items.length, n: fmtInt(items.length) })}
          </Text>
        </View>
        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(span === "minggu" ? "stickers.prevWeek" : "stickers.prevMonth")}
            onPress={() => step(-1)}
            style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(span === "minggu" ? "stickers.nextWeek" : "stickers.nextMonth")}
            disabled={!canNext}
            onPress={() => step(1)}
            style={({ pressed }) => [
              styles.navButton,
              pressed && styles.pressed,
              !canNext && styles.dim,
            ]}
          >
            <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
          </Pressable>
        </View>
      </View>

      {items.length > 0 ? (
        <View style={styles.grid}>
          {rows.map((row, rowIndex) => (
            <View key={row[0]?.id ?? rowIndex} style={styles.row}>
              {row.map((item, index) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("stickers.tile.label", {
                    name: item.name,
                    kcal: fmtKcalLabel(item.kcal),
                    date: fmtDate(item.date, "weekday"),
                  })}
                  onPress={() => onOpen(item)}
                  style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                >
                  <View
                    style={{
                      transform: [{ rotate: TILTS[(rowIndex * COLUMNS + index) % TILTS.length] }],
                    }}
                  >
                    <FoodSticker scanId={item.scanId} name={item.name} size={80} />
                  </View>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {t("stickers.tile.meta", {
                      kcal: fmtKcalLabel(item.kcal),
                      date: dayMonth(item.date),
                    })}
                  </Text>
                </Pressable>
              ))}
              {Array.from({ length: COLUMNS - row.length }, (_, pad) => (
                <View key={`pad-${pad}`} style={styles.tilePad} />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <Card style={styles.empty}>
          <MaterialCommunityIcons
            name="sticker-outline"
            size={32}
            color={theme.colors.mutedForeground}
          />
          <Text style={styles.emptyTitle}>
            {query.isPending ? t("stickers.loading") : t("stickers.empty.title")}
          </Text>
          {query.isPending ? null : (
            <Text style={styles.emptyText}>
              {t("stickers.empty.body")}
            </Text>
          )}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  counts: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  nav: {
    flexDirection: "row",
    gap: 4,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    padding: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.card,
  },
  tilePad: {
    flex: 1,
  },
  name: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    textAlign: "center",
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: 11,
    color: theme.colors.mutedForeground,
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  emptyTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    color: theme.colors.mutedForeground,
  },
  dim: {
    opacity: 0.3,
  },
  pressed: {
    opacity: 0.6,
  },
}));
