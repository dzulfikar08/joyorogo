import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { fmtDecimal } from "@joyorogo/i18n";

import { Card, ListGroup, ListRow, Num, Skeleton, Text } from "@/components/ui";
import { MetaLine } from "@/components/meta-line";
import { fmtIdr } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * "Belanja makan": spending totals, budget left, average per meal slot,
 * and the best-value plates ranked by protein per Rp1.000.
 */
export function BelanjaSection() {
  const { t } = useTranslation(["makan", "common"]);
  const spending = useQuery(orpc.plate.spending.queryOptions());
  const best = useQuery(orpc.plate.bestValue.queryOptions());
  const { theme } = useUnistyles();
  // Long list: collapsed by default; the header still shows today's total.
  const [open, setOpen] = useState(false);

  if (spending.isPending) {
    return (
      <Card style={styles.gap}>
        <Skeleton width="60%" height={18} />
        <Skeleton width="100%" height={44} radius={14} />
      </Card>
    );
  }
  if (spending.isError) return null;

  const s = spending.data;
  const bestRows = (best.data ?? []).slice(0, 3);
  const avgRows = (Object.entries(s.avgPerSlot) as Array<[Meal, number | null]>).filter(
    (entry): entry is [Meal, number] => entry[1] !== null && entry[1] > 0,
  );

  return (
    <Card style={styles.gap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("plate.belanja.title")}
        style={styles.header}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>{t("plate.belanja.title")}</Text>
          <MetaLine
            items={[
              t("plate.belanja.todayMeta", { amount: fmtIdr(s.today) }),
              s.budget?.remaining != null
                ? t("plate.belanja.leftShort", { amount: fmtIdr(s.budget.remaining) })
                : t("plate.belanja.weekMeta", { amount: fmtIdr(s.week) }),
            ]}
            itemStyle={styles.empty}
          />
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={20}
          color={theme.colors.mutedForeground}
        />
      </Pressable>
      {open ? (
        <>
          <View style={styles.totalsRow}>
            <View style={styles.total}>
              <Text style={styles.totalLabel}>{t("common:date.today")}</Text>
              <Num style={styles.totalValue}>{fmtIdr(s.today)}</Num>
            </View>
            <View style={styles.total}>
              <Text style={styles.totalLabel}>{t("plate.belanja.thisWeek")}</Text>
              <Num style={styles.totalValue}>{fmtIdr(s.week)}</Num>
            </View>
            <View style={styles.total}>
              <Text style={styles.totalLabel}>{t("plate.belanja.thisMonth")}</Text>
              <Num style={styles.totalValue}>{fmtIdr(s.month)}</Num>
            </View>
          </View>
          {s.budget ? (
            <Text style={styles.budgetNote}>
              {s.budget.remaining !== null && s.budget.remaining < 0
                ? t(`plate.belanja.overBudget.${s.budget.period}`, {
                    amount: fmtIdr(Math.abs(s.budget.remaining)),
                  })
                : t(`plate.belanja.budgetNote.${s.budget.period}`, {
                    amount: s.budget.remaining !== null ? fmtIdr(s.budget.remaining) : "–",
                  })}
            </Text>
          ) : null}
          {avgRows.length > 0 ? (
            <ListGroup>
              {avgRows.map(([slot, value]) => (
                <ListRow
                  key={slot}
                  title={MEAL_LABELS[slot]}
                  subtitle={t("plate.belanja.avg30")}
                  value={fmtIdr(value)}
                />
              ))}
            </ListGroup>
          ) : null}
          {bestRows.length > 0 ? (
            <View style={styles.gap}>
              <Text style={styles.subtitle}>{t("plate.belanja.bestValue")}</Text>
              <ListGroup>
                {bestRows.map((row) => (
                  <ListRow
                    key={row.key}
                    title={row.name}
                    subtitle={
                      <MetaLine
                        items={[
                          row.place ?? null,
                          t("plate.belanja.proteinPerPrice", {
                            g: `${fmtDecimal(row.proteinPer1000, 1)} g`,
                            price: fmtIdr(1000),
                          }),
                        ]}
                      />
                    }
                    value={fmtIdr(row.priceIdr)}
                  />
                ))}
              </ListGroup>
            </View>
          ) : null}
          {s.today === 0 && s.month === 0 && bestRows.length === 0 ? (
            <Text style={styles.empty}>{t("plate.belanja.emptyNative")}</Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** One-line variant for Beranda; renders nothing until there is something to show. */
export function BelanjaCompact() {
  const { t } = useTranslation(["makan", "common"]);
  const spending = useQuery(orpc.plate.spending.queryOptions());
  if (spending.isPending || spending.isError) return null;
  const s = spending.data;
  if (s.today === 0 && s.budget === null) return null;
  return (
    <Card>
      <MetaLine
        items={[
          t("plate.belanja.todayLine", { amount: fmtIdr(s.today) }),
          s.budget?.remaining != null
            ? s.budget.remaining < 0
              ? t("plate.belanja.compactOver", { amount: fmtIdr(Math.abs(s.budget.remaining)) })
              : t("plate.belanja.compactLeft", { amount: fmtIdr(s.budget.remaining) })
            : null,
        ]}
        itemStyle={styles.compact}
      />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  gap: {
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  totalsRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  total: {
    flex: 1,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    gap: 2,
  },
  totalLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  totalValue: {
    fontSize: theme.fontSize.md,
    color: theme.colors.foreground,
  },
  budgetNote: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  empty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  compact: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
}));
