import { dayKcalFill, shiftMonth } from "@joyorogo/api/lib/diary-view";
import { eatTone, jakartaToday } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { dateKeyToUtcDate } from "@joyorogo/api/lib/format";
import { fmtDate } from "@joyorogo/i18n";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, useContext, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { stickerUrl, STICKER_FILTER } from "@/components/sticker";
import { fmtInt, fmtKcalLabel } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const RING = 34;
const STROKE = 3;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TONE_STROKE = {
  ok: "stroke-makan",
  near: "stroke-amber-400",
  over: "stroke-destructive",
} as const;
const TONE_DOT = { ok: "bg-makan", near: "bg-amber-400", over: "bg-destructive" } as const;

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Props react-day-picker hands a custom day button (the package is a dep of ui only). */
type DayButtonProps = Parameters<
  NonNullable<NonNullable<ComponentProps<typeof Calendar>["components"]>["DayButton"]>
>[0];

type DayTotal = {
  date: string;
  kcal: number;
  count: number;
  scanId: string | null;
  name: string | null;
};
type KalenderState = {
  byDate: Record<string, DayTotal>;
  targetKcal: number | null;
  selected: string;
  today: string;
};

const KalenderContext = createContext<KalenderState | null>(null);

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** One calendar cell: day number, the day's showcase cutout (+N for more
 * items), and a small tone dot for kcal against the budget. */
function DayCell({ day, modifiers, className, ...props }: DayButtonProps) {
  const { t } = useTranslation("makan");
  const state = useContext(KalenderContext);
  const [imageFailed, setImageFailed] = useState(false);
  if (!state) throw new Error("DayCell renders inside KalenderView only");
  const key = day.isoDate;
  const total = state.byDate[key];
  const selected = key === state.selected;
  const tone = total ? eatTone(total.kcal, state.targetKcal ?? 0) : "ok";
  const fill = total ? dayKcalFill(total.kcal, state.targetKcal) : 0;
  const showSticker = total?.scanId && !imageFailed;
  const label = total
    ? t("calendar.dayWithEntries", {
        count: total.count,
        date: fmtDate(key, "weekday"),
        kcal: fmtKcalLabel(total.kcal),
      })
    : t("calendar.dayEmpty", { date: fmtDate(key, "weekday") });
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
      {showSticker ? (
        <img
          src={stickerUrl(total.scanId as string)}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="absolute inset-x-1 top-3.5 bottom-0.5 size-[calc(100%-1.125rem)] object-contain"
          style={STICKER_FILTER}
        />
      ) : total ? (
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
            strokeWidth={STROKE}
            className="stroke-muted"
          />
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fill)}
            className={TONE_STROKE[tone]}
          />
        </svg>
      ) : null}
      <span
        className={cn(
          "absolute text-xs font-bold",
          showSticker ? "top-0.5 left-1.5" : "inset-0 grid place-items-center",
          !total && "font-medium text-muted-foreground",
          key === state.today && "text-primary",
        )}
      >
        {day.date.getUTCDate()}
      </span>
      {total && showSticker && (
        <span
          className={cn("absolute top-1.5 right-1.5 size-1.5 rounded-full", TONE_DOT[tone])}
          aria-hidden
        />
      )}
      {total && total.count > 1 && (
        <span className="absolute right-0.5 bottom-0.5 rounded-full bg-card px-1 text-[0.625rem] leading-4 font-bold text-primary">
          +{total.count - 1}
        </span>
      )}
    </button>
  );
}

/**
 * Kalender view: month header with totals, a grid whose cells carry the day's
 * cutout sticker (ring of kcal vs budget when it has none), a footer count,
 * and `children` (the selected day's section) below the card. Tapping a day
 * selects it through `onSelect`.
 */
export function KalenderView({
  date,
  kind,
  onSelect,
  children,
}: {
  date: string;
  kind: FoodKindFilter;
  onSelect: (date: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation("makan");
  const today = jakartaToday();
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
      selected: date,
      today,
    }),
    [days, targetKcal, date, today],
  );
  const records = days?.reduce((sum, day) => sum + day.count, 0) ?? 0;
  const daysLogged = days?.length ?? 0;
  const todayUtc = dateKeyToUtcDate(today) ?? new Date();
  const canNext = month < today.slice(0, 7);

  return (
    <div className="mt-4">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight">{fmtDate(`${month}-01`, "month")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("monthScrubber.records", { count: records, n: fmtInt(records) })} ·{" "}
            {t("monthScrubber.daysLogged", { count: daysLogged, n: fmtInt(daysLogged) })}
          </p>
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
        <p className="mt-3 flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          {t("calendar.daysLoggedMonth", { count: daysLogged, n: fmtInt(daysLogged) })}
          {targetKcal !== null && (
            <span className="ml-auto text-xs">
              {t("calendar.budget", { kcal: fmtKcalLabel(targetKcal) })}
            </span>
          )}
        </p>
      </section>

      {children}
    </div>
  );
}
