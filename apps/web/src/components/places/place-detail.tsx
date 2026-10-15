import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, MapPinOff, RotateCcw } from "lucide-react";

import { MEAL_LABELS, relativeDayLabel } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { formatDistance, visitAgeLabel } from "@joyorogo/api/lib/places";
import type { PlaceSummary } from "@joyorogo/api/lib/places";

import { ErrorNote } from "@/components/kit/error-note";
import { PlaceThumb } from "@/components/places/place-thumb";
import { fmtRupiah } from "@/lib/app-config";
import { fmtInt } from "@/lib/format";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

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
  const queryClient = useQueryClient();
  const detail = useQuery(orpc.place.detail.queryOptions({ input: { key: place.key } }));

  const relog = useOptimisticMutation<
    { plateId: string; name: string },
    { items: Array<{ id: string }>; meal: string }
  >({
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
          () => {
            for (const key of [
              orpc.place.key(),
              orpc.food.key(),
              orpc.plate.key(),
              orpc.day.key(),
              orpc.diary.key(),
            ]) {
              void queryClient.invalidateQueries({ queryKey: key });
            }
          },
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

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={place.name}
      description={[
        `${place.visits} kali`,
        visitAgeLabel(place.lastDate, today),
        distanceM != null ? formatDistance(distanceM) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div className="space-y-5">
        {(place.favoriteDish || place.avgPriceIdr != null) && (
          <div className="flex items-center gap-4 rounded-2xl bg-muted/60 p-3">
            <PlaceThumb scanId={place.stickerScanId} className="size-16" />
            <div className="min-w-0 text-sm">
              {place.favoriteDish && (
                <p className="font-semibold">
                  <span className="font-normal text-muted-foreground">Paling sering: </span>
                  {place.favoriteDish}
                </p>
              )}
              {place.avgPriceIdr != null && (
                <p className="mt-0.5 text-muted-foreground">
                  Rata-rata {fmtRupiah(place.avgPriceIdr)} per piring
                </p>
              )}
            </div>
          </div>
        )}

        <section aria-label="Riwayat kunjungan">
          <h3 className="mb-2 text-sm font-bold">Riwayat</h3>
          {detail.isPending ? (
            <div className="space-y-2" aria-busy>
              {[0, 1].map((i) => (
                <div key={i} className="h-[4.5rem] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : detail.isError ? (
            <ErrorNote message="Riwayat tempat ini belum bisa dimuat." onRetry={() => void detail.refetch()} />
          ) : (
            <ul className="space-y-2">
              {detail.data?.visits.map((visit) => (
                <li key={visit.id} className="space-y-2.5 rounded-2xl bg-muted/60 p-3">
                  <button
                    type="button"
                    disabled={!onOpenDate}
                    onClick={() => {
                      onClose();
                      onOpenDate?.(visit.date);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-default"
                  >
                    <PlaceThumb scanId={visit.stickerScanId} className="size-14" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-semibold">{visit.name}</span>
                      <span className="block truncate text-[0.8125rem] text-muted-foreground">
                        {relativeDayLabel(visit.date, today)} · {MEAL_LABELS[visit.meal as Meal] ?? visit.meal}
                      </span>
                      <span className="mt-0.5 flex items-center gap-3 text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Flame className="size-3.5 text-kcal" aria-hidden />
                          {fmtInt(visit.kcal)} kkal
                        </span>
                        {visit.priceIdr != null && <span>{fmtRupiah(visit.priceIdr)}</span>}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    disabled={relog.isPending}
                    aria-label={`Makan lagi ${visit.name}`}
                    onClick={() => relog.mutate({ plateId: visit.id, name: visit.name })}
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Makan lagi
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {detail.data && detail.data.total > detail.data.visits.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Menampilkan {detail.data.visits.length} kunjungan terbaru dari {detail.data.total}.
            </p>
          )}
        </section>

        {hasLocation && (
          <section aria-label="Lokasi" className="rounded-2xl bg-muted/60 p-3">
            <p className="text-sm font-semibold">Lokasi tersimpan</p>
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">
              Sekitar 100 m saja, cuma kamu yang lihat. Menghapusnya tidak mengubah catatan makanmu.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={clearLocation.isPending}
              onClick={() => clearLocation.mutate()}
            >
              <MapPinOff className="size-4" aria-hidden />
              Hapus lokasi tempat ini
            </Button>
          </section>
        )}
      </div>
    </Sheet>
  );
}
