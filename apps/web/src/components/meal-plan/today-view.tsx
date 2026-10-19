import { cn } from "@joyorogo/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { relativeDayLabel } from "@joyorogo/api/lib/engine";
import { fmtDate } from "@joyorogo/i18n";

import { DayTotals } from "@/components/meal-plan/day-totals";
import { MealCard } from "@/components/meal-plan/meal-card";
import { isSlotBusy } from "@/components/meal-plan/use-meal-plan";
import type { MealPlanActions } from "@/components/meal-plan/use-meal-plan";
import type { MealPlanItem, MealPlanWeek } from "@/lib/api-types";
import { fmtDateLong } from "@/lib/format";

/** "Sen" / "Mon": the first three letters of the weekday of a 'YYYY-MM-DD' calendar day. */
function weekdayShort(date: string): string {
  return (fmtDate(date, "weekday").split(",")[0] ?? "").slice(0, 3);
}

/** The 7 planned dates in a row; the chosen one is what the meals below show. */
function DayStrip({
  week,
  today,
  date,
  onChange,
}: {
  week: MealPlanWeek;
  today: string;
  date: string;
  onChange: (date: string) => void;
}) {
  const { t } = useTranslation("mealPlan");
  return (
    <div
      role="group"
      aria-label={t("week.title")}
      className="grid grid-cols-7 rounded-3xl bg-card p-1"
    >
      {week.days.map((day) => {
        const active = day.date === date;
        return (
          <button
            key={day.date}
            type="button"
            aria-pressed={active}
            aria-current={day.isToday ? "date" : undefined}
            aria-label={`${relativeDayLabel(day.date, today)}, ${fmtDateLong(day.date)}`}
            onClick={() => onChange(day.date)}
            className={cn(
              "flex min-h-14 min-w-0 flex-col items-center justify-center rounded-2xl px-0.5 py-1.5 transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              active ? "bg-foreground text-background" : "hover:bg-muted",
              !active && day.isPast && "text-muted-foreground",
            )}
          >
            <span className="text-xs font-semibold">{weekdayShort(day.date)}</span>
            <span className="text-base leading-tight font-extrabold tabular-nums">
              {day.date.slice(8).replace(/^0/, "")}
            </span>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 h-0.5 w-3 rounded-full",
                day.isToday ? (active ? "bg-background" : "bg-primary") : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/** One day of the plan: totals against targets, one card per meal, and why the plan looks like this. */
export function TodayView({
  week,
  today,
  date,
  actions,
  onDate,
  onOpenRecipe,
  onSwap,
}: {
  week: MealPlanWeek;
  today: string;
  date: string;
  actions: MealPlanActions;
  onDate: (date: string) => void;
  onOpenRecipe: (item: MealPlanItem) => void;
  onSwap: (date: string, item: MealPlanItem) => void;
}) {
  const { t } = useTranslation("mealPlan");
  const day = week.days.find((d) => d.date === date) ?? week.days[0];
  if (!day) return null;
  const { eat, undo } = actions;

  return (
    <div className="space-y-3">
      <DayStrip week={week} today={today} date={day.date} onChange={onDate} />
      <h2 className="px-1 pt-1 text-lg font-extrabold tracking-tight">
        {relativeDayLabel(day.date, today)}
        {day.isPast && (
          <span className="ml-2 text-sm font-semibold text-muted-foreground">{t("day.past")}</span>
        )}
      </h2>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-5">
        <div className="lg:col-start-1 lg:row-start-1">
          <DayTotals day={day} />
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {day.items.length > 0 ? (
            <ul className="space-y-3">
              {day.items.map((item) => (
                <MealCard
                  key={item.slot}
                  item={item}
                  day={day}
                  controls={{
                    busy:
                      isSlotBusy(eat, day.date, item.slot) || isSlotBusy(undo, day.date, item.slot),
                    onOpenRecipe,
                    onSwap: (picked) => onSwap(day.date, picked),
                    onEat: (picked) => eat.mutate({ date: day.date, slot: picked.slot }),
                    onUndo: (picked) => undo.mutate({ date: day.date, slot: picked.slot }),
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-3xl bg-card px-5 py-4 text-sm text-muted-foreground">
              {t("day.noMeals")}
            </p>
          )}
        </div>

        {day.reasons.length > 0 && (
          <details className="group rounded-3xl bg-card lg:col-start-1 lg:row-start-2">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              <span className="text-[0.9375rem] font-bold">{t("day.why")}</span>
              <ChevronDown
                className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <ul className="space-y-2.5 px-5 pb-5">
              {day.reasons.map((reason) => (
                <li key={reason} className="text-sm leading-relaxed text-muted-foreground">
                  {reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
