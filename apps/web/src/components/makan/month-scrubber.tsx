import { monthLongLabel } from "@joyorogo/api/lib/diary-view";
import { jakartaToday } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { daysInMonth, shortDayLabel } from "@joyorogo/api/lib/format";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";

import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/**
 * Month header for Daftar: "Oktober 2026", the month's totals, and a dot
 * strip, one mark per day (a tall pill once something is logged, the viewed
 * day in the accent colour). Tapping a mark jumps to that day; future days are
 * off. The DaySwitcher stays the precise control, this is the quick scrub.
 */
export function MonthScrubber({
  date,
  kind,
  onPick,
}: {
  date: string;
  kind: FoodKindFilter;
  onPick: (date: string) => void;
}) {
  const today = jakartaToday();
  const month = date.slice(0, 7);
  const totals = useQuery({
    ...orpc.diary.monthTotals.queryOptions({ input: { month, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const logged = new Set((totals.data?.days ?? []).map((day) => day.date));
  const records = (totals.data?.days ?? []).reduce((sum, day) => sum + day.count, 0);
  const total = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

  return (
    <div className="px-1">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight">{monthLongLabel(month)}</h2>
          <p className="text-sm text-muted-foreground">
            {fmtInt(records)} catatan · {fmtInt(logged.size)} hari tercatat
          </p>
        </div>
      </div>
      <div role="group" aria-label="Loncat ke tanggal bulan ini" className="mt-2 flex items-center">
        {Array.from({ length: total }, (_, index) => {
          const key = `${month}-${String(index + 1).padStart(2, "0")}`;
          const isLogged = logged.has(key);
          const future = key > today;
          return (
            <button
              key={key}
              type="button"
              disabled={future}
              aria-label={`${shortDayLabel(key)}${isLogged ? ", ada catatan" : ""}`}
              aria-current={key === date ? "date" : undefined}
              onClick={() => onPick(key)}
              className="group flex h-8 min-w-0 flex-1 items-center justify-center focus-visible:outline-none disabled:pointer-events-none"
            >
              <span
                className={cn(
                  "w-[0.3125rem] rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40",
                  isLogged ? "h-4" : "h-[0.3125rem]",
                  key === date
                    ? "bg-primary"
                    : future
                      ? "bg-muted/60"
                      : isLogged
                        ? "bg-primary/45 group-hover:bg-primary/70"
                        : "bg-border group-hover:bg-muted-foreground/50",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
