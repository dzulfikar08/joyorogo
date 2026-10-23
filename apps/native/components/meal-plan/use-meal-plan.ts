import { useMutation } from "@tanstack/react-query";
import type { InferClientOutputs } from "@orpc/client";
import { useTranslation } from "react-i18next";

import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { WeekView } from "@joyorogo/api/routers/meal-plan";

import { useToast } from "@/components/toast";
import { errorMessage } from "@/utils/format";
import { isPaywallError, orpc, queryClient } from "@/utils/orpc";

type MealPlanOutputs = InferClientOutputs<AppRouterClient>["mealPlan"];

export type Overview = MealPlanOutputs["overview"];
export type Shopping = MealPlanOutputs["shopping"];

/** Overview as the plan screen reads it once the account is Pro and has a profile. */
export type ReadyOverview = Extract<Overview, { status: "ready" }>;

export const overviewOptions = () => orpc.mealPlan.overview.queryOptions();

/** Puts a fresh week from a mutation into the overview the screen renders from. */
function applyWeek(week: WeekView): void {
  queryClient.setQueryData<Overview>(overviewOptions().queryKey, (old) =>
    old?.status === "ready" ? { ...old, plan: week } : old,
  );
  void queryClient.invalidateQueries({ queryKey: orpc.mealPlan.shopping.key() });
}

/** Eating or undoing writes the diary: every screen that reads it refreshes. */
function refreshDiary(): void {
  void queryClient.invalidateQueries({ queryKey: orpc.food.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.plate.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.day.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.diary.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.fasting.key() });
}

/**
 * A call the server refused because the account is free: the overview refetches
 * and answers `locked`, which swaps the screen to the upsell.
 */
export function routePaywall(error: unknown): boolean {
  if (!isPaywallError(error)) return false;
  void queryClient.invalidateQueries({ queryKey: orpc.mealPlan.key() });
  return true;
}

/** Error handler for a failed call: a paywall refusal re-routes to the upsell, anything else is a toast. */
function useFailureToast() {
  const toast = useToast();
  return (title?: string) => (error: unknown) => {
    if (routePaywall(error)) return;
    if (title) toast.error(title, errorMessage(error));
    else toast.error(errorMessage(error));
  };
}

/** Every mutation of the plan screen except the shopping tick: pending state comes from the returned mutations. */
export function useMealPlanMutations() {
  const { t } = useTranslation("mealPlan");
  const toast = useToast();
  const fail = useFailureToast();

  const generate = useMutation(
    orpc.mealPlan.generate.mutationOptions({ onSuccess: applyWeek, onError: fail() }),
  );

  const replanDay = useMutation(
    orpc.mealPlan.replanDay.mutationOptions({ onSuccess: applyWeek, onError: fail() }),
  );

  const swap = useMutation(
    orpc.mealPlan.swap.mutationOptions({
      onSuccess: (result) => {
        applyWeek(result.plan);
        if (result.replanned) toast.info(t("swap.replanned"));
      },
      onError: fail(),
    }),
  );

  const eat = useMutation(
    orpc.mealPlan.eat.mutationOptions({
      onSuccess: (result) => {
        applyWeek(result.plan);
        refreshDiary();
        toast.success(t("item.ateDone"));
      },
      onError: fail(t("item.ateFailed")),
    }),
  );

  const undoEat = useMutation(
    orpc.mealPlan.undoEat.mutationOptions({
      onSuccess: (week) => {
        applyWeek(week);
        refreshDiary();
        toast.info(t("item.undoDone"));
      },
      onError: fail(),
    }),
  );

  const setPrefs = useMutation(
    orpc.mealPlan.setPrefs.mutationOptions({
      onSuccess: (prefs) => {
        queryClient.setQueryData<Overview>(overviewOptions().queryKey, (old) =>
          old?.status === "ready" ? { ...old, prefs } : old,
        );
      },
      onError: fail(),
    }),
  );

  return { generate, replanDay, swap, eat, undoEat, setPrefs };
}

/** Optimistic tick of a shopping row: it flips at once and rolls back when the server refuses. */
export function useCheckItem() {
  const fail = useFailureToast();
  return useMutation(
    orpc.mealPlan.checkItem.mutationOptions({
      onMutate: async (input) => {
        const key = orpc.mealPlan.shopping.queryOptions().queryKey;
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<Shopping>(key);
        // Without a plan the list is the empty variant: nothing to tick.
        if (previous && previous.startDate !== null) {
          let delta = 0;
          const groups = previous.groups.map((group) => ({
            ...group,
            items: group.items.map((item) => {
              if (item.key !== input.key || item.checked === input.checked) return item;
              delta += input.checked ? 1 : -1;
              return { ...item, checked: input.checked };
            }),
          }));
          queryClient.setQueryData<Shopping>(key, { ...previous, groups, checked: previous.checked + delta });
        }
        return { key, previous };
      },
      onError: (error, _input, context) => {
        if (context?.previous) queryClient.setQueryData(context.key, context.previous);
        fail()(error);
      },
    }),
  );
}
