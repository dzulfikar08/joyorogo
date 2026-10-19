import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { LoaderCircle, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Mascot } from "@/components/mascot";
import { MealCard } from "@/components/meal-plan/meal-card";
import type { MealPlanActions } from "@/components/meal-plan/use-meal-plan";
import type { MealPlanLocked } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";

/** Where the Pro screen sends the person back to once they have it. */
const UPSELL_SEARCH = { from: "banner", next: "/rencana-makan" } as const;

export function PlanSkeleton() {
  const { t } = useTranslation("mealPlan");
  return (
    <div aria-busy="true" aria-label={t("loading")} className="space-y-3">
      <Skeleton className="h-14 rounded-full" />
      <Skeleton className="h-16 rounded-3xl" />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-5">
        <Skeleton className="h-72 rounded-3xl" />
        <div className="space-y-3">
          <Skeleton className="h-52 rounded-3xl" />
          <Skeleton className="h-52 rounded-3xl" />
        </div>
      </div>
      <p className="sr-only">{t("loading")}</p>
    </div>
  );
}

export function NoProfile() {
  const { t } = useTranslation("mealPlan");
  return (
    <div className="rounded-3xl bg-card p-6 text-center">
      <Mascot pose="ready" size="md" className="mb-3" />
      <p className="mx-auto max-w-sm text-[0.9375rem] leading-relaxed">{t("noProfile")}</p>
      <Button className="mt-4" nativeButton={false} render={<Link to="/onboarding" />}>
        {t("web.completeProfile")}
      </Button>
    </div>
  );
}

/** A free account: one meal of today's plan in full, the rest counted, and the way to Pro. */
export function LockedPlan({ preview }: { preview: MealPlanLocked["preview"] }) {
  const { t } = useTranslation("mealPlan");
  return (
    <section
      aria-labelledby="locked-title"
      className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-8"
    >
      <div className="rounded-3xl bg-card p-6">
        <span className="grid size-11 place-items-center rounded-full bg-bakar-soft text-bakar-ink">
          <Lock className="size-5" aria-hidden />
        </span>
        <h2 id="locked-title" className="mt-4 text-xl leading-tight font-extrabold tracking-tight">
          {t("locked.title")}
        </h2>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
          {t("locked.body")}
        </p>
        <Button
          className="mt-5 w-full sm:w-auto"
          nativeButton={false}
          render={<Link to="/pro" search={UPSELL_SEARCH} />}
        >
          {t("locked.cta")}
        </Button>
      </div>

      {preview.item && (
        <div>
          <h3 className="px-1 pb-2 text-sm font-bold">{t("locked.preview")}</h3>
          <ul className="space-y-3">
            <MealCard item={preview.item} day={{ isPast: false, isToday: false }} />
            {preview.hidden > 0 && (
              <li className="flex min-h-14 items-center gap-3 rounded-3xl bg-muted px-5 py-3 text-sm font-semibold text-muted-foreground">
                <Lock className="size-4 shrink-0" aria-hidden />
                {t("locked.hidden", { n: fmtInt(preview.hidden) })}
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A Pro account with no plan yet: one tap builds the 7 days. */
export function EmptyPlan({ actions }: { actions: MealPlanActions }) {
  const { t } = useTranslation("mealPlan");
  const { generate } = actions;
  return (
    <div className="rounded-3xl bg-card p-6 text-center">
      <Mascot pose="ready" size="md" className="mb-3" />
      <h2 className="text-lg font-extrabold tracking-tight">{t("empty.title")}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {t("empty.body")}
      </p>
      <Button className="mt-5" disabled={generate.isPending} onClick={() => generate.mutate(false)}>
        {generate.isPending && (
          <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
        )}
        {generate.isPending ? t("empty.working") : t("empty.cta")}
      </Button>
    </div>
  );
}
