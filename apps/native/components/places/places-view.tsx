import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { formatDistance, sortPlaces, visitAgeLabel } from "@joyorogo/api/lib/places";
import type { PlaceSort, PlaceSummary } from "@joyorogo/api/lib/places";

import { fmtIdr } from "@/utils/format";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { PlaceDetailSheet } from "@/components/places/place-detail";
import { PlaceThumb } from "@/components/places/place-thumb";
import { PlacesMap } from "@/components/places/places-map";
import type { MapPin } from "@/components/places/places-map-html";
import { stickerUrl } from "@/components/sticker";
import { useToast } from "@/components/toast";
import { Disclosure } from "@/components/disclosure";
import { Button, EmptyState, ErrorState, Segmented, Skeleton, Text } from "@/components/ui";
import { usePlaceLocation, useNearbyOrigin } from "@/src/lib/location";
import { client, orpc } from "@/utils/orpc";
import { errorMessage } from "@/utils/format";

const TAB_KEYS = [
  { value: "sering", key: "sort.frequent" },
  { value: "terbaru", key: "sort.recent" },
  { value: "terdekat", key: "sort.nearest" },
] as const satisfies ReadonlyArray<{ value: PlaceSort; key: string }>;

/**
 * "Tempat makan": plates grouped by where they were eaten, with a sticker-pin
 * map, three sort tabs, and a detail sheet per place. Places with no saved
 * location show in the list only.
 */
export function PlacesView({ onOpenDate }: { onOpenDate?: (date: string) => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("place");
  const insets = useSafeAreaInsets();
  const query = useQuery(orpc.place.list.queryOptions());
  const origin = useNearbyOrigin();
  const saveLocation = usePlaceLocation();

  const [tab, setTab] = useState<PlaceSort>("sering");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const places = query.data?.places;
  const today = query.data?.today ?? "";
  const pins = useMemo<MapPin[]>(
    () =>
      (places ?? []).flatMap((place) =>
        place.lat != null && place.lng != null
          ? [
              {
                key: place.key,
                name: place.name,
                lat: place.lat,
                lng: place.lng,
                stickerUrl: place.stickerScanId ? stickerUrl(place.stickerScanId) : null,
                visits: place.visits,
              },
            ]
          : [],
      ),
    [places],
  );
  const canNearby = origin != null && pins.length > 0;
  const activeTab: PlaceSort = tab === "terdekat" && !canNearby ? "sering" : tab;
  const sorted = useMemo(
    () => sortPlaces(places ?? [], activeTab, origin),
    [places, activeTab, origin],
  );
  const opened = openKey
    ? sortPlaces(places ?? [], "sering", origin).find((p) => p.key === openKey)
    : undefined;

  if (query.isPending) {
    return (
      <View style={styles.stack}>
        <Skeleton width="100%" height={240} />
        <Skeleton width="100%" height={44} />
        <Skeleton width="100%" height={112} />
        <Skeleton width="100%" height={112} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <ErrorState message={t("list.loadError")} onRetry={() => void query.refetch()} />
    );
  }

  const select = (key: string) => {
    if (!fullscreen) {
      setOpenKey(key);
      return;
    }
    // iOS drops a Modal presented while another is still dismissing.
    setFullscreen(false);
    setTimeout(() => setOpenKey(key), 400);
  };

  return (
    <View style={styles.stack}>
      {(places?.length ?? 0) === 0 ? (
        <EmptyState
          pose="peek"
          title={t("list.empty.title")}
          description={t("list.empty.bodyPlain")}
        />
      ) : (
        <>
          <View style={styles.mapCard} accessibilityLabel={t("map.aria")}>
            {pins.length > 0 ? (
              <>
                <PlacesMap pins={pins} origin={origin} interactive={false} onSelect={select} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("map.enlarge")}
                  onPress={() => setFullscreen(true)}
                  style={({ pressed }) => [styles.enlarge, pressed && styles.pressed]}
                >
                  <Ionicons name="expand" size={16} color={theme.colors.foreground} />
                  <Text style={styles.enlargeLabel}>{t("map.enlarge")}</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.mapEmpty}>
                <View style={styles.mapEmptyIcon}>
                  <Ionicons name="location-outline" size={22} color={theme.colors.makanText} />
                </View>
                <Text style={styles.mapEmptyTitle}>{t("map.empty.title")}</Text>
                <Text style={styles.muted}>{t("map.empty.body")}</Text>
              </View>
            )}
          </View>

          <Segmented
            options={TAB_KEYS.filter((tab) => tab.value !== "terdekat" || canNearby).map((tab) => ({
              value: tab.value,
              label: t(tab.key),
            }))}
            value={activeTab}
            onChange={setTab}
          />

          <View style={styles.cards}>
            {sorted.map((place) => (
              <PlaceCard
                key={place.key}
                place={place}
                today={today}
                distanceM={place.distanceM}
                onOpen={() => setOpenKey(place.key)}
              />
            ))}
          </View>
        </>
      )}

      <View style={styles.privacy}>
        <SaveLocationToggle
          enabled={saveLocation.enabled}
          status={saveLocation.status}
          onChange={saveLocation.setEnabled}
        />
        <Disclosure plain title={t("privacy.title")}>
          <Text style={styles.muted}>{t("privacy.note")}</Text>
        </Disclosure>
        {pins.length > 0 ? <ClearAllLocations /> : null}
      </View>

      {opened ? (
        <PlaceDetailSheet
          place={opened}
          today={today}
          distanceM={opened.distanceM}
          onClose={() => setOpenKey(null)}
          onOpenDate={onOpenDate}
        />
      ) : null}

      <Modal
        visible={fullscreen}
        animationType="slide"
        onRequestClose={() => setFullscreen(false)}
        statusBarTranslucent
        accessibilityViewIsModal
      >
        <View style={styles.full}>
          <PlacesMap pins={pins} origin={origin} interactive onSelect={select} />
          <View style={[styles.fullBar, { top: insets.top + theme.spacing.sm }]} pointerEvents="box-none">
            <View style={styles.fullTitle}>
              <Text style={styles.fullTitleText}>{t("map.fullscreenTitle")}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("map.close")}
              onPress={() => setFullscreen(false)}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={22} color={theme.colors.foreground} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ClearAllLocations() {
  const { t } = useTranslation("place");
  const queryClient = useQueryClient();
  const toast = useToast();
  const clear = useMutation({
    mutationFn: () => client.place.clearLocation({}),
    onSuccess: () => toast.success(t("toast.allCleared")),
    onError: (error: Error) => toast.error(t("toast.clearFailed"), errorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.place.key() }),
  });
  return (
    <Button
      variant="secondary"
      size="sm"
      label={t("privacy.clearAll")}
      icon="location-outline"
      disabled={clear.isPending}
      onPress={() => clear.mutate()}
      style={styles.clearAll}
    />
  );
}

function PlaceCard({
  place,
  today,
  distanceM,
  onOpen,
}: {
  place: PlaceSummary;
  today: string;
  distanceM: number | null;
  onOpen: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("place");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("card.aria", {
        name: place.name,
        visits: t("card.visits", { count: place.visits }),
      })}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <PlaceThumb scanId={place.stickerScanId} size={76} />
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {place.name}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="layers-outline" size={14} color={theme.colors.mutedForeground} />
            <Text style={styles.muted}>{t("card.visits", { count: place.visits })}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={14} color={theme.colors.mutedForeground} />
            <Text style={styles.muted}>{visitAgeLabel(place.lastDate, today)}</Text>
          </View>
          {distanceM != null ? (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={14} color={theme.colors.mutedForeground} />
              <Text style={styles.muted}>{formatDistance(distanceM)}</Text>
            </View>
          ) : null}
        </View>
        {place.favoriteDish ? (
          <View style={styles.metaItem}>
            <Ionicons name="heart" size={14} color={theme.colors.bakar} />
            <Text style={styles.favorite} numberOfLines={1}>
              <Text style={styles.muted}>{t("card.favorite")} </Text>
              {place.favoriteDish}
            </Text>
          </View>
        ) : null}
        {place.avgPriceIdr != null ? (
          <Text style={styles.muted}>{t("card.average", { price: fmtIdr(place.avgPriceIdr) })}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.spacing.md,
  },
  mapCard: {
    height: 240,
    borderRadius: theme.radius.card,
    overflow: "hidden",
    backgroundColor: theme.colors.card,
  },
  enlarge: {
    position: "absolute",
    top: theme.spacing.md,
    right: theme.spacing.md,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.card,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  enlargeLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  mapEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  mapEmptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  mapEmptyTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  cards: {
    gap: theme.spacing.md,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.card,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  cardName: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing.md,
    rowGap: 2,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  favorite: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  privacy: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.card,
  },
  clearAll: {
    alignSelf: "flex-start",
  },
  full: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  fullBar: {
    position: "absolute",
    left: theme.spacing.md,
    right: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fullTitle: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.card,
  },
  fullTitleText: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  pressed: {
    opacity: 0.7,
  },
}));
