import type { Meal } from "@joyorogo/api/lib/engine";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { isPaywallError } from "@/lib/billing";
import type {
  MealPlanEatResult,
  MealPlanPrefs,
  MealPlanSwapInput,
  MealPlanSwapResult,
  MealPlanWeek,
} from "@/lib/api-types";
import { client, orpc } from "@/utils/orpc";

export const overviewOptions = orpc.mealPlan.overview.queryOptions();
export const shoppingOptions = orpc.mealPlan.shopping.queryOptions();

export type SlotRef = { date: string; slot: Meal };

/** The mutations behind the plan screen's buttons. */
export interface MealPlanActions {
  generate: UseMutationResult<MealPlanWeek, Error, boolean>;
  replanDay: UseMutationResult<MealPlanWeek, Error, string>;
  swap: UseMutationResult<MealPlanSwapResult, Error, MealPlanSwapInput>;
  eat: UseMutationResult<MealPlanEatResult, Error, SlotRef>;
  undo: UseMutationResult<MealPlanWeek, Error, SlotRef>;
  setPrefs: UseMutationResult<MealPlanPrefs, Error, MealPlanPrefs>;
}

/** The server's lock for a free account: the overview answers `locked` on the next read. */
function useExpireLock() {
  const queryClient = useQueryClient();
  return (error: Error): boolean => {
    if (!isPaywallError(error)) return false;
    void queryClient.invalidateQueries({ queryKey: overviewOptions.queryKey });
    return true;
  };
}

/**
 * Every write of the plan screen. The server answers each one with the whole
 * 7-day view, which replaces the cached plan; the shopping list is derived
 * from the plan, so it refetches after each change.
 */
export function useMealPlanActions(): MealPlanActions {
  const queryClient = useQueryClient();
  const { t } = useTranslation("mealPlan");
  const expireLock = useExpireLock();

  const putWeek = (week: MealPlanWeek) => {
    queryClient.setQueryData(overviewOptions.queryKey, (old) =>
      old?.status === "ready"
        ? { status: old.status, today: old.today, prefs: old.prefs, plan: week }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: shoppingOptions.queryKey });
  };
  const refreshDiary = () => {
    for (const key of [orpc.food.key(), orpc.day.key(), orpc.diary.key()]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
  /** Our own copy when the server has no better one; a stale plan is re-read. */
  const fail = (error: Error, message: string) => {
    if (expireLock(error)) return;
    void queryClient.invalidateQueries({ queryKey: overviewOptions.queryKey });
    toast.error(message);
  };

  const generate = useMutation({
    mutationFn: (regenerate: boolean) => client.mealPlan.generate({ regenerate }),
    onSuccess: putWeek,
    onError: (error) => fail(error, error.message),
  });

  const replanDay = useMutation({
    mutationFn: (date: string) => client.mealPlan.replanDay({ date }),
    onSuccess: putWeek,
    onError: (error) => fail(error, error.message),
  });

  const swap = useMutation({
    mutationFn: (input: Parameters<typeof client.mealPlan.swap>[0]) => client.mealPlan.swap(input),
    onSuccess: (data) => {
      putWeek(data.plan);
      if (data.replanned) toast.message(t("swap.replanned"));
    },
    onError: (error) => fail(error, error.message),
  });

  const undo = useMutation({
    mutationFn: (input: SlotRef) => client.mealPlan.undoEat(input),
    onSuccess: (week) => {
      putWeek(week);
      refreshDiary();
      toast.success(t("item.undoDone"));
    },
    onError: (error) => fail(error, error.message),
  });

  const eat = useMutation({
    mutationFn: (input: SlotRef) => client.mealPlan.eat(input),
    onSuccess: (data, input) => {
      putWeek(data.plan);
      refreshDiary();
      toast.success(t("item.ateDone"), {
        action: { label: t("item.undo"), onClick: () => undo.mutate(input) },
      });
    },
    onError: (error) => fail(error, t("item.ateFailed")),
  });

  const setPrefs = useMutation({
    mutationFn: (prefs: MealPlanPrefs) => client.mealPlan.setPrefs(prefs),
    onSuccess: (prefs) => {
      queryClient.setQueryData(overviewOptions.queryKey, (old) =>
        old?.status === "ready"
          ? { status: old.status, today: old.today, prefs, plan: old.plan }
          : old,
      );
    },
    onError: (error) => {
      expireLock(error);
    },
  });

  return { generate, replanDay, swap, eat, undo, setPrefs };
}

/** The slot a pending eat/undo/swap belongs to, so only that card shows its spinner. */
export function isSlotBusy(
  mutation: { isPending: boolean; variables: SlotRef | undefined },
  date: string,
  slot: Meal,
): boolean {
  return (
    mutation.isPending && mutation.variables?.date === date && mutation.variables.slot === slot
  );
}
