import { fmtDateMedium, fmtDateShort, fmtDecimal } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import type { RecoveryDayView } from "@joyorogo/api/lib/fit-data";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Hourglass, Moon, Repeat2, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DayChart, Legend, legendOf } from "@/components/charts";
import type { DaySeries } from "@/components/charts";
import { Card, CardHeader, IconChip, PageHeader, Stat } from "@/components/kit";
import { RangeControls } from "@/components/range-controls";
import { SleepStagesCard } from "@/components/sleep-stages";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import {
  type Consistency,
  type DayPoint,
  consistencyOf,
  dayPoints,
  mean,
  sleepStats,
  weekdayAverages,
} from "@/lib/aggregate";
import { fmtSleep } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { orpc } from "@/lib/orpc";
import { type RangeDays, isRange, windowOf } from "@/lib/range";

/** The default (30 days) stays out of the URL. */
type Search = { range?: RangeDays };

export const Route = createFileRoute("/_auth/tidur")({
  component: SleepPage,
  validateSearch: (search: Record<string, unknown>): Search => ({
    range:
      isRange(Number(search.range)) && Number(search.range) !== 30
        ? (Number(search.range) as RangeDays)
        : undefined,
  }),
});

const PAGE = 31;
const col = (rows: readonly DayPoint[], key: keyof DayPoint) => rows.map((r) => r[key]);
const dash = "–";

function SleepPage() {
  const { t } = useTranslation("fitWebSleep");
  usePageTitle(t("title"));
  const range: RangeDays = Route.useSearch().range ?? 30;
  const navigate = Route.useNavigate();
  const win = useMemo(() => windowOf(range), [range]);
  const result = useQuery(orpc.fitWeb.recovery.queryOptions({ input: win }));
  const [shown, setShown] = useState(PAGE);

  const header = (
    <PageHeader
      title={t("title")}
      subtitle={t("subtitle", { from: fmtDateShort(win.from), to: fmtDateShort(win.to) })}
      actions={
        <RangeControls
          range={range}
          onRange={(next) => {
            setShown(PAGE);
            void navigate({ search: { range: next === 30 ? undefined : next }, replace: true });
          }}
        />
      }
    />
  );

  if (result.error) {
    return (
      <>
        {header}
        <Card>
          <QueryError error={result.error} onRetry={() => void result.refetch()} />
        </Card>
      </>
    );
  }
  if (!result.data) {
    return (
      <>
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <BlockSkeleton key={i} className="h-28" />
          ))}
        </div>
        <BlockSkeleton className="mt-4 h-72" />
      </>
    );
  }

  const days = result.data.days;
  if (days.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title={t("empty.title")}>{t("empty.body")}</EmptyState>
        </Card>
      </>
    );
  }

  const rows = dayPoints(win.from, win.to, days);
  const nights = days.filter((d) => d.sleepHours !== null);
  const stats = sleepStats(nights);
  const byWeekday = weekdayAverages(nights);
  return (
    <div className="flex flex-col gap-4">
      {header}
      <Tiles stats={stats} />
      <div className="grid gap-4 lg:grid-cols-2">
        <NightsCard
          rows={rows}
          need={stats.needHours}
          avg={stats.avgHours}
          className="lg:col-span-2"
        />
        <SleepStagesCard from={win.from} to={win.to} />
        <RecoveryCard rows={rows} />
        <WeekdayCard averages={byWeekday} need={stats.needHours} />
        <Card className="overflow-hidden p-0 lg:col-span-2">
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardHeader title={t("table.title")} subtitle={t("table.subtitle")} />
          </div>
          <NightsTable days={days} shown={shown} />
          {shown < days.length && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                {t("table.more")}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tiles({ stats }: { stats: ReturnType<typeof sleepStats> }) {
  const { t } = useTranslation("fitWebSleep");
  const consistency: Consistency | null =
    stats.spreadMin === null ? null : consistencyOf(stats.spreadMin);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={t("tiles.average")}
        value={fmtSleep(stats.avgHours)}
        hint={t("tiles.nights", { count: stats.nights })}
        icon={
          <IconChip className="bg-tidur-soft text-tidur-ink">
            <Moon className="size-4" aria-hidden />
          </IconChip>
        }
      />
      <Stat
        label={t("tiles.need")}
        value={stats.needHours === null ? dash : fmtSleep(stats.needHours)}
        hint={
          stats.nightsMet === null
            ? t("tiles.needUnknown")
            : t("tiles.met", { met: stats.nightsMet, total: stats.nights })
        }
        icon={
          <IconChip className="bg-primary/10 text-primary">
            <Target className="size-4" aria-hidden />
          </IconChip>
        }
      />
      <Stat
        label={t("tiles.debt")}
        value={stats.debtHours === null ? dash : fmtSleep(stats.debtHours)}
        hint={stats.debtHours === null ? t("tiles.needUnknown") : t("tiles.debtHint")}
        tone={
          stats.debtHours !== null && stats.debtHours > 0.5 * stats.nights
            ? "text-destructive"
            : undefined
        }
        icon={
          <IconChip className="bg-bakar-soft text-bakar-ink">
            <Hourglass className="size-4" aria-hidden />
          </IconChip>
        }
      />
      <Stat
        label={t("tiles.consistency")}
        value={
          stats.spreadMin === null ? dash : t("tiles.spread", { min: Math.round(stats.spreadMin) })
        }
        hint={consistency ? t(`tiles.band.${consistency}`) : t("tiles.consistencyUnknown")}
        tone={
          consistency === "irregular"
            ? "text-destructive"
            : consistency === "steady"
              ? "text-recovery"
              : undefined
        }
        icon={
          <IconChip className="bg-recovery/15 text-recovery">
            <Repeat2 className="size-4" aria-hidden />
          </IconChip>
        }
      />
    </div>
  );
}

function NightsCard({
  rows,
  need,
  avg,
  className,
}: {
  rows: readonly DayPoint[];
  need: number | null;
  avg: number | null;
  className?: string;
}) {
  const { t } = useTranslation("fitWebSleep");
  const series: DaySeries[] = [
    {
      key: "sleepHours",
      label: t("nights.hours"),
      color: "var(--tidur)",
      kind: "bar",
      digits: 1,
      unit: t("nights.hoursUnit"),
    },
  ];
  const target = need ?? avg;
  return (
    <Card className={className}>
      <CardHeader
        title={t("nights.title")}
        subtitle={need === null ? t("nights.subtitleAverage") : t("nights.subtitleNeed")}
      />
      <DayChart
        rows={rows}
        series={series}
        summary={t("nights.aria", { avg: fmtSleep(avg) })}
        height={260}
        referenceY={target === null ? undefined : Number(target.toFixed(2))}
      />
      <Legend
        items={[
          { label: t("nights.hours"), color: "var(--tidur)", bar: true },
          ...(target === null
            ? []
            : [
                {
                  label:
                    need === null
                      ? t("nights.average", { value: fmtSleep(target) })
                      : t("nights.need", { value: fmtSleep(target) }),
                  color: "var(--muted-foreground)",
                  dashed: true,
                },
              ]),
        ]}
      />
    </Card>
  );
}

function RecoveryCard({ rows }: { rows: readonly DayPoint[] }) {
  const { t } = useTranslation("fitWebSleep");
  const has = rows.some(
    (r) => r.recoveryPct !== null || r.hrvMs !== null || r.restingHrBpm !== null,
  );
  const series: DaySeries[] = [
    {
      key: "recoveryPct",
      label: t("recovery.recovery"),
      color: "var(--recovery)",
      kind: "area",
      digits: 0,
      unit: "%",
    },
    {
      key: "hrvMs",
      label: t("recovery.hrv"),
      color: "var(--primary)",
      kind: "line",
      axis: "right",
      digits: 0,
      unit: "ms",
    },
    {
      key: "restingHrBpm",
      label: t("recovery.resting"),
      color: "var(--heart)",
      kind: "line",
      axis: "right",
      digits: 0,
      unit: "bpm",
    },
  ];
  return (
    <Card>
      <CardHeader title={t("recovery.title")} subtitle={t("recovery.subtitle")} />
      {has ? (
        <>
          <DayChart
            rows={rows}
            series={series}
            summary={t("recovery.aria", {
              avg: fmtDecimal(mean(col(rows, "recoveryPct") as (number | null)[]) ?? 0, 0),
            })}
            domain={[0, 100]}
          />
          <Legend items={legendOf(series)} />
        </>
      ) : (
        <p className="grid h-40 place-items-center px-4 text-center text-sm text-muted-foreground">
          {t("recovery.empty")}
        </p>
      )}
    </Card>
  );
}

/** Average sleep by weekday as plain bars: seven numbers read faster as a list than as a chart. */
function WeekdayCard({ averages, need }: { averages: (number | null)[]; need: number | null }) {
  const { t } = useTranslation("fitWebSleep");
  const names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const max = Math.max(need ?? 0, ...averages.map((a) => a ?? 0), 1);
  return (
    <Card>
      <CardHeader title={t("weekday.title")} subtitle={t("weekday.subtitle")} />
      <ul className="flex flex-col gap-2.5">
        {names.map((name, i) => {
          const value = averages[i] ?? null;
          const short = need !== null && value !== null && value < need - 0.25;
          return (
            <li
              key={name}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm"
            >
              <span className="font-semibold text-muted-foreground">
                {t(`weekday.names.${name}`)}
              </span>
              <div className="relative h-3 rounded-full bg-muted" aria-hidden>
                {value !== null && (
                  <div
                    className={cn("h-full rounded-full", short ? "bg-bakar" : "bg-tidur")}
                    style={{ width: `${(value / max) * 100}%` }}
                  />
                )}
                {need !== null && (
                  <div
                    className="absolute top-[-3px] bottom-[-3px] w-0.5 rounded bg-foreground/40"
                    style={{ left: `${(need / max) * 100}%` }}
                  />
                )}
              </div>
              <span className="text-right font-semibold tabular-nums">
                {value === null ? dash : fmtSleep(value)}
              </span>
            </li>
          );
        })}
      </ul>
      {need !== null && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("weekday.legend", { need: fmtSleep(need) })}
        </p>
      )}
    </Card>
  );
}

const READINESS = ["Primed", "Balanced", "Strained", "Run down"] as const;
const SOURCES = ["joyofit", "manual", "health_connect", "apple_health"] as const;

function sourceLabel(
  t: (key: `source.${(typeof SOURCES)[number]}`) => string,
  source: string | null,
): string {
  return (SOURCES as readonly string[]).includes(source ?? "")
    ? t(`source.${source as (typeof SOURCES)[number]}`)
    : (source ?? dash);
}

function NightsTable({ days, shown }: { days: readonly RecoveryDayView[]; shown: number }) {
  const { t } = useTranslation("fitWebSleep");
  const nights = useMemo(
    () =>
      days
        .filter((d) => d.sleepHours !== null || d.recoveryPct !== null)
        .toReversed()
        .slice(0, shown),
    [days, shown],
  );
  const readiness = (word: string | null) =>
    word === null
      ? dash
      : (READINESS as readonly string[]).includes(word)
        ? t(`readiness.${word as (typeof READINESS)[number]}`)
        : word;
  return (
    <>
      {/* Below xl (the sidebar leaves the table too little room): one card per night. */}
      <ul className="grid gap-2 p-3 md:grid-cols-2 xl:hidden">
        {nights.map((d) => (
          <li key={d.date} className="rounded-xl bg-muted/50 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-bold">{fmtDateMedium(d.date)}</p>
              <p className="text-sm font-bold tabular-nums">{fmtSleep(d.sleepHours)}</p>
            </div>
            <dl className="mt-2 grid grid-cols-4 gap-2 text-sm tabular-nums">
              {[
                [t("table.needShort"), d.sleepPct === null ? dash : `${d.sleepPct}%`],
                [t("table.recovery"), d.recoveryPct === null ? dash : `${d.recoveryPct}%`],
                [t("table.hrv"), d.hrvMs === null ? dash : fmtDecimal(d.hrvMs, 0)],
                [t("table.restingShort"), d.restingHrBpm === null ? dash : `${d.restingHrBpm}`],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[0.6875rem] break-words text-muted-foreground">{label}</dt>
                  <dd className="font-semibold break-words">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {[
                d.readiness === null ? null : readiness(d.readiness),
                d.sleepSource === null ? null : sourceLabel(t, d.sleepSource),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>

      {/* Desktop. */}
      <div className="hidden xl:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("table.title")}</caption>
          <thead>
            <tr className="border-y border-border text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                {t("table.date")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t("table.duration")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t("table.need")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t("table.recovery")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t("table.hrv")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t("table.resting")}
              </th>
              <th scope="col" className="px-3 py-3 text-left font-semibold">
                {t("table.readiness")}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                {t("table.source")}
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {nights.map((d) => (
              <tr
                key={d.date}
                className="border-b border-border/60 last:border-0 hover:bg-muted/60"
              >
                <th scope="row" className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">
                  {fmtDateMedium(d.date)}
                </th>
                <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                  {fmtSleep(d.sleepHours)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {d.sleepPct === null ? dash : `${d.sleepPct}%`}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {d.recoveryPct === null ? dash : `${d.recoveryPct}%`}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {d.hrvMs === null ? dash : `${fmtDecimal(d.hrvMs, 0)} ms`}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {d.restingHrBpm === null ? dash : `${d.restingHrBpm} bpm`}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{readiness(d.readiness)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                  {sourceLabel(t, d.sleepSource)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
