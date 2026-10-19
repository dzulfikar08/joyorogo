import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconChip } from "@/components/kit/surface";
import { overviewOptions } from "@/components/meal-plan/use-meal-plan";
import { useAppConfig } from "@/lib/app-config";
import { orpc } from "@/utils/orpc";

/**
 * The way into "Rencana makan" from Makan and Beranda. A free account sees the
 * Pro label; a Pro account whose plan exists is told today's menu is ready.
 */
export function MealPlanEntry() {
  const { t } = useTranslation("mealPlan");
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const config = useAppConfig();
  // A server without a paywall unlocks the plan for every account.
  const free = profile.data?.tier === "free" && config.data?.paywall !== false;
  const overview = useQuery({ ...overviewOptions, enabled: profile.data !== undefined && !free });
  const planned = overview.data?.status === "ready" && overview.data.plan !== null;

  return (
    <Link
      to="/rencana-makan"
      className="flex min-h-16 w-full items-center gap-3 rounded-3xl bg-card px-5 py-3.5 transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <IconChip tone="makan">
        <CalendarDays />
      </IconChip>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[0.9375rem] font-bold">{t("entry.title")}</span>
          {free && (
            <span className="inline-flex h-5 items-center rounded-full bg-bakar-soft px-2 text-[0.6875rem] font-bold text-bakar-ink">
              {t("entry.pro")}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
          {planned ? t("entry.bodyPro") : t("entry.body")}
        </span>
        <span className="mt-1 block text-sm font-semibold text-primary">{t("entry.cta")}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
