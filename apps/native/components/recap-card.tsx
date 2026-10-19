import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { weekRangeLabel, weekStartOf } from "@joyorogo/api/lib/recap";

import { Card, Num, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * "Rekap minggu ini" on Beranda: only on Monday (WIB), summarizing the week
 * that just ended. The full recap lives at /rekap and stays reachable from Lainnya.
 */
export function RecapCard() {
  const { theme } = useUnistyles();
  const { t } = useTranslation("home");
  const today = jakartaToday();
  const isMonday = weekStartOf(today) === today;
  const weekStart = shiftDate(today, -7);
  const recap = useQuery({
    ...orpc.stats.weekRecap.queryOptions({ input: { weekStart } }),
    enabled: isMonday,
  });
  // Same cached query as the recap screen; the card only reads it and never asks for AI text.
  const reflection = useQuery({
    ...orpc.stats.weekReflection.queryOptions({ input: { weekStart } }),
    enabled: isMonday,
  });
  const teaser = reflection.data?.focus[0]?.title ?? reflection.data?.wins[0]?.title ?? null;
  const data = recap.data;
  if (!isMonday || !data || data.avgKcal === null) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("recap.open", { range: weekRangeLabel(weekStart) })}
      onPress={() => router.push({ pathname: "/rekap", params: { week: weekStart } })}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <View style={styles.chip}>
            <Ionicons name="calendar" size={20} color={theme.colors.primary} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.title}>{t("recap.title")}</Text>
            <Text style={styles.caption}>{t("recap.lastWeek", { range: weekRangeLabel(weekStart) })}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.mutedForeground} />
        </View>
        <View style={styles.row}>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>{t("recap.average")}</Text>
            <Num style={styles.cellValue}>
              {fmtInt(data.avgKcal)} <Text style={styles.cellUnit}>kcal</Text>
            </Num>
            <Text style={styles.cellSub}>{t("recap.target", { kcal: fmtInt(data.targetKcal) })}</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>{t("recap.onTarget")}</Text>
            <Num style={styles.cellValue}>
              {data.daysOnTarget}{" "}
              <Text style={styles.cellUnit}>{t("recap.daysUnit", { count: data.daysOnTarget })}</Text>
            </Num>
            <Text style={styles.cellSub}>{t("recap.logged", { count: data.loggedDays })}</Text>
          </View>
        </View>
        {teaser ? (
          <View style={styles.teaser}>
            <Ionicons
              name={reflection.data?.focus.length ? "flag" : "checkmark-circle"}
              size={16}
              color={theme.colors.mutedForeground}
              style={styles.teaserIcon}
            />
            <Text style={styles.teaserText}>{teaser}</Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  card: { gap: theme.spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  chip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  caption: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  row: { flexDirection: "row", gap: theme.spacing.md },
  cell: {
    flex: 1,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  cellLabel: { fontSize: theme.fontSize.xs, fontWeight: "600", color: theme.colors.mutedForeground },
  cellValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
    marginTop: 2,
  },
  cellUnit: { fontSize: theme.fontSize.sm, fontWeight: "600", color: theme.colors.mutedForeground },
  cellSub: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  teaser: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  teaserIcon: { marginTop: 1 },
  teaserText: { flex: 1, fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
}));
