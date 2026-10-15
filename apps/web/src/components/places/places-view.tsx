import { Button } from "@joyorogo/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Clock, Heart, Layers, Maximize2, MapPin, MapPinOff, X } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { formatDistance, sortPlaces, visitAgeLabel } from "@joyorogo/api/lib/places";
import type { PlaceSort, PlaceSummary } from "@joyorogo/api/lib/places";

import { ErrorNote } from "@/components/kit/error-note";
import { Segmented } from "@/components/kit/surface";
import { PlaceDetailSheet } from "@/components/places/place-detail";
import { PlaceThumb } from "@/components/places/place-thumb";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { EmptyHint } from "@/components/screen-state";
import { useTheme } from "@/components/theme-provider";
import { fmtRupiah } from "@/lib/app-config";
import { usePlaceLocation, useNearbyOrigin } from "@/lib/location";
import { client, orpc } from "@/utils/orpc";

// maplibre-gl is ~800 KB: only fetched when the user opens this view.
const PlacesMap = lazy(() => import("@/components/places/places-map"));

const TABS: ReadonlyArray<{ value: PlaceSort; label: string }> = [
  { value: "sering", label: "Paling sering" },
  { value: "terbaru", label: "Terbaru" },
  { value: "terdekat", label: "Terdekat" },
];

const listOptions = orpc.place.list.queryOptions();

function MapFallback() {
  return <div className="size-full animate-pulse bg-muted" aria-hidden />;
}

/**
 * "Tempat makan": plates grouped by where they were eaten, with a sticker-pin
 * map, three sort tabs, and a detail sheet per place. Places with no saved
 * location show in the list only.
 */
export function PlacesView({ onOpenDate }: { onOpenDate?: (date: string) => void }) {
  const query = useQuery(listOptions);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const origin = useNearbyOrigin();
  const saveLocation = usePlaceLocation();

  const [tab, setTab] = useState<PlaceSort>("sering");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const places = query.data?.places;
  const today = query.data?.today ?? "";
  const mapPlaces = useMemo(
    () =>
      (places ?? []).flatMap((place) =>
        place.lat != null && place.lng != null
          ? [
              {
                key: place.key,
                name: place.name,
                lat: place.lat,
                lng: place.lng,
                scanId: place.stickerScanId,
                visits: place.visits,
              },
            ]
          : [],
      ),
    [places],
  );
  const canNearby = origin != null && mapPlaces.length > 0;
  const activeTab: PlaceSort = tab === "terdekat" && !canNearby ? "sering" : tab;
  const sorted = useMemo(
    () => sortPlaces(places ?? [], activeTab, origin),
    [places, activeTab, origin],
  );
  const opened = openKey ? (sorted.find((p) => p.key === openKey) ?? sortPlaces(places ?? [], "sering", origin).find((p) => p.key === openKey)) : undefined;

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (query.isPending) return <PlacesSkeleton />;
  if (query.isError) {
    return (
      <div className="mt-5">
        <ErrorNote message="Tempat makanmu belum bisa dimuat." onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const select = (key: string) => {
    setFullscreen(false);
    setOpenKey(key);
  };

  return (
    <div className="mt-5 space-y-4">
      {(places?.length ?? 0) === 0 ? (
        <EmptyHint title="Belum ada tempat makan" pose="peek">
          Isi kolom <span className="font-semibold text-foreground">Tempat</span> saat mencatat
          piring, nanti semua warung dan restoran langgananmu muncul di sini.
        </EmptyHint>
      ) : (
        <>
          <section
            aria-label="Peta tempat makan"
            className="relative h-60 overflow-hidden rounded-3xl bg-card"
          >
            {mapPlaces.length > 0 ? (
              <>
                <Suspense fallback={<MapFallback />}>
                  <PlacesMap
                    places={mapPlaces}
                    dark={dark}
                    origin={origin}
                    onSelect={select}
                    cooperative
                  />
                </Suspense>
                <button
                  type="button"
                  onClick={() => setFullscreen(true)}
                  className="absolute top-3 right-3 z-10 inline-flex min-h-11 items-center gap-2 rounded-full bg-card px-4 text-sm font-semibold shadow-float transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <Maximize2 className="size-4" aria-hidden />
                  Perbesar peta
                </button>
              </>
            ) : (
              <div className="grid size-full place-items-center px-6 text-center">
                <div>
                  <span className="mx-auto grid size-11 place-items-center rounded-full bg-makan-soft">
                    <MapPinOff className="size-5 text-makan-ink" aria-hidden />
                  </span>
                  <p className="mt-3 text-[0.9375rem] font-bold">Belum ada lokasi tersimpan</p>
                  <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">
                    Nyalakan &ldquo;Simpan lokasi tempat makan&rdquo; di bawah, lalu catat piring
                    dengan nama tempat. Peta ini terisi dari situ.
                  </p>
                </div>
              </div>
            )}
          </section>

          <Segmented
            label="Urutkan tempat"
            value={activeTab}
            onChange={setTab}
            options={TABS.filter((t) => t.value !== "terdekat" || canNearby)}
          />

          <ul className="space-y-3">
            {sorted.map((place) => (
              <li key={place.key}>
                <PlaceCard
                  place={place}
                  today={today}
                  distanceM={place.distanceM}
                  onOpen={() => setOpenKey(place.key)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <section
        aria-label="Lokasi tempat makan"
        className="space-y-3 rounded-3xl bg-card p-4"
      >
        <SaveLocationToggle
          enabled={saveLocation.enabled}
          status={saveLocation.status}
          onChange={saveLocation.setEnabled}
        />
        <p className="px-1 text-[0.8125rem] leading-snug text-muted-foreground">
          Lokasi cuma terlihat olehmu. Tidak muncul di profil publik atau feed, dan ikut terhapus
          saat kamu menghapus data.
        </p>
        {mapPlaces.length > 0 && <ClearAllLocations />}
      </section>

      {opened && (
        <PlaceDetailSheet
          place={opened}
          today={today}
          distanceM={opened.distanceM}
          onClose={() => setOpenKey(null)}
          onOpenDate={onOpenDate}
        />
      )}

      {fullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Peta tempat makan layar penuh"
          className="fixed inset-0 z-[60] bg-background"
        >
          <Suspense fallback={<MapFallback />}>
            <PlacesMap places={mapPlaces} dark={dark} origin={origin} onSelect={select} />
          </Suspense>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <span className="pointer-events-auto rounded-full bg-card px-4 py-2.5 text-sm font-bold shadow-float">
              Tempat makan
            </span>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label="Tutup peta"
              className="pointer-events-auto grid size-11 place-items-center rounded-full bg-card shadow-float transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClearAllLocations() {
  const queryClient = useQueryClient();
  const clear = useMutation({
    mutationFn: () => client.place.clearLocation({}),
    onSuccess: () => toast.success("Semua lokasi tersimpan dihapus"),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.place.key() }),
  });
  return (
    <Button variant="outline" size="sm" disabled={clear.isPending} onClick={() => clear.mutate()}>
      <MapPinOff className="size-4" aria-hidden />
      Hapus semua lokasi tersimpan
    </Button>
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
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable flex w-full items-center gap-4 rounded-3xl bg-card p-4 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <PlaceThumb scanId={place.stickerScanId} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold tracking-tight">{place.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.8125rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Layers className="size-3.5" aria-hidden />
            {place.visits} kali
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {visitAgeLabel(place.lastDate, today)}
          </span>
          {distanceM != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <MapPin className="size-3.5" aria-hidden />
              {formatDistance(distanceM)}
            </span>
          )}
        </span>
        {place.favoriteDish && (
          <span className="mt-1 flex items-center gap-1.5 text-[0.8125rem]">
            <Heart className="size-3.5 shrink-0 text-bakar" aria-hidden />
            <span className="truncate">
              <span className="text-muted-foreground">Paling sering: </span>
              <span className="font-semibold">{place.favoriteDish}</span>
            </span>
          </span>
        )}
        {place.avgPriceIdr != null && (
          <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
            Rata-rata {fmtRupiah(place.avgPriceIdr)}
          </span>
        )}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground/70" aria-hidden />
    </button>
  );
}

function PlacesSkeleton() {
  return (
    <div className="mt-5 space-y-4" aria-busy aria-label="Memuat tempat makan">
      <div className="h-60 animate-pulse rounded-3xl bg-muted" />
      <div className="h-12 animate-pulse rounded-full bg-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-3xl bg-muted" />
      ))}
    </div>
  );
}
