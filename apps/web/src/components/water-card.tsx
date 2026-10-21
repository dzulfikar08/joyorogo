import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { ProgressBar } from "@/components/progress-bar";
import { useOptimisticMutation } from "@/lib/optimistic";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { client, orpc } from "@/utils/orpc";

type WaterInput = Parameters<AppRouterClient["water"]["add"]>[0];
type WaterToday = Awaited<ReturnType<AppRouterClient["water"]["today"]>>;

/** Glass count of the viewed day plus optimistic add/remove (with undo toast). */
export function useWater(date?: string) {
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

/** The day's glass counter on the water screen: count, goal, progress and -/+. No title or hint of its own: the page title names it. */
export function WaterCard({ date }: { date?: string }) {
  const { t } = useTranslation("home");
  const water = useWater(date);
  const label = t("tile.waterValue", { count: water.glasses, goal: water.goal });
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <p
          aria-live="polite"
          className="min-w-0 flex-1 text-4xl leading-none font-extrabold tracking-tighter tabular-nums"
        >
          {water.glasses}
          <span className="ml-1.5 text-base font-bold tracking-normal text-muted-foreground">
            {t("water.ofGoal", { count: water.goal })}
          </span>
        </p>
        <Button
          variant="secondary"
          size="icon-lg"
          aria-label={t("water.less")}
          disabled={water.busy || water.glasses <= 0}
          onClick={water.remove}
        >
          <Minus className="size-5" aria-hidden />
        </Button>
        <Button size="icon-lg" aria-label={t("water.more")} disabled={water.busy} onClick={water.add}>
          <Plus className="size-5" aria-hidden />
        </Button>
      </div>
      <ProgressBar value={water.glasses} max={water.goal} ariaLabel={label} className="mt-4 h-2" />
    </Card>
  );
}
