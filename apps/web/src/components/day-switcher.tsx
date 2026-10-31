import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";

import { cn } from "@joyorogo/ui/lib/utils";

import { fmtDateLong } from "@/lib/format";

const arrowClass =
  "flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

/**
 * Prev/next day pill shared by every daily screen: chevrons around
 * "Hari ini" / "Kemarin" / "Sen, 12 Okt" (WIB day keys). Next is disabled on
 * today; on a past day a "Hari ini" button after the pill jumps back. `trailing`
 * is an action (Makan: share the day) pinned beside the pill.
 */
export function DaySwitcher({
  date,
  onChange,
  className,
  trailing,
}: {
  date: string;
  onChange: (date: string) => void;
  className?: string;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation("makan");
  const today = jakartaToday();
  const isToday = date === today;
  return (
    <div className={cn("flex flex-col items-center gap-2 sm:flex-row", className)}>
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label={t("daySwitcher.label")}
          className="flex items-center gap-0.5 rounded-full bg-muted p-1"
        >
          <button
            type="button"
            aria-label={t("daySwitcher.prev")}
            onClick={() => onChange(shiftDate(date, -1))}
            className={arrowClass}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <span
            title={fmtDateLong(date)}
            className="min-w-[5.5rem] px-1.5 py-1.5 text-center text-sm font-bold text-foreground tabular-nums"
          >
            {relativeDayLabel(date, today)}
          </span>
          <button
            type="button"
            aria-label={t("daySwitcher.next")}
            disabled={isToday}
            onClick={() => onChange(shiftDate(date, 1))}
            className={arrowClass}
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        {trailing}
      </div>
      {isToday ? null : (
        <button
          type="button"
          aria-label={t("daySwitcher.backToToday")}
          onClick={() => onChange(today)}
          className="flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <CalendarCheck className="size-4" aria-hidden />
          {t("daySwitcher.today")}
        </button>
      )}
    </div>
  );
}
