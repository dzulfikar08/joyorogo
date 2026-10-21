import { kcalUnit } from "@joyorogo/i18n";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, Check, ChevronRight, Target } from "lucide-react";
import { useTranslation } from "react-i18next";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { weekRangeLabel, weekStartOf } from "@joyorogo/api/lib/recap";

import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/**
 * "Rekap minggu ini" on Beranda: only on Monday (day zone), summarizing the week
 * that just ended. The full recap lives at /rekap and stays reachable from Lainnya.
 */
export function RecapCard() {
  const { t } = useTranslation("home");
  const today = jakartaToday();
  const isMonday = weekStartOf(today) === today;
  const weekStart = shiftDate(today, -7);
  const recap = useQuery({
    ...orpc.stats.weekRecap.queryOptions({ input: { weekStart } }),
    enabled: isMonday,
  });
  const reflection = useQuery({
    ...orpc.stats.weekReflection.queryOptions({ input: { weekStart } }),
    enabled: isMonday,
  });
  const teaser = reflection.data?.focus[0]?.title ?? reflection.data?.wins[0]?.title ?? null;
  const TeaserIcon = reflection.data?.focus.length ? Target : Check;
  const data = recap.data;
  if (!isMonday || !data || data.avgKcal === null) return null;

  return (
    <Link
      to="/rekap"
      search={{ week: weekStart }}
      className="pressable block rounded-3xl bg-card p-5 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10">
          <CalendarCheck className="size-5 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold tracking-tight">{t("recap.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("recap.lastWeek", { range: weekRangeLabel(weekStart) })}
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-muted/60 px-4 py-3">
          <dt className="text-xs font-semibold text-muted-foreground">{t("recap.average")}</dt>
          <dd className="mt-0.5 text-xl font-extrabold tracking-tight tabular-nums">
            {fmtInt(data.avgKcal)}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">{kcalUnit()}</span>
          </dd>
          <dd className="text-xs text-muted-foreground tabular-nums">
            {t("recap.target", { kcal: fmtInt(data.targetKcal) })}
          </dd>
        </div>
        <div className="rounded-2xl bg-muted/60 px-4 py-3">
          <dt className="text-xs font-semibold text-muted-foreground">{t("recap.onTarget")}</dt>
          <dd className="mt-0.5 text-xl font-extrabold tracking-tight tabular-nums">
            {data.daysOnTarget}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">
              {t("recap.daysUnit", { count: data.daysOnTarget })}
            </span>
          </dd>
          <dd className="text-xs text-muted-foreground tabular-nums">
            {t("recap.logged", { count: data.loggedDays })}
          </dd>
        </div>
      </dl>
      {teaser ? (
        <p className="mt-3 flex items-start gap-2 text-sm leading-snug text-muted-foreground">
          <TeaserIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{teaser}</span>
        </p>
      ) : null}
    </Link>
  );
}
