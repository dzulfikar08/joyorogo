import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { weekdayName } from "@joyorogo/api/lib/recap";
import type { WeekView } from "@joyorogo/api/routers/meal-plan";
import { fmtDateShort } from "@joyorogo/i18n";

import { PressableScale } from "@/components/motion";
import { Card, SectionTitle, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

import { DayStatuses, kcalIsOver, TargetBar } from "./day-summary";
import { Pill } from "./parts";

/** Seven days at a glance; tapping one opens it in the Today tab. */
export function WeekTab({ plan, onOpenDay }: { plan: WeekView; onOpenDay: (date: string) => void }) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const upcoming = plan.days.filter((day) => !day.isPast).length;

  return (
    <>
      <SectionTitle title={t("week.title")} />
      <Card style={styles.summary}>
        <Ionicons name={plan.daysMet > 0 ? "checkmark-circle" : "calendar"} size={22} color={theme.colors.makanText} />
        <Text style={styles.summaryText}>{t("week.met", { n: plan.daysMet, total: upcoming })}</Text>
      </Card>

      {plan.days.map((day) => {
        const label = `${weekdayName(day.date)}, ${fmtDateShort(day.date)}`;
        return (
          <PressableScale
            key={day.date}
            accessibilityRole="button"
            accessibilityLabel={`${label}${day.isToday ? `, ${t("day.today")}` : day.isPast ? `, ${t("day.past")}` : ""}`}
            onPress={() => onOpenDay(day.date)}
            scaleTo={0.99}
            dimTo={0.85}
          >
            <Card style={styles.day}>
              <View style={styles.head}>
                <View style={styles.headText}>
                  <Text style={styles.weekday}>{weekdayName(day.date)}</Text>
                  <Text style={styles.date}>{fmtDateShort(day.date)}</Text>
                </View>
                {day.isToday ? <Pill label={t("day.today")} tone="makan" /> : null}
                {day.isPast ? <Pill label={t("day.past")} /> : null}
                <Ionicons name="chevron-forward" size={18} color={theme.colors.mutedForeground} />
              </View>

              <TargetBar label={t("day.kcal")} value={day.total.kcal} target={day.targets.kcal} unit="kcal" over={kcalIsOver(day)} />
              <TargetBar label={t("day.protein")} value={day.total.proteinG} target={day.targets.proteinG} unit="g" over={false} />
              {day.isPast ? null : <DayStatuses day={day} />}

              <View style={styles.menus}>
                <Text style={styles.menusLabel}>{t("week.menus", { n: fmtInt(day.items.length) })}</Text>
                <Text style={styles.menusNames}>{day.items.map((item) => item.name).join(", ")}</Text>
              </View>
            </Card>
          </PressableScale>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.makanSoft,
  },
  summaryText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    lineHeight: 21,
    color: theme.colors.makanText,
  },
  day: {
    gap: theme.spacing.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  headText: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: theme.spacing.sm,
  },
  weekday: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  date: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  menus: {
    gap: 2,
  },
  menusLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  menusNames: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.foreground,
  },
}));
