import { relativeDayLabel } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";
import { ArrowDown, ArrowUp, Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MetaLine } from "@/components/meta-line";
import type { MealPlanDay, MealPlanWeek } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";

function MetChip({
  label,
  met,
  direction,
}: {
  label: string;
  met: boolean;
  direction: "over" | "under";
}) {
  const Icon = met ? Check : direction === "over" ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        met ? "bg-makan-soft text-makan-ink" : "bg-bakar-soft text-bakar-ink",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

function WeekRow({
  day,
  today,
  onOpen,
}: {
  day: MealPlanDay;
  today: string;
  onOpen: (date: string) => void;
}) {
  const { t } = useTranslation("mealPlan");
  const { total, targets, met } = day;
  const names = day.items.map((item) => item.name);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(day.date)}
        className="flex w-full items-start gap-3 rounded-3xl px-5 py-4 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-inset md:items-center"
      >
        <span className="grid min-w-0 flex-1 gap-x-6 gap-y-2 md:grid-cols-[11rem_minmax(0,1fr)]">
          <span className="block">
            <span className="block text-[0.9375rem] font-bold">
              {relativeDayLabel(day.date, today)}
              {day.isToday && <span className="sr-only">, {t("day.today")}</span>}
            </span>
            <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground tabular-nums">
              <MetaLine
                items={[day.isPast && t("day.past"), t("week.menus", { n: fmtInt(names.length) })]}
              />
            </span>
          </span>
          <span className="block min-w-0 space-y-2">
            <span className="block text-sm tabular-nums">
              <span className="font-bold">{t("day.unitKcal", { n: fmtInt(total.kcal) })}</span>{" "}
              <span className="text-muted-foreground">
                {t("day.of", { target: t("day.unitKcal", { n: fmtInt(targets.kcal) }) })}
              </span>
              <span aria-hidden className="mx-2 text-muted-foreground/60">
                /
              </span>
              <span className="sr-only">, </span>
              <span className="font-bold">
                {t("day.protein")} {t("day.unitG", { n: fmtInt(total.proteinG) })}
              </span>{" "}
              <span className="text-muted-foreground">
                {t("day.of", { target: t("day.unitG", { n: fmtInt(targets.proteinG) }) })}
              </span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              <MetChip
                label={t("day.kcal")}
                met={met.kcal}
                direction={day.kcalDelta > 0 ? "over" : "under"}
              />
              <MetChip label={t("day.protein")} met={met.protein} direction="under" />
            </span>
            {names.length > 0 && (
              <span className="block text-[0.8125rem] leading-snug text-muted-foreground">
                {names.join(", ")}
              </span>
            )}
          </span>
        </span>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground md:mt-0" aria-hidden />
      </button>
    </li>
  );
}

/** The 7 planned days at a glance; opening one shows it in the day view. */
export function WeekView({
  week,
  today,
  onOpenDay,
}: {
  week: MealPlanWeek;
  today: string;
  onOpenDay: (date: string) => void;
}) {
  const { t } = useTranslation("mealPlan");
  const open = week.days.filter((day) => !day.isPast).length;
  return (
    <section aria-labelledby="week-title">
      <div className="px-1 pb-3">
        <h2 id="week-title" className="text-lg font-extrabold tracking-tight">
          {t("week.title")}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("week.met", { n: fmtInt(week.daysMet), total: fmtInt(open) })}
        </p>
      </div>
      <ul className="divide-y divide-border rounded-3xl bg-card p-1.5 [&>li]:py-0.5 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
        {week.days.map((day) => (
          <WeekRow key={day.date} day={day} today={today} onOpen={onOpenDay} />
        ))}
      </ul>
    </section>
  );
}
