import { Droplet, Minus, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";

import { useOptimisticMutation } from "@/lib/optimistic";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { client, orpc } from "@/utils/orpc";

type WaterInput = Parameters<AppRouterClient["water"]["add"]>[0];
type WaterToday = Awaited<ReturnType<AppRouterClient["water"]["today"]>>;

/** Glass count of the viewed day plus optimistic add/remove (with undo toast). */
function useWater(date?: string) {
  const { t } = useTranslation("home");
  const input: WaterInput = date === undefined ? {} : { date };
  const todayKey = orpc.water.today.queryOptions({ input }).queryKey;
  const today = useQuery(orpc.water.today.queryOptions({ input }));

  const add = useOptimisticMutation<WaterInput, unknown>({
    mutationFn: (payload) => client.water.add(payload),
    patch: (_input, cache) => {
      cache.value<WaterToday>(todayKey, (old) =>
        old ? { ...old, glasses: Math.min(old.glasses + 1, 99) } : old,
      );
    },
    invalidate: () => [orpc.water.key(), orpc.day.key()],
    success: () => ({
      message: t("water.added"),
      undo: () => void client.water.remove(input),
    }),
  });
  const remove = useOptimisticMutation<WaterInput, unknown>({
    mutationFn: (payload) => client.water.remove(payload),
    patch: (_input, cache) => {
      cache.value<WaterToday>(todayKey, (old) =>
        old ? { ...old, glasses: Math.max(old.glasses - 1, 0) } : old,
      );
    },
    invalidate: () => [orpc.water.key(), orpc.day.key()],
    success: () => ({
      message: t("water.removed"),
      undo: () => void client.water.add(input),
    }),
  });

  return {
    input,
    isPending: today.isPending,
    glasses: today.data?.glasses ?? 0,
    goal: today.data?.goal ?? 8,
    busy: add.isPending || remove.isPending,
    add: () => add.mutate(input),
    remove: () => remove.mutate(input),
  };
}

/** Glance tile for the top of Beranda: glasses so far with − / + buttons. */
export function WaterTile({ date }: { date?: string }) {
  const { t } = useTranslation("home");
  const water = useWater(date);
  return (
    <div className="rounded-2xl bg-tidur-soft p-3">
      <div className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-tidur-ink">
        <Droplet className="size-4" aria-hidden />
        {t("tile.water")}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-xl leading-tight font-extrabold tracking-tight tabular-nums" aria-live="polite">
          {water.glasses}
          <span className="ml-1 text-xs font-semibold text-muted-foreground">
            {t("water.ofGoal", { count: water.goal })}
          </span>
        </p>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t("water.less")}
            disabled={water.busy || water.glasses <= 0}
            onClick={water.remove}
            className="flex size-8 items-center justify-center rounded-full bg-card text-foreground disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("water.more")}
            disabled={water.busy}
            onClick={water.add}
            className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * "Air minum" — one tappable droplet per glass. Tapping a filled droplet
 * pours one back out, tapping an empty one fills one in.
 */
export function WaterCard({ date }: { date?: string }) {
  const { t } = useTranslation("home");
  const water = useWater(date);

  return (
    <section aria-label={t("water.title")} className="rounded-2xl bg-muted p-4">
      {water.isPending ? (
        <>
          <Skeleton className="h-5 w-32 rounded-full" />
          <Skeleton className="mt-3 h-11 w-full rounded-xl" />
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-bold">{t("water.title")}</p>
            <p className="text-sm font-bold tabular-nums" aria-live="polite">
              {water.glasses}
              <span className="ml-1 font-semibold text-muted-foreground">
                {t("water.ofGoal", { count: water.goal })}
              </span>
            </p>
          </div>
          <div
            role="group"
            aria-label={t("water.group")}
            className="mt-2 grid max-w-72 grid-cols-4 gap-1"
          >
            {Array.from({ length: water.goal }, (_, i) => i + 1).map((n) => {
              const filled = n <= water.glasses;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={filled}
                  aria-label={filled ? t("water.empty", { n }) : t("water.fill", { n })}
                  disabled={water.busy}
                  onClick={filled ? water.remove : water.add}
                  className="flex h-11 items-center justify-center rounded-xl transition-colors hover:bg-card/70 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60"
                >
                  <Droplet
                    aria-hidden
                    className={cn("size-6", filled ? "fill-makan text-makan" : "text-makan/30")}
                  />
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("water.hint")}</p>
        </>
      )}
    </section>
  );
}
