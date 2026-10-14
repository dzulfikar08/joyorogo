import { ChevronLeft, ChevronRight } from "lucide-react";

import { jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";

import { cn } from "@joyorogo/ui/lib/utils";

import { fmtDateIndo } from "@/lib/format";

const arrowClass =
  "flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

/**
 * Prev/next day pill shared by every daily screen: chevrons around
 * "Hari ini" / "Kemarin" / "Sen, 12 Okt" (WIB day keys). Next is disabled on
 * today; tapping the label jumps back to today.
 */
export function DaySwitcher({
  date,
  onChange,
  className,
}: {
  date: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  const today = jakartaToday();
  const isToday = date === today;
  return (
    <div
      role="group"
      aria-label="Pilih hari"
      className={cn("flex items-center gap-0.5 rounded-full bg-muted p-1", className)}
    >
      <button
        type="button"
        aria-label="Hari sebelumnya"
        onClick={() => onChange(shiftDate(date, -1))}
        className={arrowClass}
      >
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={isToday ? undefined : "Kembali ke hari ini"}
        title={fmtDateIndo(date)}
        disabled={isToday}
        onClick={() => onChange(today)}
        className="min-w-[5.5rem] rounded-full px-1.5 py-1.5 text-center text-sm font-bold text-foreground tabular-nums transition-colors hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none"
      >
        {relativeDayLabel(date, today)}
      </button>
      <button
        type="button"
        aria-label="Hari berikutnya"
        disabled={isToday}
        onClick={() => onChange(shiftDate(date, 1))}
        className={arrowClass}
      >
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
  );
}
