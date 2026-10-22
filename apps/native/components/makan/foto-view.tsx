import { Ionicons } from "@expo/vector-icons";
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

import { MacroLine } from "@/components/macro-line";
import { FoodSticker } from "@/components/sticker";
import { Card, Num, Segmented, Text } from "@/components/ui";
import { fmtInt, fmtKcalLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type Span = "minggu" | "bulan";

const SPANS: ReadonlyArray<Span> = ["minggu", "bulan"];

const COLUMNS = 2;

/**
 * Foto view: the foods you photographed in the viewed week or month as a plain
 * nutrition grid. Each tile is a small thumbnail with the kcal and macros;
 * tapping one opens the food sheet through `onOpen`, the thumbnail opens the
 * cutout viewer through `onViewSticker`.
 */
export function FotoView({
  date,
  kind,
  onOpen,
  onViewSticker,
}: {
  date: string;
  kind: FoodKindFilter;
  onOpen: (item: StickerRow) => void;
  onViewSticker: (item: StickerRow, rows: readonly StickerRow[]) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const today = jakartaToday();
  const [span, setSpan] = useState<Span>("minggu");
  const [anchor, setAnchor] = useState(date);
  const [from, to] = span === "minggu" ? weekRange(anchor) : monthRange(anchor.slice(0, 7));
  const query = useQuery({
    ...orpc.diary.stickers.queryOptions({ input: { from, to, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const items = query.data?.items ?? [];
  const averageKcal =
    items.length > 0 ? Math.round(items.reduce((sum, item) => sum + item.kcal, 0) / items.length) : null;
  const title =
    span === "minggu"
      ? t("photos.range", { from: fmtDate(from, "short"), to: fmtDate(to, "short") })
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
        options={SPANS.map((value) => ({ value, label: t(`photos.span.${value}`) }))}
        value={span}
        onChange={setSpan}
      />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.counts}>
            {t("photos.count", { count: items.length, n: fmtInt(items.length) })}
            {averageKcal !== null
              ? ` · ${t("photos.average", { kcal: fmtKcalLabel(averageKcal) })}`
              : ""}
          </Text>
        </View>
        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(span === "minggu" ? "photos.prevWeek" : "photos.prevMonth")}
            onPress={() => step(-1)}
            style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(span === "minggu" ? "photos.nextWeek" : "photos.nextMonth")}
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
          {rows.map((row) => (
            <View key={row[0]?.id} style={styles.row}>
              {row.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("photos.tile.label", {
                    name: item.name,
                    kcal: fmtKcalLabel(item.kcal),
                    date: fmtDate(item.date, "weekday"),
                  })}
                  onPress={() => onOpen(item)}
                  style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                >
                  <View style={styles.tileTop}>
                    <FoodSticker
                      scanId={item.scanId}
                      name={item.name}
                      size={56}
                      // A kind filter hides some rows of a scan: the plate's total would not match, so the tile opens its own cutout.
                      onPress={
                        item.scanId
                          ? () => onViewSticker(kind === "semua" ? item : { ...item, plateScanId: null }, items)
                          : undefined
                      }
                    />
                    <Text style={styles.date} numberOfLines={2}>
                      {fmtDate(item.date, "weekday")}
                    </Text>
                  </View>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <View style={styles.kcalLine}>
                    <Num style={styles.kcal}>{fmtInt(item.kcal)}</Num>
                    <Text style={styles.kcalUnit}>{t("diary.summary.unit")}</Text>
                  </View>
                  <MacroLine compact protein={item.protein} carbs={item.carbs} fat={item.fat} />
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
          <Text style={styles.emptyTitle}>
            {query.isPending ? t("photos.loading") : t("photos.empty.title")}
          </Text>
          {query.isPending ? null : <Text style={styles.emptyText}>{t("photos.empty.body")}</Text>}
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
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  tile: {
    flex: 1,
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.card,
  },
  tilePad: {
    flex: 1,
  },
  tileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  date: {
    flex: 1,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  name: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    lineHeight: 18,
    color: theme.colors.foreground,
  },
  kcalLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  kcal: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.kcalText,
  },
  kcalUnit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  empty: {
    gap: theme.spacing.sm,
  },
  emptyTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  dim: {
    opacity: 0.3,
  },
  pressed: {
    opacity: 0.6,
  },
}));
