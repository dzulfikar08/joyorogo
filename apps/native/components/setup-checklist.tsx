import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { HEALTH_BRAND } from "@/components/brand-mark";
import { PressableScale } from "@/components/motion";
import { Card, Text } from "@/components/ui";
import {
  setupChecklist,
  type SetupChecklist as SetupChecklistData,
  type SetupStepId,
} from "@/src/lib/setup-checklist";
import { useSetupChecklistDismissed } from "@/src/lib/setup-checklist-store";
import { hasActivitySource } from "@/src/lib/sources";
import { useSources } from "@/src/lib/use-sources";
import { orpc } from "@/utils/orpc";

/**
 * What the Beranda card asks of a new account, detected from what the app can see (nothing is ticked by hand): a first
 * meal, a second weigh-in on another day (the trend line needs two), an activity source. `enabled` keeps every request
 * off until Beranda has loaded today's figures. `list` is null while a step is still being detected, once everything is
 * done and once the person closed the card (`settled` tells the last two from the first); `dismiss` hides it for good
 * on this phone.
 */
export function useSetupChecklist({
  userId,
  accountCreatedAt,
  enabled,
  eatenToday,
}: {
  userId: string | null;
  /** when the account was made: old accounts that already log and weigh in do not get the card */
  accountCreatedAt: Date | string | null;
  enabled: boolean;
  /** something is logged today */
  eatenToday: boolean;
}) {
  const { dismissed, dismiss } = useSetupChecklistDismissed(userId);
  const watching = enabled && dismissed === false;
  const foods = useQuery({ ...orpc.food.recent.queryOptions(), enabled: watching });
  const weights = useQuery({
    ...orpc.weight.history.queryOptions({ input: { limit: 2 } }),
    enabled: watching,
  });
  const sources = useSources({ enabled: watching, weights: false });
  const state = {
    meal: eatenToday ? true : foods.data ? foods.data.items.length > 0 : null,
    weigh: weights.data ? weights.data.entries.length >= 2 : null,
    source: sources.rows ? hasActivitySource(sources.rows) : null,
  };
  const accountAgeDays =
    accountCreatedAt === null ? null : (Date.now() - new Date(accountCreatedAt).getTime()) / 86_400_000;
  const list = setupChecklist(state, enabled ? dismissed : null, accountAgeDays);
  // Whether the card's fate is known (closed, or every step detected): other hints wait for it so nothing flashes.
  const settled =
    enabled &&
    (dismissed === true || (dismissed === false && Object.values(state).every((v) => v !== null)));
  return { list, settled, dismiss };
}

/**
 * The checklist card. Finished rows sink, a row is one tap away from its step, and the close button hides the card. It
 * stands in for the first-log hints: while it is up, the first-meal row carries the "Catat" the calorie ring would
 * otherwise offer.
 */
export function SetupChecklist({
  list,
  dismiss,
  weighedToday,
  onWeigh,
}: {
  list: SetupChecklistData;
  dismiss: () => void;
  /** a weigh-in exists for today (one per day, so weighing again today adds no second point) */
  weighedToday: boolean;
  onWeigh: () => void;
}) {
  const { t } = useTranslation("home");
  const { theme } = useUnistyles();
  const ios = HEALTH_BRAND === "appleHealth";
  const copy: Record<
    SetupStepId,
    { title: string; sub?: string; done: string; onPress: (() => void) | null }
  > = {
    meal: {
      title: t("setup.meal.title"),
      sub: t("setup.meal.sub"),
      done: t("setup.meal.done"),
      onPress: () => router.navigate("/makan"),
    },
    weigh: {
      title: t("setup.weigh.title"),
      sub: weighedToday ? t("setup.weigh.subToday") : t("setup.weigh.sub"),
      done: t("setup.weigh.done"),
      // One entry a day: weighing again today only overwrites, so the row asks for tomorrow instead of offering the sheet.
      onPress: weighedToday ? null : onWeigh,
    },
    source: {
      title: t("setup.source.title"),
      sub: t(ios ? "setup.source.subIos" : "setup.source.subAndroid"),
      done: t("setup.source.done"),
      onPress: () => router.navigate("/sumber"),
    },
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          {t("setup.title")}
        </Text>
        <View
          style={styles.counter}
          accessible
          accessibilityLabel={t("setup.countLabel", { done: list.doneCount, total: list.total })}
        >
          <Text style={styles.counterText}>
            {t("setup.count", { done: list.doneCount, total: list.total })}
          </Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("setup.dismiss")}
          onPress={dismiss}
          hitSlop={4}
          scaleTo={0.92}
          style={styles.close}
        >
          <Ionicons name="close" size={20} color={theme.colors.mutedForeground} />
        </PressableScale>
      </View>
      <View>
        {list.rows.map((row, index) => {
          const step = copy[row.id];
          const body = (
            <>
              <View style={[styles.box, row.done && styles.boxDone]}>
                {row.done ? (
                  <Ionicons name="checkmark" size={16} color={theme.colors.primaryForeground} />
                ) : null}
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, row.done && styles.rowTitleDone]} numberOfLines={2}>
                  {row.done ? step.done : step.title}
                </Text>
                {!row.done && step.sub ? <Text style={styles.rowSub}>{step.sub}</Text> : null}
              </View>
              {!row.done && step.onPress ? (
                <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
              ) : null}
            </>
          );
          const rowStyle = [styles.row, index > 0 && styles.rowDivider];
          return !row.done && step.onPress ? (
            <PressableScale
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`${step.title}. ${step.sub ?? ""}`}
              onPress={step.onPress}
              scaleTo={0.99}
              dimTo={0.8}
              style={rowStyle}
            >
              {body}
            </PressableScale>
          ) : (
            <View
              key={row.id}
              style={rowStyle}
              accessible
              accessibilityLabel={row.done ? step.done : `${step.title}. ${step.sub ?? ""}`}
            >
              {body}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  title: {
    flex: 1,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  counter: {
    minWidth: 40,
    height: 28,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  counterText: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.makanText },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 56,
    paddingVertical: theme.spacing.sm,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.hairline },
  box: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  boxDone: { backgroundColor: theme.colors.makan, borderColor: theme.colors.makan },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  rowTitleDone: { fontWeight: "600", color: theme.colors.mutedForeground },
  rowSub: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
}));
