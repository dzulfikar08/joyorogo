import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { recentDayLabel } from "@joyorogo/api/lib/format";
import { formatDistance, visitAgeLabel } from "@joyorogo/api/lib/places";
import type { PlaceSummary } from "@joyorogo/api/lib/places";

import { fmtIdr } from "@/components/plate/belanja";
import { PlaceThumb } from "@/components/places/place-thumb";
import { StickerHero } from "@/components/sticker";
import { Button, ErrorState, Num, Sheet, Skeleton, Text } from "@/components/ui";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";
import { fmtKcal } from "@/utils/format";

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
      message: `${name} dicatat ke ${MEAL_LABELS[result.meal as Meal]}`,
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
    success: () => ({ message: "Lokasi tempat ini dihapus" }),
  });

  const hasLocation = place.lat != null && place.lng != null;
  const subtitle = [
    `${place.visits} kali`,
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
                <Text style={styles.favoriteLabel}>Paling sering: </Text>
                {place.favoriteDish}
              </Text>
            ) : null}
            {place.avgPriceIdr != null ? (
              <Text style={styles.muted}>Rata-rata {fmtIdr(place.avgPriceIdr)} per piring</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <Text style={styles.heading}>Riwayat</Text>
      {detail.isPending ? (
        <View style={styles.list}>
          <Skeleton width="100%" height={72} />
          <Skeleton width="100%" height={72} />
        </View>
      ) : detail.isError ? (
        <ErrorState message="Riwayat tempat ini belum bisa dimuat." onRetry={() => void detail.refetch()} />
      ) : (
        <View style={styles.list}>
          {detail.data?.visits.map((visit) => (
            <View key={visit.id} style={styles.visit}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Lihat ${visit.name} di diari`}
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
                    <Num style={styles.muted}>{fmtKcal(visit.kcal)} kkal</Num>
                    {visit.priceIdr != null ? (
                      <Text style={styles.muted}>{fmtIdr(visit.priceIdr)}</Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
              <Button
                variant="secondary"
                size="sm"
                label="Makan lagi"
                icon="refresh"
                disabled={relog.isPending}
                onPress={() => relog.mutate({ plateId: visit.id, name: visit.name })}
              />
            </View>
          ))}
          {detail.data && detail.data.total > detail.data.visits.length ? (
            <Text style={styles.muted}>
              Menampilkan {detail.data.visits.length} kunjungan terbaru dari {detail.data.total}.
            </Text>
          ) : null}
        </View>
      )}

      {hasLocation ? (
        <View style={styles.location}>
          <Text style={styles.favorite}>Lokasi tersimpan</Text>
          <Text style={styles.muted}>
            Sekitar 100 m saja, cuma kamu yang lihat. Menghapusnya tidak mengubah catatan makanmu.
          </Text>
          <Button
            variant="secondary"
            size="sm"
            label="Hapus lokasi tempat ini"
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
