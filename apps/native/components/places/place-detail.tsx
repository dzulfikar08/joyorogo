import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { recentDayLabel } from "@joyorogo/api/lib/format";
import { formatDistance, visitAgeLabel } from "@joyorogo/api/lib/places";
import type { PlaceSummary } from "@joyorogo/api/lib/places";

import { fmtGramsLabel, fmtIdr, fmtInt } from "@/utils/format";
import { Button, ErrorState, Num, Sheet, Skeleton, Text } from "@/components/ui";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type RelogResult = { items: Array<{ id: string }>; meal: string };

/**
 * One place: how often, what you usually get, the visit history, and a
 * one-tap "Makan lagi" that copies a past plate into today.
 */
export function PlaceDetailSheet({
  place,
  today,
  distanceM,
  onClose,
  onOpenDate,
}: {
  place: PlaceSummary;
  today: string;
  distanceM: number | null;
  onClose: () => void;
  onOpenDate?: (date: string) => void;
}) {
  const { t } = useTranslation(["place", "makan"]);
  const queryClient = useQueryClient();
  const detail = useQuery(orpc.place.detail.queryOptions({ input: { key: place.key } }));

  const refresh = () => {
    for (const key of [
      orpc.place.key(),
      orpc.food.key(),
      orpc.plate.key(),
      orpc.day.key(),
      orpc.diary.key(),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const relog = useOptimisticMutation<{ plateId: string; name: string }, RelogResult>({
    mutationFn: ({ plateId }) => client.place.relog({ plateId }),
    invalidate: () => [
      orpc.place.key(),
      orpc.food.key(),
      orpc.plate.key(),
      orpc.day.key(),
      orpc.diary.key(),
    ],
    success: ({ name }, result) => ({
      message: t("detail.loggedTo", { name, meal: MEAL_LABELS[result.meal as Meal] }),
      undo: () => {
        void Promise.all(result.items.map((row) => client.food.remove({ id: row.id }))).finally(
          refresh,
        );
      },
    }),
  });

  const clearLocation = useOptimisticMutation<void, { cleared: number }>({
    mutationFn: () => client.place.clearLocation({ key: place.key }),
    invalidate: () => [orpc.place.key()],
    success: () => ({ message: t("toast.locationCleared") }),
  });

  const hasLocation = place.lat != null && place.lng != null;
  const subtitle = [
    t("card.visits", { count: place.visits }),
    visitAgeLabel(place.lastDate, today),
    distanceM != null ? formatDistance(distanceM) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet visible onClose={onClose} title={place.name}>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {place.avgKcal != null || place.avgProteinG != null || place.avgPriceIdr != null ? (
        <View style={styles.averages}>
          {place.avgKcal != null || place.avgProteinG != null ? (
            <>
              <Text style={styles.heading}>{t("detail.averages.title")}</Text>
              <View style={styles.averageRow}>
                {place.avgKcal != null ? (
                  <View style={styles.averageCell}>
                    <Text style={styles.averageLabel}>{t("detail.averages.kcal")}</Text>
                    <Num style={styles.averageValue}>
                      {fmtInt(place.avgKcal)} {t("makan:diary.summary.unit")}
                    </Num>
                  </View>
                ) : null}
                {place.avgProteinG != null ? (
                  <View style={styles.averageCell}>
                    <Text style={styles.averageLabel}>{t("detail.averages.protein")}</Text>
                    <Num style={styles.averageValue}>{fmtGramsLabel(place.avgProteinG)}</Num>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
          {place.avgPriceIdr != null ? (
            <Text style={styles.muted}>
              {t("detail.averagePerPlate", { price: fmtIdr(place.avgPriceIdr) })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {detail.data && detail.data.dishes.length > 0 ? (
        <>
          <Text style={styles.heading}>{t("detail.dishes.title")}</Text>
          <Text style={styles.muted}>{t("detail.dishes.hint")}</Text>
          <View style={styles.list}>
            {detail.data.dishes.map((dish) => (
              <View key={dish.name} style={styles.dish}>
                <Text style={styles.dishName} numberOfLines={2}>
                  {dish.name}
                </Text>
                <View style={styles.dishNumbers}>
                  <Num style={styles.visitKcal}>
                    {dish.avgProteinG != null
                      ? t("detail.dishes.row", {
                          kcal: fmtInt(dish.avgKcal),
                          g: fmtInt(dish.avgProteinG),
                        })
                      : t("detail.dishes.rowKcal", { kcal: fmtInt(dish.avgKcal) })}
                  </Num>
                  <Text style={styles.muted}>{t("detail.dishes.times", { count: dish.count })}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.heading}>{t("detail.history")}</Text>
      {detail.isPending ? (
        <View style={styles.list}>
          <Skeleton width="100%" height={72} />
          <Skeleton width="100%" height={72} />
        </View>
      ) : detail.isError ? (
        <ErrorState message={t("detail.historyError")} onRetry={() => void detail.refetch()} />
      ) : (
        <View style={styles.list}>
          {detail.data?.visits.map((visit) => (
            <View key={visit.id} style={styles.visit}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("detail.viewInLog", { name: visit.name })}
                disabled={!onOpenDate}
                onPress={() => {
                  onClose();
                  onOpenDate?.(visit.date);
                }}
                style={({ pressed }) => [styles.visitMain, pressed && styles.pressed]}
              >
                <View style={styles.visitTop}>
                  <Text style={styles.visitName} numberOfLines={1}>
                    {visit.name}
                  </Text>
                  <Num style={styles.visitKcal}>
                    {visit.proteinG != null
                      ? t("detail.dishes.row", { kcal: fmtInt(visit.kcal), g: fmtInt(visit.proteinG) })
                      : t("detail.dishes.rowKcal", { kcal: fmtInt(visit.kcal) })}
                  </Num>
                </View>
                <Text style={styles.muted} numberOfLines={1}>
                  {recentDayLabel(visit.date, today)} ·{" "}
                  {MEAL_LABELS[visit.meal as Meal] ?? visit.meal}
                  {visit.priceIdr != null ? ` · ${fmtIdr(visit.priceIdr)}` : ""}
                </Text>
                {visit.itemNames.length > 0 ? (
                  <Text style={styles.muted} numberOfLines={1}>
                    {visit.itemNames.join(", ")}
                  </Text>
                ) : null}
              </Pressable>
              <Button
                variant="secondary"
                size="sm"
                label={t("detail.relog")}
                icon="refresh"
                disabled={relog.isPending}
                onPress={() => relog.mutate({ plateId: visit.id, name: visit.name })}
                style={styles.visitRelog}
              />
            </View>
          ))}
          {detail.data && detail.data.total > detail.data.visits.length ? (
            <Text style={styles.muted}>
              {t("detail.showing", { shown: detail.data.visits.length, total: detail.data.total })}
            </Text>
          ) : null}
        </View>
      )}

      {hasLocation ? (
        <View style={styles.location}>
          <Text style={styles.favorite}>{t("detail.location.title")}</Text>
          <Text style={styles.muted}>{t("detail.location.body")}</Text>
          <Button
            variant="secondary"
            size="sm"
            label={t("detail.location.clear")}
            icon="location-outline"
            disabled={clearLocation.isPending}
            onPress={() => clearLocation.mutate()}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
  },
  averages: {
    gap: theme.spacing.sm,
  },
  averageRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  averageCell: {
    flex: 1,
    gap: 2,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
  },
  averageLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.makanText,
  },
  averageValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.kcalText,
  },
  favorite: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  heading: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.xs,
  },
  list: {
    gap: theme.spacing.sm,
  },
  dish: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  dishName: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  dishNumbers: {
    alignItems: "flex-end",
  },
  visit: {
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
  },
  visitMain: {
    gap: 2,
  },
  visitTop: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  visitName: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  visitKcal: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.kcalText,
  },
  visitRelog: {
    alignSelf: "flex-start",
  },
  location: {
    gap: theme.spacing.sm,
    alignItems: "flex-start",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
}));
