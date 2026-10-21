import { useQuery } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import { fastingElapsedFraction, fmtCountdown, MEAL_KIND_LABELS } from "@joyorogo/api/lib/fasting";
import { fmtInt, kcalUnit } from "@joyorogo/i18n";

import { Card, Num, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

/**
 * "Panduan jadwal makan" di Beranda: status puasa/jendela, hitung mundur,
 * jadwal makan dengan kcal, makan terakhir, sisa kalori, penanda catatan di
 * luar jendela, dan ringkasan mingguan. Nonaktif → tidak dirender.
 */
export function FastingScheduleCard() {
  const { theme } = useUnistyles();
  const { t } = useTranslation("home");
  const [detailOpen, setDetailOpen] = useState(false);
  const today = useQuery({
    ...orpc.fasting.today.queryOptions({ input: {} }),
    refetchInterval: 5 * 60 * 1000,
  });
  const week = useQuery(orpc.fasting.week.queryOptions());

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (today.isPending) {
    return (
      <Card>
        <View style={styles.skeleton} />
      </Card>
    );
  }
  const data = today.data;
  if (today.isError || !data?.active || !data.nextEvent) return null;

  const elapsedMin = Math.max(0, (now.getTime() - today.dataUpdatedAt) / 60_000);
  const nextAway = Math.max(0, Math.ceil(data.nextEvent.minutesAway - elapsedMin));
  const stateLabel =
    data.state === "jendela_makan"
      ? t("fasting.stateWindow", { open: data.windowOpen ?? "", close: data.windowClose ?? "" })
      : t("fasting.stateFast");
  const nextLabel =
    data.nextEvent.kind === "meal" && data.nextEvent.mealKind !== null
      ? MEAL_KIND_LABELS[data.nextEvent.mealKind]
      : data.nextEvent.kind === "close"
        ? t("fasting.next.close")
        : t("fasting.next.open");
  // Progress bar only makes sense while fasting; it tracks the current fast
  // from the last window close to the next open.
  const fastPct =
    data.state === "puasa" && data.nextEvent.kind === "open" && data.windowOpen && data.windowClose
      ? fastingElapsedFraction(data.windowOpen, data.windowClose, nextAway)
      : null;

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>{t("fasting.title")}</Text>
        <View
          style={[
            styles.chip,
            {
              backgroundColor:
                data.state === "jendela_makan" ? theme.colors.makanSoft : theme.colors.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              { color: data.state === "jendela_makan" ? theme.colors.makanText : theme.colors.foreground },
            ]}
          >
            {stateLabel}
          </Text>
        </View>
      </View>

      <Text style={styles.countdown} accessibilityLiveRegion="polite">
        <Trans
          ns="home"
          i18nKey="fasting.next.in"
          values={{ label: nextLabel, time: fmtCountdown(nextAway) }}
          components={{ b: <Num style={styles.countdownStrong} /> }}
        />
      </Text>

      {fastPct !== null ? (
        <View
          style={styles.fastTrack}
          accessibilityLabel={t("fasting.progress")}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fastPct * 100) }}
        >
          <View style={[styles.fastFill, { width: `${Math.round(fastPct * 100)}%` }]} />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("fasting.detail")}
        accessibilityState={{ expanded: detailOpen }}
        onPress={() => setDetailOpen((v) => !v)}
        style={({ pressed }) => [styles.detailRow, pressed && styles.pressed]}
      >
        <Text style={styles.detailText}>{t("fasting.detail")}</Text>
        <Ionicons
          name={detailOpen ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.colors.mutedForeground}
        />
      </Pressable>

      {detailOpen ? (
        <>
          <View style={styles.list}>
            {data.schedule.map((entry) => (
              <View
                key={`${entry.time}-${entry.kind}`}
                style={[
                  styles.row,
                  {
                    backgroundColor: entry.past ? theme.colors.background : theme.colors.card,
                    opacity: entry.past ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={styles.rowLabel} numberOfLines={1}>
                  <Num style={styles.rowTime}>{entry.time}</Num> {MEAL_KIND_LABELS[entry.kind]}
                  <Text style={styles.rowSlot}> · {MEAL_LABELS[entry.meal]}</Text>
                </Text>
                <Num style={styles.rowKcal}>
                  {entry.kcal > 0 ? t("fasting.scheduleKcal", { kcal: fmtInt(entry.kcal) }) : "0"}
                </Num>
              </View>
            ))}
          </View>

          <View style={styles.stats}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>{t("fasting.remaining")}</Text>
              <Num style={styles.statValue}>{fmtInt(data.remainingKcal)} {kcalUnit()}</Num>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>{t("fasting.lastMeal")}</Text>
              <Text style={styles.statValue}>
                {data.lastMeal
                  ? `${data.lastMeal.time} · ${MEAL_LABELS[data.lastMeal.meal]}`
                  : t("fasting.noMeal")}
              </Text>
            </View>
          </View>
        </>
      ) : null}

      {data.outsideWindowKcal > 0 ? (
        <View style={[styles.warnBox, { backgroundColor: theme.colors.bakarSoft }]}>
          <Text style={[styles.warnText, { color: theme.colors.bakarText }]}>
            {t("fasting.outside", {
              kcal: fmtInt(data.outsideWindowKcal),
              list: data.outsideWindow.map((log) => `${log.time} ${fmtInt(log.kcal)}`).join(", "),
            })}
          </Text>
        </View>
      ) : null}

      {week.data?.active ? (
        <Text style={styles.weekNote}>
          {t("fasting.week", {
            kept: week.data.keptDays,
            total: week.data.days.filter((day) => day.kept !== null).length,
          })}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  chip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  countdown: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  countdownStrong: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  fastTrack: {
    marginTop: theme.spacing.sm,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.card,
    overflow: "hidden",
  },
  fastFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: theme.colors.makan,
  },
  pressed: { opacity: 0.7 },
  detailRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  detailText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  list: {
    marginTop: theme.spacing.xs,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  rowTime: {
    fontWeight: "700",
  },
  rowSlot: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  rowKcal: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  stats: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  statValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  warnBox: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warnText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  weekNote: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  skeleton: {
    height: 96,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
  },
}));
