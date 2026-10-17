import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, CircleAlert, CircleCheck, Info } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  checkTargetDate,
  daysBetween,
  jakartaToday,
  MAX_TARGET_DAYS,
  shiftDate,
} from "@joyorogo/api/lib/engine";
import type { TargetDateCheck } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";

import { Segmented } from "@/components/kit/surface";
import { fmtDateLong, fmtInt, fmtKg } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/** 'YYYY-MM-DD' -> local-midnight Date (what react-day-picker works with). */
function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** today + n calendar months, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + months, d));
  if (shifted.getUTCDate() !== d) return new Date(Date.UTC(y, m + months, 0)).toISOString().slice(0, 10);
  return shifted.toISOString().slice(0, 10);
}

const withoutWeekday = (iso: string) => fmtDateLong(iso).replace(/^\w+, /, "");

const QUICK = [
  { key: "month1", months: 1 },
  { key: "month3", months: 3 },
  { key: "month6", months: 6 },
  { key: "year1", months: 12 },
] as const;

export function TargetDateForm({
  targetDate,
  weightNowKg,
  targetWeightKg,
  pending,
  serverError,
  onSave,
}: {
  targetDate: string;
  weightNowKg: number;
  targetWeightKg: number;
  pending: boolean;
  /** Message from the last failed save (e.g. server rejected the date). */
  serverError: string | null;
  onSave: (targetDate: string) => void;
}) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const today = jakartaToday();
  const tomorrow = shiftDate(today, 1);
  const lastDay = shiftDate(today, MAX_TARGET_DAYS);

  const [date, setDate] = useState(targetDate);
  const [month, setMonth] = useState<Date>(() => toLocalDate(targetDate < tomorrow ? tomorrow : targetDate));

  const tag = i18n.language.startsWith("id") ? "id-ID" : "en-US";
  const captionFormat = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" });
  const weekdayFormat = new Intl.DateTimeFormat(tag, { weekday: "short" });

  const check = checkTargetDate({ weightNowKg, targetWeightKg, targetDate: date, today });
  const days = daysBetween(today, date);
  const saveable = ["ok", "fast", "slow", "maintenance"].includes(check.status);
  const previewable = saveable;

  const preview = useQuery({
    ...orpc.profile.previewTargets.queryOptions({
      input: { targetWeightKg, targetDate: date },
    }),
    enabled: previewable,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const pick = (iso: string) => {
    setDate(iso);
    if (iso >= tomorrow && iso <= lastDay) setMonth(toLocalDate(iso));
  };

  const quickValue = QUICK.find((q) => addMonths(today, q.months) === date)?.key ?? "";

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saveable) return;
        onSave(date);
      }}
    >
      <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
        <CalendarDays className="size-5 shrink-0 text-bakar" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-lg leading-tight font-extrabold tracking-tight">
            {withoutWeekday(date)}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {days >= 1 ? t("plan.targetDate.daysAway", { count: days }) : "\u00a0"}
          </p>
        </div>
      </div>

      <Segmented
        label={t("plan.targetDate.pickLabel")}
        value={quickValue}
        onChange={(key) => {
          const quick = QUICK.find((q) => q.key === key);
          if (quick) pick(addMonths(today, quick.months));
        }}
        options={QUICK.map((q) => ({ value: q.key as string, label: t(`plan.targetDate.quick.${q.key}`) }))}
      />

      <Calendar
        mode="single"
        className="p-0"
        showOutsideDays={false}
        weekStartsOn={1}
        month={month}
        onMonthChange={setMonth}
        startMonth={toLocalDate(tomorrow)}
        endMonth={toLocalDate(lastDay)}
        selected={toLocalDate(date)}
        disabled={[{ before: toLocalDate(tomorrow) }, { after: toLocalDate(lastDay) }]}
        onSelect={(day) => {
          if (day) {
            pick(
              `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
            );
          }
        }}
        formatters={{
          formatCaption: (m) => captionFormat.format(m),
          formatWeekdayName: (d) => weekdayFormat.format(d),
        }}
        labels={{
          labelPrevious: () => t("plan.targetDate.prevMonth"),
          labelNext: () => t("plan.targetDate.nextMonth"),
        }}
        classNames={{
          root: "w-full",
          months: "relative w-full",
          month: "w-full",
          month_caption: "relative flex h-11 items-center justify-center",
          caption_label: "text-[0.9375rem] font-bold capitalize",
          nav: "absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between",
          button_previous:
            "flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30",
          button_next:
            "flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30",
          month_grid: "mt-1 w-full border-collapse",
          weekdays: "flex",
          weekday: "flex-1 py-1 text-center text-xs font-semibold text-muted-foreground capitalize",
          week: "mt-1 flex w-full",
          day: "flex-1 p-0 text-center text-sm",
          day_button:
            "mx-auto flex size-11 items-center justify-center rounded-full font-semibold hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
          selected:
            "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary",
          today: "[&>button]:ring-1 [&>button]:ring-border",
          disabled: "opacity-35 [&>button]:pointer-events-none",
          outside: "opacity-0",
          hidden: "invisible",
        }}
      />

      <Verdict
        check={check}
        today={today}
        onUseDate={(offsetDays) => pick(shiftDate(today, Math.min(offsetDays, MAX_TARGET_DAYS)))}
      />

      {previewable &&
        (preview.data ? (
          <p className="rounded-2xl bg-makan-soft px-4 py-3 text-sm leading-snug font-semibold text-makan-ink tabular-nums">
            {preview.data.next.eatKcal !== preview.data.current.eatKcal
              ? t("plan.targetDate.preview.changed", {
                  next: fmtInt(preview.data.next.eatKcal),
                  current: fmtInt(preview.data.current.eatKcal),
                })
              : t("plan.targetDate.preview.same", { kcal: fmtInt(preview.data.next.eatKcal) })}
          </p>
        ) : preview.isError ? (
          <p className="text-sm text-muted-foreground">{t("plan.targetDate.previewFailed")}</p>
        ) : null)}

      {serverError && <p className="text-sm font-semibold text-destructive">{serverError}</p>}
      <Button type="submit" className="w-full" disabled={pending || !saveable}>
        {pending ? t("state.saving") : t("common:actions.save")}
      </Button>
    </form>
  );
}

function Verdict({
  check,
  today,
  onUseDate,
}: {
  check: TargetDateCheck;
  today: string;
  onUseDate: (offsetDays: number) => void;
}) {
  const { t } = useTranslation("settings");
  switch (check.status) {
    case "invalid":
    case "past":
    case "tooFar":
      return (
        <p className="flex items-start gap-1.5 text-sm font-semibold text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("plan.targetDate.error")}
        </p>
      );
    case "maintenance":
      return (
        <p className="flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("plan.targetDate.maintenance")}
        </p>
      );
    case "ok":
      return (
        <p className="flex items-start gap-1.5 text-sm leading-relaxed text-makan-ink">
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("plan.targetDate.ok", {
            kg: fmtKg(check.lossKg),
            count: check.days,
            perWeek: fmtKg((check.lossKg / check.days) * 7),
          })}
        </p>
      );
    case "fast":
      return (
        <div className="rounded-2xl bg-bakar-soft p-4">
          <p className="flex items-start gap-1.5 text-sm leading-snug font-bold text-bakar-ink">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("plan.targetDate.tooFast.title", { deficit: fmtInt(check.rawDeficitKcal) })}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t("plan.targetDate.tooFast.body", {
              kg: fmtKg(check.lossKg),
              count: check.feasibleDays,
            })}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => onUseDate(check.feasibleDays)}
          >
            {t("plan.targetDate.tooFast.useDate", { count: check.feasibleDays })}
          </Button>
        </div>
      );
    case "slow": {
      const suggested = shiftDate(today, Math.min(check.feasibleDays, MAX_TARGET_DAYS));
      return (
        <div className={cn("rounded-2xl bg-muted p-4")}>
          <p className="flex items-start gap-1.5 text-sm leading-snug font-bold">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("plan.targetDate.slow.title")}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t("plan.targetDate.slow.body", {
              deficit: fmtInt(check.deficitKcal),
              date: withoutWeekday(suggested),
            })}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => onUseDate(check.feasibleDays)}
          >
            {t("plan.targetDate.slow.useDate", { date: withoutWeekday(suggested) })}
          </Button>
        </div>
      );
    }
  }
}
