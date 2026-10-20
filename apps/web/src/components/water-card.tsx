import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

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
