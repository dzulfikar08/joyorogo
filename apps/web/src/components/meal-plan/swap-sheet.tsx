import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fmtSigned } from "@/components/meal-plan/format";
import type { MealPlanActions, SlotRef } from "@/components/meal-plan/use-meal-plan";
import { MetaLine } from "@/components/meta-line";
import type { MealPlanItem } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

function Option({
  item,
  tag,
  children,
}: {
  item: MealPlanItem;
  tag?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("mealPlan");
  return (
    <li className="rounded-2xl bg-muted p-3.5">
      {tag && <p className="text-xs font-semibold text-muted-foreground">{tag}</p>}
      <p className="text-[0.9375rem] leading-snug font-bold break-words">{item.name}</p>
      {item.summary && (
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground break-words">
          {item.summary}
        </p>
      )}
      <p className="mt-1.5 text-[0.8125rem] text-muted-foreground tabular-nums">
        <MetaLine
          items={[
            item.portion,
            t("day.unitKcal", { n: fmtInt(item.nutrition.kcal) }),
            `${t("day.protein")} ${t("day.unitG", { n: fmtInt(item.nutrition.proteinG) })}`,
          ]}
        />
      </p>
      {children}
    </li>
  );
}

/** Meals with a similar kcal and protein for one slot; picking one replaces it in the plan. */
export function SwapSheet({
  target,
  actions,
  onClose,
}: {
  target: SlotRef;
  actions: MealPlanActions;
  onClose: () => void;
}) {
  const { t } = useTranslation("mealPlan");
  const options = useQuery({
    ...orpc.mealPlan.swapOptions.queryOptions({ input: target }),
    staleTime: 0,
    gcTime: 0,
  });
  const { swap } = actions;
  const current = options.data?.current;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("swap.title")}
      description={t("swap.subtitle")}
    >
      {options.isPending ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : options.isError || !current ? (
        <div role="alert" className="rounded-2xl bg-muted p-4">
          <p className="text-sm font-semibold">{options.error?.message ?? t("loadError")}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void options.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          <Option item={current} tag={t("swap.current")} />
          {options.data.alternatives.length === 0 && (
            <li className="rounded-2xl px-1 py-3 text-sm text-muted-foreground">
              {t("swap.none")}
            </li>
          )}
          {options.data.alternatives.map((alt) => {
            const picked = swap.isPending && swap.variables?.ref === alt.ref;
            return (
              <Option key={`${alt.ref}:${alt.scale}:${alt.carbScale}`} item={alt}>
                <p className="mt-1 text-[0.8125rem] font-semibold tabular-nums">
                  {t("swap.delta", {
                    kcal: fmtSigned(Math.round(alt.nutrition.kcal - current.nutrition.kcal)),
                    protein: fmtSigned(
                      Math.round(alt.nutrition.proteinG - current.nutrition.proteinG),
                    ),
                  })}
                </p>
                <Button
                  className="mt-3 h-11 w-full"
                  disabled={swap.isPending}
                  onClick={() =>
                    swap.mutate(
                      { ...target, ref: alt.ref, scale: alt.scale, carbScale: alt.carbScale },
                      { onSuccess: onClose },
                    )
                  }
                >
                  {picked && (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                  )}
                  {picked ? t("swap.working") : t("swap.pick")}
                </Button>
              </Option>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
