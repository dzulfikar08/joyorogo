import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { recentDayLabel } from "@joyorogo/api/lib/format";
import { formatDistance, visitAgeLabel } from "@joyorogo/api/lib/places";
import type { PlaceSummary } from "@joyorogo/api/lib/places";

import { fmtIdr } from "@/utils/format";
import { PlaceThumb } from "@/components/places/place-thumb";
import { StickerHero } from "@/components/sticker";
import { Button, ErrorState, Num, Sheet, Skeleton, Text } from "@/components/ui";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";
import { fmtKcalLabel } from "@/utils/format";

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
  const { theme } = useUnistyles();
  const { t } = useTranslation("place");
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

      <StickerHero scanId={place.stickerScanId} name={place.favoriteDish ?? place.name} />
      {place.favoriteDish || place.avgPriceIdr != null ? (
        <View style={styles.summary}>
          <View style={styles.summaryText}>
            {place.favoriteDish ? (
              <Text style={styles.favorite} numberOfLines={2}>
                <Text style={styles.favoriteLabel}>{t("card.favorite")} </Text>
                {place.favoriteDish}
              </Text>
            ) : null}
            {place.avgPriceIdr != null ? (
              <Text style={styles.muted}>
                {t("detail.averagePerPlate", { price: fmtIdr(place.avgPriceIdr) })}
              </Text>
            ) : null}
          </View>
        </View>
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
                accessibilityLabel={t("detail.viewInDiary", { name: visit.name })}
                disabled={!onOpenDate}
                onPress={() => {
                  onClose();
                  onOpenDate?.(visit.date);
                }}
                style={({ pressed }) => [styles.visitMain, pressed && styles.pressed]}
              >
                <PlaceThumb scanId={visit.stickerScanId} size={56} />
                <View style={styles.visitText}>
                  <Text style={styles.visitName} numberOfLines={1}>
                    {visit.name}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {recentDayLabel(visit.date, today)} · {MEAL_LABELS[visit.meal as Meal] ?? visit.meal}
                  </Text>
                  <View style={styles.visitMeta}>
                    <Ionicons name="flame" size={13} color={theme.colors.kcalText} />
                    <Num style={styles.muted}>{fmtKcalLabel(visit.kcal)}</Num>
                    {visit.priceIdr != null ? (
                      <Text style={styles.muted}>{fmtIdr(visit.priceIdr)}</Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
              <Button
                variant="secondary"
                size="sm"
                label={t("detail.relog")}
                icon="refresh"
                disabled={relog.isPending}
                onPress={() => relog.mutate({ plateId: visit.id, name: visit.name })}
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
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
  },
  summaryText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  favorite: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  favoriteLabel: {
    fontWeight: "500",
    color: theme.colors.mutedForeground,
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
  visit: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.sm,
  },
  visitMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  visitText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  visitName: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  visitMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
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
