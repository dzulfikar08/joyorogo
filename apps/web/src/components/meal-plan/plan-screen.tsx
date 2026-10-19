import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { ErrorNote } from "@/components/kit/error-note";
import { Page, PageHeader } from "@/components/kit/surface";
import { BuySheet } from "@/components/meal-plan/buy-sheet";
import { PrefsSheet } from "@/components/meal-plan/prefs-sheet";
import { EmptyPlan, LockedPlan, NoProfile, PlanSkeleton } from "@/components/meal-plan/plan-states";
import { RecipeSheet } from "@/components/meal-plan/recipe-sheet";
import { RegenSheet } from "@/components/meal-plan/regen-sheet";
import { ShoppingView } from "@/components/meal-plan/shopping-view";
import { SwapSheet } from "@/components/meal-plan/swap-sheet";
import { TodayView } from "@/components/meal-plan/today-view";
import { overviewOptions, useMealPlanActions } from "@/components/meal-plan/use-meal-plan";
import type { SlotRef } from "@/components/meal-plan/use-meal-plan";
import { WeekView } from "@/components/meal-plan/week-view";
import type { MealPlanItem } from "@/lib/api-types";

export type PlanTab = "today" | "week" | "shopping";
const TABS: readonly PlanTab[] = ["today", "week", "shopping"];

const ICON_BUTTON =
  "grid size-11 place-items-center rounded-full bg-card text-foreground transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

function Tabs({ value, onChange }: { value: PlanTab; onChange: (tab: PlanTab) => void }) {
  const { t } = useTranslation("mealPlan");
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(value) + step + TABS.length) % TABS.length] ?? value;
    onChange(next);
    document.getElementById(`plan-tab-${next}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t("title")}
      onKeyDown={move}
      className="flex gap-1 rounded-full bg-muted p-1 md:max-w-md"
    >
      {TABS.map((tab) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            id={`plan-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls="plan-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab)}
            className={cn(
              "min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              active
                ? "bg-card text-foreground shadow-[0_1px_3px_oklch(0.3_0.02_85/12%)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${tab}`)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Rencana makan": the 7-day plan in three tabs (a day, the week, the shopping
 * list) with the sheets that change it. A free account sees the teaser, a Pro
 * account without a plan the build button.
 */
export function PlanScreen({
  tab,
  date,
  onShow,
}: {
  tab: PlanTab;
  date: string | undefined;
  /** one navigation: another tab, another day, or both */
  onShow: (next: { tab?: PlanTab; date?: string }) => void;
}) {
  const { t } = useTranslation("mealPlan");
  const overview = useQuery(overviewOptions);
  const actions = useMealPlanActions();
  const [recipe, setRecipe] = useState<MealPlanItem | null>(null);
  const [buying, setBuying] = useState<MealPlanItem | null>(null);
  const [swapTarget, setSwapTarget] = useState<SlotRef | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  const data = overview.data;
  const ready = data?.status === "ready" ? data : null;
  const week = ready?.plan ?? null;
  const today = ready?.today ?? "";
  const openToday = week?.days.find((d) => d.isToday && !d.isPast) ?? null;
  const shownDate =
    week?.days.find((d) => d.date === date)?.date ?? openToday?.date ?? week?.days[0]?.date ?? "";

  const actionsBar = week && ready && (
    <div className="flex gap-2">
      <button
        type="button"
        aria-label={t("regen.title")}
        onClick={() => setRegenOpen(true)}
        className={ICON_BUTTON}
      >
        <RefreshCw className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t("prefs.title")}
        onClick={() => setPrefsOpen(true)}
        className={ICON_BUTTON}
      >
        <SlidersHorizontal className="size-5" aria-hidden />
      </button>
    </div>
  );

  return (
    <Page className="max-w-xl md:max-w-3xl lg:max-w-5xl">
      <Link
        to="/makan"
        className="-ml-1 inline-flex h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} subtitle={t("subtitle")} action={actionsBar || undefined} />

      {overview.isPending ? (
        <PlanSkeleton />
      ) : overview.isError ? (
        <ErrorNote message={t("loadError")} onRetry={() => void overview.refetch()} />
      ) : data?.status === "noProfile" ? (
        <NoProfile />
      ) : data?.status === "locked" ? (
        <LockedPlan preview={data.preview} />
      ) : !week ? (
        <EmptyPlan actions={actions} />
      ) : (
        <div className="space-y-4">
          <Tabs value={tab} onChange={(next) => onShow({ tab: next })} />
          <div
            role="tabpanel"
            id="plan-panel"
            aria-labelledby={`plan-tab-${tab}`}
            tabIndex={-1}
            className="outline-none"
          >
            {tab === "today" && (
              <TodayView
                week={week}
                today={today}
                date={shownDate}
                actions={actions}
                onDate={(next) => onShow({ date: next })}
                onOpenRecipe={setRecipe}
                onSwap={(swapDate, item) => setSwapTarget({ date: swapDate, slot: item.slot })}
                onBuy={setBuying}
              />
            )}
            {tab === "week" && (
              <WeekView
                week={week}
                today={today}
                onOpenDay={(next) => onShow({ tab: "today", date: next })}
              />
            )}
            {tab === "shopping" && <ShoppingView />}
          </div>
        </div>
      )}

      {buying && <BuySheet item={buying} onClose={() => setBuying(null)} />}
      {recipe && <RecipeSheet item={recipe} onClose={() => setRecipe(null)} />}
      {swapTarget && (
        <SwapSheet target={swapTarget} actions={actions} onClose={() => setSwapTarget(null)} />
      )}
      {prefsOpen && ready && (
        <PrefsSheet prefs={ready.prefs} actions={actions} onClose={() => setPrefsOpen(false)} />
      )}
      {regenOpen && (
        <RegenSheet
          today={openToday?.date ?? null}
          actions={actions}
          onClose={() => setRegenOpen(false)}
        />
      )}
    </Page>
  );
}
