import { cn } from "@joyorogo/ui/lib/utils";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ErrorNote } from "@/components/kit/error-note";
import { shoppingOptions } from "@/components/meal-plan/use-meal-plan";
import { EmptyHint } from "@/components/screen-state";
import type { MealPlanShopping, MealPlanShoppingItem } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client } from "@/utils/orpc";

type Tick = { key: string; checked: boolean };

/** The cached list with one row ticked, and the progress count that follows from it. */
function withTick(list: MealPlanShopping, tick: Tick): MealPlanShopping {
  const groups = list.groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.key === tick.key ? { ...item, checked: tick.checked } : item,
    ),
  }));
  return {
    ...list,
    groups,
    checked: groups.reduce((n, g) => n + g.items.filter((i) => i.checked).length, 0),
  };
}

function Row({ item, onTick }: { item: MealPlanShoppingItem; onTick: (checked: boolean) => void }) {
  const { t } = useTranslation("mealPlan");
  return (
    <li>
      <label className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors has-[:focus-visible]:bg-muted hover:bg-muted/60">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={(event) => onTick(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-lg border-2 border-foreground/35 text-primary-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
        >
          <Check className="size-4" strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[0.9375rem] font-semibold break-words",
              item.checked && "text-muted-foreground line-through",
            )}
          >
            {item.name}
          </span>
          {item.uses > 0 && (
            <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
              {t("shopping.inMenus", { n: fmtInt(item.uses) })}
            </span>
          )}
        </span>
        <span
          className={cn(
            "max-w-[45%] shrink-0 text-right text-sm font-semibold tabular-nums",
            item.checked && "text-muted-foreground",
          )}
        >
          {item.amount}
        </span>
      </label>
    </li>
  );
}

/** The ingredients of the meals not eaten yet, by shop section, to tick off while shopping. */
export function ShoppingView() {
  const { t } = useTranslation("mealPlan");
  const list = useQuery(shoppingOptions);
  const tick = useOptimisticMutation<Tick, Tick>({
    mutationFn: (input) => client.mealPlan.checkItem(input),
    patch: (input, cache) => {
      cache.value<MealPlanShopping>(shoppingOptions.queryKey, (old) =>
        old ? withTick(old, input) : old,
      );
    },
  });

  if (list.isPending) {
    return (
      <div aria-busy="true" className="space-y-3">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="h-14 rounded-3xl" />
        <Skeleton className="h-52 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }
  if (list.isError)
    return <ErrorNote message={t("loadError")} onRetry={() => void list.refetch()} />;

  const { groups, total, checked }: MealPlanShopping = list.data;
  const filled = groups.filter((group) => group.items.length > 0);
  return (
    <section aria-labelledby="shopping-title">
      <div className="px-1 pb-3">
        <h2 id="shopping-title" className="text-lg font-extrabold tracking-tight">
          {t("shopping.title")}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("shopping.subtitle")}</p>
      </div>

      {total === 0 ? (
        <EmptyHint title={t("shopping.empty")} />
      ) : (
        <>
          <div className="mb-4 rounded-3xl bg-card px-5 py-4">
            <p role="status" className="text-sm font-semibold tabular-nums">
              {t("shopping.progress", { done: fmtInt(checked), total: fmtInt(total) })}
            </p>
            <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${(checked / total) * 100}%` }}
              />
            </div>
          </div>

          <div className="lg:columns-2 lg:gap-5">
            {filled.map((group) => (
              <section
                key={group.cat}
                aria-labelledby={`shop-${group.cat}`}
                className="mb-4 break-inside-avoid"
              >
                <h3 id={`shop-${group.cat}`} className="px-1 pb-2 text-sm font-bold">
                  {group.label}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-card">
                  {group.items.map((item) => (
                    <Row
                      key={item.key}
                      item={item}
                      onTick={(isChecked) => tick.mutate({ key: item.key, checked: isChecked })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="px-1 text-[0.8125rem] text-muted-foreground">{t("shopping.approx")}</p>
        </>
      )}
    </section>
  );
}
