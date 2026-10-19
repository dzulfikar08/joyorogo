import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import {
  ChevronRight,
  Check,
  CookingPot,
  History,
  Leaf,
  LoaderCircle,
  Repeat2,
  ShoppingBag,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { fmtSigned } from "@/components/meal-plan/format";
import { TagList } from "@/components/meal-plan/tag-list";
import { MetaLine } from "@/components/meta-line";
import type { MealPlanDay, MealPlanItem } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";

const BADGE =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold [&>svg]:size-3.5 [&>svg]:shrink-0";

function MacroChip({
  letter,
  tone,
  name,
  grams,
}: {
  letter: string;
  tone: string;
  name: string;
  grams: string;
}) {
  return (
    <li
      aria-label={`${name} ${grams}`}
      className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs font-semibold tabular-nums"
    >
      <span aria-hidden className={cn("font-extrabold", tone)}>
        {letter}
      </span>
      <span aria-hidden>{grams}</span>
    </li>
  );
}

/** What a meal card can do; a card without controls (the free teaser) only shows the meal. */
export interface MealCardControls {
  /** an eat or undo for this meal is on its way */
  busy: boolean;
  onOpenRecipe: (item: MealPlanItem) => void;
  onSwap: (item: MealPlanItem) => void;
  onBuy: (item: MealPlanItem) => void;
  onEat: (item: MealPlanItem) => void;
  onUndo: (item: MealPlanItem) => void;
}

/** One planned meal: what it is and how much, its numbers, and the swap / ate actions. */
export function MealCard({
  item,
  day,
  controls,
}: {
  item: MealPlanItem;
  day: Pick<MealPlanDay, "isPast" | "isToday">;
  controls?: MealCardControls;
}) {
  const { t } = useTranslation("mealPlan");
  const { nutrition } = item;
  const canSwap = controls !== undefined && !day.isPast && !item.eaten && !item.covered;
  const canEat = controls !== undefined && day.isToday && !item.covered && !item.eaten;
  const canUndo = controls !== undefined && day.isToday && item.eaten;
  const canBuy = controls !== undefined && item.mode === "buy" && !day.isPast && !item.eaten && !item.covered;
  const grams = (n: number) => t("day.unitG", { n: fmtInt(n) });
  const habit = item.habitTimes !== null || item.kind === "habit";
  const opensRecipe = controls !== undefined && item.kind === "recipe";

  const header: ReactNode = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-semibold text-muted-foreground">
          {item.slotLabel}
        </span>
        <span className="mt-0.5 block text-[1.0625rem] leading-snug font-bold break-words">
          {item.name}
        </span>
        {item.summary && (
          <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground break-words">
            {item.summary}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-xl leading-tight font-extrabold tracking-tight tabular-nums">
          {fmtInt(nutrition.kcal)}
        </span>
        <span className="block text-xs font-semibold text-muted-foreground">kcal</span>
      </span>
      {opensRecipe && (
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  );
  const headerClass = "flex w-full items-start gap-3 rounded-2xl p-2 text-left";

  return (
    <li className="rounded-3xl bg-card p-2.5">
      {opensRecipe ? (
        <button
          type="button"
          onClick={() => controls.onOpenRecipe(item)}
          aria-label={`${item.name}, ${t("item.recipe")}`}
          className={cn(
            headerClass,
            "transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
          )}
        >
          {header}
        </button>
      ) : (
        <div className={headerClass}>{header}</div>
      )}

      <div className="space-y-2.5 px-2 pt-1 pb-1.5">
        <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
          <MetaLine
            items={[
              item.portion,
              item.minutes !== null && t("item.minutes", { min: fmtInt(item.minutes) }),
              item.cost !== null && t(`cost.${item.cost}`),
            ]}
          />
        </p>

        <ul className="flex flex-wrap gap-1.5">
          <MacroChip
            letter={t("item.proteinShort")}
            tone="text-makan-ink"
            name={t("day.protein")}
            grams={grams(nutrition.proteinG)}
          />
          <MacroChip
            letter={t("item.carbShort")}
            tone="text-bakar-ink"
            name={t("day.carbs")}
            grams={grams(nutrition.carbsG)}
          />
          <MacroChip
            letter={t("item.fatShort")}
            tone="text-tidur-ink"
            name={t("day.fat")}
            grams={grams(nutrition.fatG)}
          />
        </ul>

        <TagList tags={item.tags} />

        {(controls || item.eaten || item.covered || habit || item.lighterThan || item.avoid) && (
          <ul className="flex flex-wrap gap-1.5">
            {controls && (
              <li className={cn(BADGE, "bg-muted text-foreground")}>
                {item.mode === "buy" ? <ShoppingBag aria-hidden /> : <CookingPot aria-hidden />}
                {t(item.mode === "buy" ? "item.modeBuy" : "item.modeCook")}
              </li>
            )}
            {item.eaten && (
              <li className={cn(BADGE, "bg-makan-soft text-makan-ink")}>
                <Check aria-hidden />
                {t("item.eatenBadge")}
              </li>
            )}
            {item.covered && (
              <li className={cn(BADGE, "bg-muted text-muted-foreground")}>{t("day.swapped")}</li>
            )}
            {habit && (
              <li className={cn(BADGE, "bg-tidur-soft text-tidur-ink")}>
                <History aria-hidden />
                {item.habitTimes !== null
                  ? t("item.fromHabitTimes", { times: fmtInt(item.habitTimes) })
                  : t("item.fromHabit")}
              </li>
            )}
            {item.lighterThan && (
              <li className={cn(BADGE, "bg-makan-soft text-makan-ink")}>
                <Leaf aria-hidden />
                {t("item.lighter", { name: item.lighterThan.name })}
                {item.lighterThan.savedKcal > 0 && (
                  <span className="whitespace-nowrap tabular-nums">
                    {`(${t("day.unitKcal", { n: fmtSigned(-item.lighterThan.savedKcal) })})`}
                  </span>
                )}
              </li>
            )}
            {item.avoid && (
              <li className={cn(BADGE, "bg-bakar-soft text-bakar-ink")}>
                <TriangleAlert aria-hidden />
                {t("item.avoid")}
              </li>
            )}
          </ul>
        )}

        {item.kind === "habit" && (
          <p className="text-[0.8125rem] leading-snug text-muted-foreground">
            {item.habitTimes !== null
              ? `${t("recipe.habitHint", { times: fmtInt(item.habitTimes) })}. `
              : ""}
            {t("recipe.habitNote")}
          </p>
        )}

        {controls && canBuy && (
          <Button
            variant="secondary"
            className="h-11 w-full"
            disabled={controls.busy}
            onClick={() => controls.onBuy(item)}
          >
            <ShoppingBag aria-hidden />
            {t("item.buy")}
          </Button>
        )}

        {controls && (canSwap || canEat || canUndo) && (
          <div className="flex gap-2 pt-1">
            {canSwap && (
              <Button
                variant="outline"
                className="h-11 flex-1"
                disabled={controls.busy}
                onClick={() => controls.onSwap(item)}
              >
                <Repeat2 aria-hidden />
                {t("item.swap")}
              </Button>
            )}
            {canEat && (
              <Button
                className="h-11 flex-1"
                disabled={controls.busy}
                onClick={() => controls.onEat(item)}
              >
                {controls.busy ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <Check aria-hidden />
                )}
                {t("item.ate")}
              </Button>
            )}
            {canUndo && (
              <Button
                variant="secondary"
                className="h-11 flex-1"
                disabled={controls.busy}
                onClick={() => controls.onUndo(item)}
              >
                {controls.busy ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <Undo2 aria-hidden />
                )}
                {t("item.undo")}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
