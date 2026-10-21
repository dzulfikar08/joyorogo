import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeDayLabel } from "@joyorogo/i18n";
import { MapPinOff, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { formatDistance, visitAgeLabel } from "@joyorogo/api/lib/places";
import type { PlaceSummary } from "@joyorogo/api/lib/places";

import { ErrorNote } from "@/components/kit/error-note";
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
  const { t } = useTranslation(["place", "makan"]);
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
      message: t("detail.loggedTo", { name, meal: MEAL_LABELS[result.meal as Meal] }),
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
    success: () => ({ message: t("toast.locationCleared") }),
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
        t("card.visits", { count: place.visits }),
        visitAgeLabel(place.lastDate, today),
        distanceM != null ? formatDistance(distanceM) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div className="space-y-5">
        {(place.avgKcal != null || place.avgProteinG != null || place.avgPriceIdr != null) && (
          <section aria-label={t("detail.averages.title")}>
            <h3 className="mb-2 text-sm font-bold">{t("detail.averages.title")}</h3>
            <dl className="grid grid-cols-2 gap-2">
              {place.avgKcal != null && (
                <div className="rounded-2xl bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">{t("detail.averages.kcal")}</dt>
                  <dd className="mt-0.5 text-2xl leading-tight font-extrabold text-kcal tabular-nums">
                    {fmtInt(place.avgKcal)}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground">
                      {t("makan:diary.summary.unit")}
                    </span>
                  </dd>
                </div>
              )}
              {place.avgProteinG != null && (
                <div className="rounded-2xl bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">{t("detail.averages.protein")}</dt>
                  <dd className="mt-0.5 text-2xl leading-tight font-extrabold tabular-nums">
                    {fmtInt(place.avgProteinG)}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground">g</span>
                  </dd>
                </div>
              )}
            </dl>
            {place.avgPriceIdr != null && (
              <p className="mt-2 px-1 text-sm text-muted-foreground">
                {t("detail.averagePerPlate", { price: fmtRupiah(place.avgPriceIdr) })}
              </p>
            )}
          </section>
        )}

        {detail.data && detail.data.dishes.length > 0 && (
          <section aria-label={t("detail.dishes.title")}>
            <h3 className="text-sm font-bold">{t("detail.dishes.title")}</h3>
            <p className="mt-0.5 mb-2 text-xs text-muted-foreground">{t("detail.dishes.hint")}</p>
            <ul className="divide-y divide-border rounded-2xl bg-muted/60 px-3">
              {detail.data.dishes.map((dish) => (
                <li key={dish.name} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold">{dish.name}</span>
                    <span className="block text-[0.8125rem] text-muted-foreground tabular-nums">
                      {dish.avgProteinG != null
                        ? t("detail.dishes.row", { kcal: fmtInt(dish.avgKcal), g: fmtInt(dish.avgProteinG) })
                        : t("detail.dishes.rowKcal", { kcal: fmtInt(dish.avgKcal) })}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">
                    {t("detail.dishes.times", { count: dish.count })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label={t("detail.historyAria")}>
          <h3 className="mb-2 text-sm font-bold">{t("detail.history")}</h3>
          {detail.isPending ? (
            <div className="space-y-2" aria-busy>
              {[0, 1].map((i) => (
                <div key={i} className="h-[4.5rem] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : detail.isError ? (
            <ErrorNote message={t("detail.historyError")} onRetry={() => void detail.refetch()} />
          ) : (
            <ul className="space-y-2">
              {detail.data?.visits.map((visit) => {
                const items = visit.itemNames.join(", ");
                return (
                  <li key={visit.id} className="space-y-2 rounded-2xl bg-muted/60 p-3">
                    <button
                      type="button"
                      disabled={!onOpenDate}
                      aria-label={t("detail.viewInLog", { name: visit.name })}
                      onClick={() => {
                        onClose();
                        onOpenDate?.(visit.date);
                      }}
                      className="flex w-full items-start gap-3 rounded-xl text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-default"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-muted-foreground">
                          {relativeDayLabel(visit.date, today)} · {MEAL_LABELS[visit.meal as Meal] ?? visit.meal}
                        </span>
                        <span className="block truncate text-[0.9375rem] font-semibold">{visit.name}</span>
                        {items !== "" && items !== visit.name && (
                          <span className="block truncate text-[0.8125rem] text-muted-foreground">
                            {items}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className="block text-base leading-tight font-extrabold text-kcal">
                          {fmtInt(visit.kcal)}
                          <span className="ml-1 text-[0.6875rem] font-semibold text-muted-foreground">
                            {t("makan:diary.summary.unit")}
                          </span>
                        </span>
                        {visit.proteinG != null && (
                          <span className="block text-xs text-muted-foreground">
                            {t("card.protein", { g: fmtInt(visit.proteinG) })}
                          </span>
                        )}
                        {visit.priceIdr != null && (
                          <span className="block text-xs text-muted-foreground">
                            {fmtRupiah(visit.priceIdr)}
                          </span>
                        )}
                      </span>
                    </button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      disabled={relog.isPending}
                      aria-label={t("detail.relogAria", { name: visit.name })}
                      onClick={() => relog.mutate({ plateId: visit.id, name: visit.name })}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      {t("detail.relog")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {detail.data && detail.data.total > detail.data.visits.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("detail.showing", { shown: detail.data.visits.length, total: detail.data.total })}
            </p>
          )}
        </section>

        {hasLocation && (
          <section aria-label={t("detail.location.aria")} className="rounded-2xl bg-muted/60 p-3">
            <p className="text-sm font-semibold">{t("detail.location.title")}</p>
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">
              {t("detail.location.body")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={clearLocation.isPending}
              onClick={() => clearLocation.mutate()}
            >
              <MapPinOff className="size-4" aria-hidden />
              {t("detail.location.clear")}
            </Button>
          </section>
        )}
      </div>
    </Sheet>
  );
}
