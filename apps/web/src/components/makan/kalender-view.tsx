import {
  dayKcalFill,
  dayTargetStatus,
  monthSummary,
  shiftMonth,
} from "@joyorogo/api/lib/diary-view";
import type { DayMode, DayStatus } from "@joyorogo/api/lib/diary-view";
import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { dateKeyToUtcDate } from "@joyorogo/api/lib/format";
import { fmtDate } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, useContext, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { useGain } from "@/components/gain/use-gain";
import { MacroLine } from "@/components/macro-line";
import { useMaternalInfo } from "@/components/maternal/use-maternal";
import { fmtDateLong, fmtInt, fmtKcalLabel } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const RING = 34;
const STROKE = 3;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Arc color per status: within the target is makan, over it terracotta-red, under a gain floor amber. */
const STATUS_STROKE: Record<DayStatus, string> = {
  within: "stroke-makan",
  over: "stroke-destructive",
  under: "stroke-amber-400",
};
const STATUS_SWATCH: Record<DayStatus, string> = {
  within: "border-makan",
  over: "border-destructive",
  under: "border-amber-400",
};

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Props react-day-picker hands a custom day button (the package is a dep of ui only). */
type DayButtonProps = Parameters<
  NonNullable<NonNullable<ComponentProps<typeof Calendar>["components"]>["DayButton"]>
>[0];

type DayTotal = { date: string; kcal: number; count: number };
type KalenderState = {
  byDate: Record<string, DayTotal>;
  targetKcal: number | null;
  mode: DayMode;
  selected: string;
  today: string;
};

const KalenderContext = createContext<KalenderState | null>(null);

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** One calendar cell: the day number inside a ring that shows how the day landed against the target. */
function DayCell({ day, modifiers, className, ...props }: DayButtonProps) {
  const { t } = useTranslation("makan");
  const state = useContext(KalenderContext);
  if (!state) throw new Error("DayCell renders inside KalenderView only");
  const key = day.isoDate;
  const total = state.byDate[key];
  const selected = key === state.selected;
  const status = total ? dayTargetStatus(total.kcal, state.targetKcal, state.mode) : null;
  const fill = total ? dayKcalFill(total.kcal, state.targetKcal) : 0;
  const date = fmtDate(key, "weekday");
  const label = total
    ? [
        t("calendar.dayWithEntries", {
          count: total.count,
          date,
          kcal: fmtKcalLabel(total.kcal),
        }),
        status ? t(`calendar.status.${status}`) : null,
      ]
        .filter(Boolean)
        .join(", ")
    : t("calendar.dayEmpty", { date });
  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={modifiers.disabled}
      className={cn(
        "relative mx-auto block aspect-square w-full max-w-14 rounded-2xl text-sm tabular-nums transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30",
        selected ? "bg-primary/12 ring-2 ring-primary/40" : "hover:bg-muted",
      )}
    >
      {total ? (
        <svg
          width={RING}
          height={RING}
          viewBox={`0 0 ${RING} ${RING}`}
          className="absolute inset-0 m-auto -rotate-90"
          aria-hidden
        >
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={status ? STROKE : 2}
            className={status ? "stroke-muted" : "stroke-makan"}
          />
          {status && (
            <circle
              cx={RING / 2}
              cy={RING / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - fill)}
              className={STATUS_STROKE[status]}
            />
          )}
        </svg>
      ) : null}
      <span
        className={cn(
          "absolute inset-0 grid place-items-center text-xs font-bold",
          !total && "font-medium text-muted-foreground",
          key === state.today && "text-primary",
        )}
      >
        {day.date.getUTCDate()}
      </span>
    </button>
  );
}

function LegendItem({ swatch, children }: { swatch: string; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-3 rounded-full border-[2.5px]", swatch)} />
      {children}
    </li>
  );
}

/**
 * The selected day under the grid: eaten against target, the four macros, and
 * the button that opens that day in Daftar.
 */
function DayPanel({ date, onOpen }: { date: string; onOpen: () => void }) {
  const { t } = useTranslation("makan");
  const list = useQuery(orpc.food.listByDate.queryOptions({ input: { date } }));
  const summary = useQuery(orpc.day.summary.queryOptions({ input: { date } }));
  const totals = list.data?.totals;
  const targetKcal = summary.data?.targets?.eatKcal ?? null;
  const empty = list.data !== undefined && list.data.items.length === 0;
  return (
    <section
      aria-label={t("diary.list.dayAria", { date: fmtDateLong(date) })}
      className="mt-3 rounded-3xl bg-card p-5"
    >
      <h3 className="text-base font-bold tracking-tight">{relativeDayLabel(date, jakartaToday())}</h3>
      {list.isPending || !totals ? (
        <Skeleton className="mt-2 h-10 w-full rounded-2xl" />
      ) : empty ? (
        <p className="mt-1 text-sm text-muted-foreground">{t("calendar.day.empty")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm font-semibold text-muted-foreground tabular-nums">
            {targetKcal !== null
              ? t("calendar.day.ofTarget", {
                  eaten: fmtInt(totals.kcal),
                  target: fmtInt(targetKcal),
                })
              : `${fmtInt(totals.kcal)} ${t("diary.summary.unit")}`}
          </p>
          <MacroLine
            compact
            className="mt-2 text-sm text-muted-foreground"
            protein={totals.protein}
            carbs={totals.carbs}
            fat={totals.fat}
            fiber={totals.fiber}
          />
        </>
      )}
      <Button className="mt-4 w-full" onClick={onOpen}>
        {t("calendar.day.open")}
      </Button>
    </section>
  );
}

/**
 * Kalender view: month header with the month's nutrition stats, a grid whose
 * cells show how each day landed against the kcal target, a legend, and the
 * selected day's panel. Tapping a day selects it through `onSelect`; the
 * panel's button opens it in Daftar through `onOpenDaftar`.
 */
export function KalenderView({
  date,
  kind,
  onSelect,
  onOpenDaftar,
}: {
  date: string;
  kind: FoodKindFilter;
  onSelect: (date: string) => void;
  onOpenDaftar: (date: string) => void;
}) {
  const { t } = useTranslation("makan");
  const today = jakartaToday();
  const { gain } = useGain();
  const maternal = useMaternalInfo();
  const mode: DayMode = maternal ? "neutral" : gain ? "gain" : "lose";
  const [month, setMonth] = useState(date.slice(0, 7));
  const totals = useQuery({
    ...orpc.diary.monthTotals.queryOptions({ input: { month, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const targetKcal = totals.data?.targetKcal ?? null;
  const days = totals.data?.days;
  const state = useMemo<KalenderState>(
    () => ({
      byDate: Object.fromEntries((days ?? []).map((day) => [day.date, day])),
      targetKcal,
      mode,
      selected: date,
      today,
    }),
    [days, targetKcal, mode, date, today],
  );
  const summary = useMemo(() => monthSummary(days ?? [], targetKcal, mode), [days, targetKcal, mode]);
  const judged = mode !== "neutral" && targetKcal !== null;
  const todayUtc = dateKeyToUtcDate(today) ?? new Date();
  const canNext = month < today.slice(0, 7);

  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight">{fmtDate(`${month}-01`, "month")}</h2>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground tabular-nums">
            <span>{t("calendar.stats.logged", { count: summary.logged, n: fmtInt(summary.logged) })}</span>
            {judged && summary.logged > 0 && (
              <>
                <span className="font-semibold text-makan-ink">
                  {t("calendar.stats.within", { count: summary.within, n: fmtInt(summary.within) })}
                </span>
                {mode === "gain" ? (
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {t("calendar.stats.under", { count: summary.under, n: fmtInt(summary.under) })}
                  </span>
                ) : (
                  <span className="font-semibold text-bakar-ink">
                    {t("calendar.stats.over", { count: summary.over, n: fmtInt(summary.over) })}
                  </span>
                )}
              </>
            )}
          </p>
          {summary.avgKcal !== null && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {t("calendar.stats.average", { kcal: fmtKcalLabel(summary.avgKcal) })}
            </p>
          )}
          {judged && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {t("calendar.budget", { kcal: fmtKcalLabel(targetKcal) })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={t("calendar.prevMonth")}
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("calendar.nextMonth")}
            disabled={!canNext}
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <section aria-label={t("calendar.label")} className="mt-3 rounded-3xl bg-card p-3 pb-4">
        <KalenderContext.Provider value={state}>
          <Calendar
            timeZone="UTC"
            showOutsideDays={false}
            weekStartsOn={1}
            hideNavigation
            onDayClick={(day) => onSelect(jakartaToday(day))}
            month={dateKeyToUtcDate(`${month}-01`) ?? undefined}
            onMonthChange={(next) => setMonth(monthKeyOf(next))}
            endMonth={todayUtc}
            disabled={{ after: todayUtc }}
            formatters={{
              formatWeekdayName: (weekday) =>
                t(`calendar.weekday.${WEEKDAY_KEYS[(weekday.getUTCDay() + 6) % 7] ?? "mon"}`),
            }}
            className="w-full p-0"
            classNames={{
              root: "w-full",
              months: "w-full",
              month: "w-full",
              month_caption: "hidden",
              month_grid: "w-full",
              weekdays: "grid grid-cols-7",
              weekday: "py-1 text-center text-xs font-semibold text-muted-foreground",
              weeks: "block",
              week: "mt-1 grid grid-cols-7",
              day: "p-0 text-center",
              today: "",
              selected: "",
              disabled: "",
            }}
            components={{ DayButton: DayCell }}
          />
        </KalenderContext.Provider>
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 text-xs text-muted-foreground">
          {judged ? (
            <>
              <LegendItem swatch={STATUS_SWATCH.within}>{t("calendar.legend.within")}</LegendItem>
              {mode === "gain" ? (
                <LegendItem swatch={STATUS_SWATCH.under}>{t("calendar.legend.under")}</LegendItem>
              ) : (
                <LegendItem swatch={STATUS_SWATCH.over}>{t("calendar.legend.over")}</LegendItem>
              )}
            </>
          ) : (
            <LegendItem swatch="border-makan">{t("calendar.legend.logged")}</LegendItem>
          )}
          <LegendItem swatch="border-muted">{t("calendar.legend.none")}</LegendItem>
        </ul>
      </section>

      <DayPanel date={date} onOpen={() => onOpenDaftar(date)} />
    </div>
  );
}
