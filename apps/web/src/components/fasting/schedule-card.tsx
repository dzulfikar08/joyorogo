import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Check, CircleAlert, Utensils } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import {
  fastingElapsedFraction,
  fmtCountdown,
  MEAL_KIND_LABELS,
} from "@joyorogo/api/lib/fasting";

import { orpc } from "@/utils/orpc";

const idInt = new Intl.NumberFormat("id-ID");

/**
 * "Panduan jadwal makan" di Beranda: status puasa/jendela, hitung mundur ke
 * waktu makan berikutnya, jadwal dengan kcal per waktu makan, makan terakhir,
 * sisa kalori, penanda makan di luar jendela, dan ringkasan mingguan.
 * Nonaktif (pola off / mode Ramadan) → tidak dirender.
 */
export function FastingScheduleCard() {
  const today = useQuery({
    ...orpc.fasting.today.queryOptions({ input: {} }),
    refetchInterval: 5 * 60 * 1000,
  });
  const week = useQuery(orpc.fasting.week.queryOptions());

  // Countdown keeps breathing between refetches.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (today.isPending) {
    return (
      <section aria-label="Panduan jadwal makan" className="rounded-2xl bg-muted p-4">
        <Skeleton className="h-5 w-40 rounded-full" />
        <Skeleton className="mt-3 h-20 w-full rounded-xl" />
      </section>
    );
  }
  const data = today.data;
  if (today.error || !data?.active || !data.nextEvent) return null;

  // Monotonic live countdown: server minutesAway minus time elapsed since the
  // fetch, so the display never wraps around to "tomorrow" between refetches.
  const elapsedMin = Math.max(0, (now.getTime() - today.dataUpdatedAt) / 60_000);
  const nextAway = Math.max(0, Math.ceil(data.nextEvent.minutesAway - elapsedMin));
  const stateLabel =
    data.state === "jendela_makan" ? `Jendela makan ${data.windowOpen}–${data.windowClose}` : "Puasa";
  // Progress bar only makes sense while fasting; it tracks the current fast
  // from the last window close to the next open.
  const fastPct =
    data.state === "puasa" && data.nextEvent.kind === "open" && data.windowOpen && data.windowClose
      ? fastingElapsedFraction(data.windowOpen, data.windowClose, nextAway)
      : null;

  return (
    <section aria-label="Panduan jadwal makan" className="rounded-2xl bg-muted p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold">Panduan jadwal makan</p>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-bold",
            data.state === "jendela_makan" ? "bg-makan-soft text-makan-ink" : "bg-card text-foreground",
          )}
        >
          {stateLabel}
        </span>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        <AlarmClock className="size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold text-foreground">{data.nextEvent.label}</span> dalam{" "}
          <span className="font-semibold tabular-nums text-foreground">{fmtCountdown(nextAway)}</span>
        </span>
      </p>

      {fastPct !== null && (
        <div
          className="mt-2.5"
          role="progressbar"
          aria-label="Progres puasa hari ini"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fastPct * 100)}
        >
          <div className="h-1.5 overflow-hidden rounded-full bg-card">
            <div
              className="h-full rounded-full bg-makan transition-[width] duration-500"
              style={{ width: `${Math.round(fastPct * 100)}%` }}
            />
          </div>
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {data.schedule.map((entry) => (
          <li
            key={`${entry.time}-${entry.kind}`}
            className={cn(
              "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm",
              entry.past ? "bg-card/50 text-muted-foreground" : "bg-card",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {entry.past ? (
                <Check className="size-4 shrink-0 text-makan" aria-hidden />
              ) : (
                <Utensils className="size-4 shrink-0 text-makan/60" aria-hidden />
              )}
              <span className="truncate">
                <span className="font-semibold tabular-nums">{entry.time}</span>{" "}
                {MEAL_KIND_LABELS[entry.kind]}
                <span className="text-xs text-muted-foreground">
                  {" · "}
                  {MEAL_LABELS[entry.meal]}
                </span>
              </span>
            </span>
            <span className="shrink-0 font-bold tabular-nums">
              {entry.kcal > 0 ? `±${idInt.format(entry.kcal)} kcal` : "0"}
            </span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">Sisa jendela ini</dt>
          <dd className="font-bold tabular-nums">{idInt.format(data.remainingKcal)} kcal</dd>
        </div>
        <div className="rounded-xl bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">Makan terakhir</dt>
          <dd className="font-bold tabular-nums">
            {data.lastMeal
              ? `${data.lastMeal.time} · ${MEAL_LABELS[data.lastMeal.meal]}`
              : "belum makan"}
          </dd>
        </div>
      </dl>

      {data.outsideWindowKcal > 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-bakar-soft px-3 py-2 text-xs font-semibold text-bakar-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {idInt.format(data.outsideWindowKcal)} kcal dicatat di luar jendela makan (
          {data.outsideWindow.map((log) => `${log.time} ${idInt.format(log.kcal)}`).join(", ")})
        </p>
      )}

      {week.data?.active && (
        <p className="mt-2 text-xs text-muted-foreground">
          Minggu ini {week.data.keptDays} dari{" "}
          {week.data.days.filter((day) => day.kept !== null).length} hari sesuai jadwal puasa.
        </p>
      )}
    </section>
  );
}
