import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import { Card, ListGroup, ListRow, Num, Skeleton, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

/** "Rp28.000" — one formatter shared by every plate-price UI. */
export function fmtIdr(n: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(Math.round(n))}`;
}

/** Protein per Rp1.000, Indonesian decimal comma, e.g. "1,1 g". */
function fmtProteinPer(n: number): string {
  return `${new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n)} g`;
}

/**
 * "Belanja makan": spending totals, budget left, average per meal slot,
 * and the best-value plates ranked by protein per Rp1.000.
 */
export function BelanjaSection() {
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
        accessibilityLabel="Belanja makan"
        style={styles.header}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>Belanja makan</Text>
          <Text style={styles.empty} numberOfLines={1}>
            {`Hari ini ${fmtIdr(s.today)}`}
            {s.budget?.remaining != null
              ? ` · Sisa ${fmtIdr(s.budget.remaining)}`
              : ` · Minggu ini ${fmtIdr(s.week)}`}
          </Text>
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
              <Text style={styles.totalLabel}>Hari ini</Text>
              <Num style={styles.totalValue}>{fmtIdr(s.today)}</Num>
            </View>
            <View style={styles.total}>
              <Text style={styles.totalLabel}>Minggu ini</Text>
              <Num style={styles.totalValue}>{fmtIdr(s.week)}</Num>
            </View>
            <View style={styles.total}>
              <Text style={styles.totalLabel}>Bulan ini</Text>
              <Num style={styles.totalValue}>{fmtIdr(s.month)}</Num>
            </View>
          </View>
          {s.budget ? (
            <Text style={styles.budgetNote}>
              {s.budget.remaining !== null && s.budget.remaining < 0
                ? `Lewat ${fmtIdr(Math.abs(s.budget.remaining))} dari anggaran ${s.budget.period === "day" ? "harian" : "bulanan"}`
                : `Sisa anggaran: ${s.budget.remaining !== null ? fmtIdr(s.budget.remaining) : "–"} (${s.budget.period === "day" ? "per hari" : "per bulan"})`}
            </Text>
          ) : null}
          {avgRows.length > 0 ? (
            <ListGroup>
              {avgRows.map(([slot, value]) => (
                <ListRow
                  key={slot}
                  title={MEAL_LABELS[slot]}
                  subtitle="Rata-rata 30 hari terakhir"
                  value={fmtIdr(value)}
                />
              ))}
            </ListGroup>
          ) : null}
          {bestRows.length > 0 ? (
            <View style={styles.gap}>
              <Text style={styles.subtitle}>Nilai terbaik</Text>
              <ListGroup>
                {bestRows.map((row) => (
                  <ListRow
                    key={row.key}
                    title={row.name}
                    subtitle={row.place ?? undefined}
                    value={`${fmtIdr(row.priceIdr)} · ${fmtProteinPer(row.proteinPer1000)} protein`}
                  />
                ))}
              </ListGroup>
            </View>
          ) : null}
          {s.today === 0 && s.month === 0 && bestRows.length === 0 ? (
            <Text style={styles.empty}>
              Belum ada harga dicatat. Isi "Harga sepiring" saat memindai atau mencatat makanan.
            </Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** One-line variant for Beranda; renders nothing until there is something to show. */
export function BelanjaCompact() {
  const spending = useQuery(orpc.plate.spending.queryOptions());
  if (spending.isPending || spending.isError) return null;
  const s = spending.data;
  if (s.today === 0 && s.budget === null) return null;
  const parts = [`Belanja makan hari ini: ${fmtIdr(s.today)}`];
  if (s.budget?.remaining != null) {
    parts.push(
      s.budget.remaining < 0
        ? `lewat anggaran ${fmtIdr(Math.abs(s.budget.remaining))}`
        : `sisa anggaran ${fmtIdr(s.budget.remaining)}`,
    );
  }
  return (
    <Card>
      <Text style={styles.compact}>{parts.join(" · ")}</Text>
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
