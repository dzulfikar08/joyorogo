import { cn } from "@joyorogo/ui/lib/utils";

import type { DayStatus, RecapDay } from "@joyorogo/api/lib/recap";
import { weekdayName, weekdayShort } from "@joyorogo/api/lib/recap";

import { fmtInt } from "@/lib/format";

const BAR_TONE: Record<DayStatus, string> = {
  on_target: "bg-primary",
  over: "bg-bakar",
  under: "bg-muted-foreground/40",
  empty: "bg-muted",
  pending: "bg-muted",
};

const STATUS_LABEL: Record<DayStatus, string> = {
  on_target: "sesuai target",
  over: "di atas target",
  under: "jauh di bawah target, mungkin belum lengkap dicatat",
  empty: "tidak ada catatan makan",
  pending: "belum dinilai",
};

/** Seven day bars with the kcal target as a dashed line. */
export function RecapChart({ days, targetKcal }: { days: RecapDay[]; targetKcal: number }) {
  const top = Math.max(targetKcal * 1.25, ...days.map((day) => day.eatenKcal));
  const targetPct = (targetKcal / top) * 100;
  return (
    <div>
      <div
        role="img"
        aria-label={`Asupan harian dibanding target ${fmtInt(targetKcal)} kcal`}
        className="relative flex h-32 items-end gap-2"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/30"
          style={{ bottom: `${targetPct}%` }}
        />
        {days.map((day) => (
          <div key={day.date} className="flex h-full flex-1 items-end">
            <div
              title={`${weekdayName(day.date)}: ${fmtInt(day.eatenKcal)} kcal, ${STATUS_LABEL[day.status]}`}
              className={cn("w-full rounded-t-lg", BAR_TONE[day.status])}
              style={{ height: `${Math.max(4, (day.eatenKcal / top) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2" aria-hidden>
        {days.map((day) => (
          <span
            key={day.date}
            className="flex-1 text-center text-xs font-semibold text-muted-foreground"
          >
            {weekdayShort(day.date)}
          </span>
        ))}
      </div>
      <ul className="sr-only">
        {days.map((day) => (
          <li key={day.date}>
            {weekdayName(day.date)}: {fmtInt(day.eatenKcal)} kcal, {STATUS_LABEL[day.status]}
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-primary" /> Sesuai target
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-bakar" /> Di atas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/40" /> Kurang dari
          separuh target
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0 w-4 border-t border-dashed border-foreground/40" />{" "}
          Target
        </span>
      </p>
    </div>
  );
}
