import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { weekdayShort } from "@joyorogo/api/lib/recap";
import type { DayView, ItemView } from "@joyorogo/api/lib/meal/view";
import type { WeekView } from "@joyorogo/api/routers/meal-plan";
import { fmtDate } from "@joyorogo/i18n";

import { Disclosure } from "@/components/disclosure";
import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";

import { DaySummary } from "./day-summary";
import { ItemCard } from "./item-card";
import { Pill } from "./parts";

const CHIP_WIDTH = 56;
const CHIP_GAP = 8;

/** The seven plan days as a strip; the chosen one is filled, today carries a dot. */
function DayStrip({ plan, date, onSelect }: { plan: WeekView; date: string; onSelect: (date: string) => void }) {
  const { t } = useTranslation("mealPlan");
  const scroll = useRef<ScrollView>(null);
  const index = Math.max(0, plan.days.findIndex((day) => day.date === date));

  // A day opened from the week tab can sit past the right edge of a phone.
  useEffect(() => {
    scroll.current?.scrollTo({ x: Math.max(0, index * (CHIP_WIDTH + CHIP_GAP) - CHIP_WIDTH), animated: false });
  }, [index]);

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      accessibilityRole="tablist"
    >
      {plan.days.map((day) => {
        const selected = day.date === date;
        return (
          <PressableScale
            key={day.date}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${fmtDate(day.date, "weekday")}${day.isToday ? `, ${t("day.today")}` : day.isPast ? `, ${t("day.past")}` : ""}`}
            onPress={() => onSelect(day.date)}
            scaleTo={0.94}
            style={[styles.stripItem, selected ? styles.stripItemSelected : null]}
          >
            <Text style={[styles.stripWeekday, selected ? styles.stripTextSelected : null]}>{weekdayShort(day.date)}</Text>
            <Text style={[styles.stripDay, selected ? styles.stripTextSelected : null]}>{Number(day.date.slice(8))}</Text>
            <View style={[styles.stripDot, day.isToday ? (selected ? styles.stripDotOnSelected : styles.stripDotToday) : null]} />
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

/** The plan day for the chosen date; falls back to today, then the first day, once the plan has moved on. */
export function pickDay(plan: WeekView, date: string): DayView | undefined {
  return plan.days.find((d) => d.date === date) ?? plan.days.find((d) => d.isToday) ?? plan.days[0];
}

/** One day: totals against targets, a card per meal, and why the plan looks like this. */
export function TodayTab({
  plan,
  day,
  onSelectDate,
  onSwap,
  onBuy,
  onOpenRecipe,
  onToggleEaten,
  pendingEat,
}: {
  plan: WeekView;
  day: DayView;
  onSelectDate: (date: string) => void;
  onSwap: (date: string, item: ItemView) => void;
  onBuy: (item: ItemView) => void;
  onOpenRecipe: (item: ItemView) => void;
  onToggleEaten: (date: string, item: ItemView) => void;
  /** "date|slot" of the eat or undo call in flight. */
  pendingEat: string | null;
}) {
  const { t } = useTranslation("mealPlan");

  return (
    <>
      <DayStrip plan={plan} date={day.date} onSelect={onSelectDate} />

      <View style={styles.dayHead}>
        <Text style={styles.dayTitle}>{fmtDate(day.date, "long")}</Text>
        {day.isToday ? <Pill label={t("day.today")} tone="makan" /> : null}
        {day.isPast ? <Pill label={t("day.past")} /> : null}
      </View>

      <DaySummary day={day} />

      {day.items.length === 0 ? (
        <Text style={styles.empty}>{t("day.noMeals")}</Text>
      ) : (
        day.items.map((item) => (
          <ItemCard
            key={item.slot}
            item={item}
            onOpenRecipe={item.kind === "recipe" && item.recipeId !== null ? () => onOpenRecipe(item) : undefined}
            onSwap={!day.isPast && !item.eaten && !item.covered ? () => onSwap(day.date, item) : undefined}
            onBuy={item.mode === "buy" && !day.isPast && !item.eaten && !item.covered ? () => onBuy(item) : undefined}
            onToggleEaten={day.isToday && !item.covered ? () => onToggleEaten(day.date, item) : undefined}
            eatPending={pendingEat === `${day.date}|${item.slot}`}
          />
        ))
      )}

      {day.reasons.length > 0 ? (
        <Disclosure title={t("day.why")}>
          {day.reasons.map((reason) => (
            <Text key={reason} style={styles.reason}>
              {reason}
            </Text>
          ))}
        </Disclosure>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    gap: CHIP_GAP,
    paddingVertical: 2,
    // A wide screen spreads the seven days over the row instead of leaving a gap on the right.
    minWidth: "100%",
  },
  stripItem: {
    flexGrow: 1,
    minWidth: CHIP_WIDTH,
    minHeight: 68,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.card,
  },
  stripItemSelected: {
    backgroundColor: theme.colors.foreground,
  },
  stripWeekday: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  stripDay: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  stripTextSelected: {
    color: theme.colors.background,
  },
  stripDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  stripDotToday: {
    backgroundColor: theme.colors.primary,
  },
  stripDotOnSelected: {
    backgroundColor: theme.colors.background,
  },
  dayHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  dayTitle: {
    flexShrink: 1,
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  empty: {
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    paddingVertical: theme.spacing.lg,
    color: theme.colors.mutedForeground,
  },
  reason: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
}));
