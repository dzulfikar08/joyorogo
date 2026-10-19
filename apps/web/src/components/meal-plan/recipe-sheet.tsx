import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TagList } from "@/components/meal-plan/tag-list";
import { MetaLine } from "@/components/meta-line";
import type { MealPlanItem, MealPlanRecipe } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

function Nutrition({ recipe }: { recipe: MealPlanRecipe }) {
  const { t } = useTranslation("mealPlan");
  const { nutrition } = recipe;
  const rows = [
    [t("day.kcal"), t("day.unitKcal", { n: fmtInt(nutrition.kcal) })],
    [t("day.protein"), t("day.unitG", { n: fmtInt(nutrition.proteinG) })],
    [t("day.carbs"), t("day.unitG", { n: fmtInt(nutrition.carbsG) })],
    [t("day.fat"), t("day.unitG", { n: fmtInt(nutrition.fatG) })],
    [t("web.fiber"), t("day.unitG", { n: fmtInt(nutrition.fiberG) })],
  ];
  return (
    <section aria-labelledby="recipe-nutrition">
      <h3 id="recipe-nutrition" className="text-sm font-bold">
        {t("recipe.nutrition")}
      </h3>
      <dl className="mt-1 divide-y divide-border rounded-2xl bg-muted px-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RecipeBody({ recipe }: { recipe: MealPlanRecipe }) {
  const { t } = useTranslation("mealPlan");
  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <p className="text-sm text-muted-foreground tabular-nums">
          <MetaLine
            items={[
              `${t("recipe.portion")} ${recipe.portion}`,
              t("item.minutes", { min: fmtInt(recipe.minutes) }),
              t(`cost.${recipe.cost}`),
            ]}
          />
        </p>
        <TagList tags={recipe.tags} />
        <p className="flex items-start gap-2 text-sm font-semibold">
          {recipe.allergens.length > 0 ? (
            <>
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bakar-ink" aria-hidden />
              <span>
                {t("recipe.allergens")}:{" "}
                {recipe.allergens.map((a) => t(`allergen.${a}`)).join(", ")}
              </span>
            </>
          ) : (
            <>
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-makan-ink" aria-hidden />
              <span>{t("recipe.noAllergens")}</span>
            </>
          )}
        </p>
      </div>

      <Nutrition recipe={recipe} />

      <section aria-labelledby="recipe-ingredients">
        <h3 id="recipe-ingredients" className="text-sm font-bold">
          {t("recipe.ingredients")}
        </h3>
        <ul className="mt-1 divide-y divide-border">
          {recipe.ingredients.map((ingredient) => (
            <li
              key={ingredient.key}
              className="flex items-baseline justify-between gap-4 py-2.5 text-sm"
            >
              <span className="min-w-0 break-words">{ingredient.name}</span>
              <span className="max-w-[55%] shrink-0 text-right font-semibold tabular-nums">
                {ingredient.amount}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="recipe-steps">
        <h3 id="recipe-steps" className="text-sm font-bold">
          {t("recipe.steps")}
        </h3>
        <ol className="mt-2 space-y-3">
          {recipe.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed">
              <span
                aria-hidden
                className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-makan-soft text-xs font-bold text-makan-ink tabular-nums"
              >
                {index + 1}
              </span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {recipe.tip && (
        <section className="rounded-2xl bg-makan-soft p-4">
          <h3 className="text-sm font-bold text-makan-ink">{t("recipe.tip")}</h3>
          <p className="mt-1 text-sm leading-relaxed">{recipe.tip}</p>
        </section>
      )}

      <section aria-labelledby="recipe-sources" className="space-y-1.5 border-t border-border pt-4 text-[0.8125rem] leading-snug text-muted-foreground">
        <h3 id="recipe-sources" className="text-sm font-bold text-foreground">
          {t("recipe.sourceTitle")}
        </h3>
        <ul className="space-y-1.5">
          {recipe.sources.map((group) => (
            <li key={group.kind} className="break-words">
              <span className="font-semibold text-foreground">{group.label}:</span> {group.items.join(", ")}
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-1.5 text-[0.8125rem] leading-snug text-muted-foreground">
        <p>{t("recipe.source")}</p>
        <p>{t("recipe.aiNote")}</p>
      </div>
    </div>
  );
}

/** One recipe at the planned portion: ingredients, steps and the TKPI nutrition of a portion. */
export function RecipeSheet({ item, onClose }: { item: MealPlanItem; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  const recipe = useQuery({
    ...orpc.mealPlan.recipe.queryOptions({
      input: { id: item.recipeId ?? "", scale: item.scale, carbScale: item.carbScale },
    }),
    enabled: item.recipeId !== null,
  });
  const missing = recipe.error instanceof ORPCError && recipe.error.code === "NOT_FOUND";

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={recipe.data?.name ?? item.name}
      description={t("recipe.title")}
    >
      {recipe.data ? (
        <RecipeBody recipe={recipe.data} />
      ) : recipe.isError ? (
        <div role="alert" className="rounded-2xl bg-muted p-4">
          <p className="text-sm font-semibold">{missing ? t("recipe.notFound") : t("loadError")}</p>
          {!missing && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void recipe.refetch()}
            >
              {t("retry")}
            </Button>
          )}
        </div>
      ) : (
        <div aria-busy="true" className="space-y-3">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-5 w-2/3 rounded-full" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      )}
    </Sheet>
  );
}
