import { fmtDateShort, fmtDecimal } from "@joyorogo/i18n";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  BedDouble,
  Flame,
  HeartPulse,
  Gauge,
  Route as RouteIcon,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DayChart, Legend, Sparkline, VolumeChart, legendOf } from "@/components/charts";
import type { DaySeries } from "@/components/charts";
import { Card, CardHeader, Delta, IconChip, PageHeader, Segmented, Stat } from "@/components/kit";
import type { Better } from "@/components/kit";
import { RangeControls } from "@/components/range-controls";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import {
  type DayPoint,
  type Metric,
  SPORT_KINDS,
  type VolumeMetric,
  change,
  dayPoints,
  latest,
  mean,
  previousWindow,
  totals,
  weeklyVolume,
} from "@/lib/aggregate";
import { fmtHm, fmtKm, fmtSigned, fmtSleep } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { orpc } from "@/lib/orpc";
import { recoveryQuery, workoutsQuery } from "@/lib/queries";
import { type RangeDays, isRange, windowOf } from "@/lib/range";
import { SPORT_COLOR, sportIcon } from "@/lib/sport";

/** Defaults (30 days, comparing) stay out of the URL, so a plain link to the page needs no search. */
type Search = { range?: RangeDays; compare?: false };

export const Route = createFileRoute("/_auth/")({
  component: OverviewPage,
  loaderDeps: ({ search }) => ({ range: search.range ?? 30, compare: search.compare !== false }),
  // Start the reads before the page renders (and on link hover); the page's own queries pick the same cache entries up.
  loader: ({ context, deps }) => {
    const win = windowOf(deps.range);
    void context.queryClient.prefetchQuery(recoveryQuery(win));
    void context.queryClient.prefetchQuery(workoutsQuery(win));
    if (deps.compare) {
      const before = previousWindow(win.from, win.to);
      void context.queryClient.prefetchQuery(recoveryQuery(before));
      void context.queryClient.prefetchQuery(workoutsQuery(before));
    }
  },
  validateSearch: (search: Record<string, unknown>): Search => ({
    range:
      isRange(Number(search.range)) && Number(search.range) !== 30
        ? (Number(search.range) as RangeDays)
        : undefined,
    compare: search.compare === false || search.compare === "false" ? false : undefined,
  }),
});

const has = (rows: readonly DayPoint[], keys: readonly Metric[]) =>
  rows.some((row) => keys.some((key) => row[key] !== null));
const col = (rows: readonly DayPoint[], key: Metric) => rows.map((row) => row[key]);

function OverviewPage() {
  const { t } = useTranslation("fitWebOverview");
  usePageTitle(t("title"));
  const search = Route.useSearch();
  const range: RangeDays = search.range ?? 30;
  const compare = search.compare !== false;
  const navigate = Route.useNavigate();
  const win = useMemo(() => windowOf(range), [range]);
  const before = useMemo(() => previousWindow(win.from, win.to), [win]);

  const recovery = useQuery(recoveryQuery(win));
  const workouts = useQuery(workoutsQuery(win));
  const previousRecovery = useQuery({
    ...orpc.fitWeb.recovery.queryOptions({ input: before }),
    enabled: compare,
  });
  const previousWorkouts = useQuery({
    ...orpc.fitWeb.workouts.queryOptions({ input: before }),
    enabled: compare,
  });

  // The first render with data is heavy (a dozen charts): show the frame and skeleton first, then fill in at low priority.
  const settled = useDeferredValue(Boolean(recovery.data && workouts.data), false);

  const controls = (
    <RangeControls
      range={range}
      onRange={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, range: next === 30 ? undefined : next }),
          replace: true,
        })
      }
      compare={compare}
      onCompare={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, compare: next ? undefined : false }),
          replace: true,
        })
      }
    />
  );
  const header = (
    <PageHeader
      title={t("title")}
      subtitle={t("subtitle", { from: fmtDateShort(win.from), to: fmtDateShort(win.to) })}
      actions={controls}
    />
  );

  const failure = recovery.error ?? workouts.error;
  if (failure) {
    return (
      <>
        {header}
        <Card>
          <QueryError
            error={failure}
            onRetry={() => {
              void recovery.refetch();
              void workouts.refetch();
            }}
          />
        </Card>
      </>
    );
  }
  if (!recovery.data || !workouts.data || !settled) {
    return (
      <>
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <BlockSkeleton key={i} className="h-32" />
          ))}
        </div>
        <BlockSkeleton className="mt-4 h-72" />
      </>
    );
  }

  const rows = dayPoints(win.from, win.to, recovery.data.days);
  const items = workouts.data.items;
  if (items.length === 0 && recovery.data.days.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title={t("empty.title")}>{t("empty.body")}</EmptyState>
        </Card>
      </>
    );
  }

  const dim = recovery.isPlaceholderData || workouts.isPlaceholderData;
  const prevRows =
    compare && previousRecovery.data
      ? dayPoints(before.from, before.to, previousRecovery.data.days)
      : undefined;
  const prevItems = compare ? previousWorkouts.data?.items : undefined;

  return (
    <div
      aria-busy={dim}
      className={cn("flex flex-col gap-4 transition-opacity", dim && "opacity-60")}
    >
      {header}
      <Tiles rows={rows} prevRows={prevRows} items={items} prevItems={prevItems} />
      <div className="grid gap-4 lg:grid-cols-2">
        <LoadCard rows={rows} prevRows={prevRows} className="lg:col-span-2" />
        <RecoveryCard rows={rows} prevRows={prevRows} />
        <HeartCard rows={rows} prevRows={prevRows} />
        <SleepCard rows={rows} prevRows={prevRows} />
        <VolumeCard items={items} from={win.from} to={win.to} />
        <RecentCard items={items} className="lg:col-span-2" />
      </div>
    </div>
  );
}

// --- Headline tiles -------------------------------------------------------------------------------------------

function useDelta() {
  const { t } = useTranslation("fitWebOverview");
  /** A change as a badge: percent for totals, a plain difference (with its unit) for averages. */
  return (
    cur: number | null,
    prev: number | null | undefined,
    opts: { better: Better; mode: "pct" | "abs"; digits?: number; unit?: string },
  ) => {
    if (prev === undefined) return null;
    const diff = change(cur, prev);
    if (!diff)
      return <span className="text-xs text-muted-foreground">{t("tiles.noPrevious")}</span>;
    const digits = opts.digits ?? 0;
    const amount = opts.mode === "pct" ? diff.pct : diff.abs;
    if (amount === null)
      return <span className="text-xs text-muted-foreground">{t("tiles.noPrevious")}</span>;
    const flat = Number(amount.toFixed(opts.mode === "pct" ? 0 : digits)) === 0;
    const text =
      opts.mode === "pct"
        ? `${fmtSigned(amount)}%`
        : `${fmtSigned(amount, digits)}${opts.unit ? ` ${opts.unit}` : ""}`;
    return (
      <Delta
        text={text}
        direction={flat ? "flat" : amount > 0 ? "up" : "down"}
        better={opts.better}
      />
    );
  };
}

function Tiles({
  rows,
  prevRows,
  items,
  prevItems,
}: {
  rows: readonly DayPoint[];
  prevRows?: readonly DayPoint[];
  items: Parameters<typeof totals>[0];
  prevItems?: Parameters<typeof totals>[0];
}) {
  const { t } = useTranslation("fitWebOverview");
  const delta = useDelta();
  const sum = totals(items);
  const prevSum = prevItems ? totals(prevItems) : undefined;
  const avg = (key: Metric) => mean(col(rows, key));
  const prevAvg = (key: Metric) => (prevRows ? mean(col(prevRows, key)) : undefined);
  const vo2 = latest(col(rows, "vo2maxMlKgMin"));
  const prevVo2 = prevRows ? latest(col(prevRows, "vo2maxMlKgMin")) : undefined;
  const strain = avg("strain");
  const recovery = avg("recoveryPct");
  const hrv = avg("hrvMs");
  const rhr = avg("restingHrBpm");
  const sleep = avg("sleepHours");
  const dash = "–";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={t("tiles.workouts")}
        value={sum.count}
        hint={fmtHm(sum.movingSec)}
        delta={delta(sum.count, prevSum?.count, { better: "none", mode: "abs" })}
        icon={
          <IconChip className="bg-bakar-soft text-bakar-ink">
            <Activity className="size-4" aria-hidden />
          </IconChip>
        }
      />
      <Stat
        label={t("tiles.distance")}
        value={fmtDecimal(sum.distanceM / 1000, sum.distanceM >= 100_000 ? 0 : 1)}
        unit="km"
        hint={t("tiles.elevation", { value: fmtDecimal(sum.elevGainM, 0) })}
        delta={delta(sum.distanceM, prevSum?.distanceM, { better: "none", mode: "pct" })}
        icon={
          <IconChip className="bg-primary/10 text-primary">
            <RouteIcon className="size-4" aria-hidden />
          </IconChip>
        }
      />
      <Stat
        label={t("tiles.strain")}
        value={strain === null ? dash : fmtDecimal(strain, 1)}
        unit={strain === null ? undefined : "/21"}
        delta={delta(strain, prevAvg("strain"), { better: "none", mode: "abs", digits: 1 })}
        hint={t("tiles.average")}
        icon={
          <IconChip className="bg-bakar-soft text-bakar-ink">
            <Flame className="size-4" aria-hidden />
          </IconChip>
        }
      >
        <Sparkline values={col(rows, "strain")} color="var(--bakar)" className="mt-2" />
      </Stat>
      <Stat
        label={t("tiles.recovery")}
        value={recovery === null ? dash : fmtDecimal(recovery, 0)}
        unit={recovery === null ? undefined : "%"}
        delta={delta(recovery, prevAvg("recoveryPct"), { better: "up", mode: "abs", unit: "%" })}
        hint={t("tiles.average")}
        icon={
          <IconChip className="bg-recovery/15 text-recovery">
            <ShieldCheck className="size-4" aria-hidden />
          </IconChip>
        }
      >
        <Sparkline values={col(rows, "recoveryPct")} color="var(--recovery)" className="mt-2" />
      </Stat>
      <Stat
        label={t("tiles.hrv")}
        value={hrv === null ? dash : fmtDecimal(hrv, 0)}
        unit={hrv === null ? undefined : "ms"}
        delta={delta(hrv, prevAvg("hrvMs"), { better: "up", mode: "abs", unit: "ms" })}
        hint={t("tiles.average")}
        icon={
          <IconChip className="bg-primary/10 text-primary">
            <TrendingUp className="size-4" aria-hidden />
          </IconChip>
        }
      >
        <Sparkline values={col(rows, "hrvMs")} color="var(--primary)" className="mt-2" />
      </Stat>
      <Stat
        label={t("tiles.restingHr")}
        value={rhr === null ? dash : fmtDecimal(rhr, 0)}
        unit={rhr === null ? undefined : "bpm"}
        delta={delta(rhr, prevAvg("restingHrBpm"), { better: "down", mode: "abs", unit: "bpm" })}
        hint={t("tiles.average")}
        icon={
          <IconChip className="bg-heart/15 text-heart">
            <HeartPulse className="size-4" aria-hidden />
          </IconChip>
        }
      >
        <Sparkline values={col(rows, "restingHrBpm")} color="var(--heart)" className="mt-2" />
      </Stat>
      <Stat
        label={t("tiles.vo2max")}
        value={vo2 === null ? dash : fmtDecimal(vo2, 1)}
        delta={delta(vo2, prevVo2, { better: "up", mode: "abs", digits: 1 })}
        hint={t("tiles.vo2maxUnit")}
        icon={
          <IconChip className="bg-gram/15 text-gram">
            <Gauge className="size-4" aria-hidden />
          </IconChip>
        }
      >
        <Sparkline values={col(rows, "vo2maxMlKgMin")} color="var(--gram)" className="mt-2" />
      </Stat>
      <Stat
        label={t("tiles.sleep")}
        value={sleep === null ? dash : fmtSleep(sleep)}
        delta={delta(sleep, prevAvg("sleepHours"), {
          better: "up",
          mode: "abs",
          digits: 1,
          unit: t("tiles.hoursUnit"),
        })}
        hint={t("tiles.perNight")}
        icon={
          <IconChip className="bg-tidur-soft text-tidur-ink">
            <BedDouble className="size-4" aria-hidden />
          </IconChip>
        }
      >
        <Sparkline values={col(rows, "sleepHours")} color="var(--tidur)" className="mt-2" />
      </Stat>
    </div>
  );
}

// --- Charts ---------------------------------------------------------------------------------------------------

type CardProps = { rows: readonly DayPoint[]; prevRows?: readonly DayPoint[]; className?: string };

function NoData({ children }: { children: string }) {
  return (
    <p className="grid h-40 place-items-center px-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** The legend entries that explain the dashed lines (or ghost bars) of the period before. */
function previousKey(t: (key: "compare.previousPeriod") => string, show: boolean, bars = false) {
  return show
    ? [
        {
          label: t("compare.previousPeriod"),
          color: "var(--muted-foreground)",
          dashed: !bars,
          block: bars,
        },
      ]
    : [];
}

function LoadCard({ rows, prevRows, className }: CardProps) {
  const { t } = useTranslation("fitWebOverview");
  const { t: tw } = useTranslation("fitWeb");
  const series: DaySeries[] = [
    { key: "strain", label: t("load.strain"), color: "var(--bakar)", kind: "bar", digits: 1 },
    {
      key: "loadRatio",
      label: t("load.ratio"),
      color: "var(--primary)",
      kind: "line",
      axis: "right",
      digits: 2,
    },
  ];
  const ratio = latest(col(rows, "loadRatio"));
  const band =
    ratio === null
      ? null
      : ratio < 0.8
        ? "under"
        : ratio <= 1.3
          ? "steady"
          : ratio <= 1.5
            ? "high"
            : "spike";
  return (
    <Card className={className}>
      <CardHeader
        title={t("load.title")}
        subtitle={t("load.subtitle")}
        action={
          ratio !== null &&
          band && (
            <p className="rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums">
              {t("load.latest", { ratio: fmtDecimal(ratio, 2), band: t(`load.band.${band}`) })}
            </p>
          )
        }
      />
      {has(rows, ["strain", "loadRatio"]) ? (
        <>
          <DayChart
            rows={rows}
            previous={prevRows}
            series={series}
            summary={t("load.aria", { avg: fmtDecimal(mean(col(rows, "strain")) ?? 0, 1) })}
            height={240}
          />
          <Legend items={[...legendOf(series), ...previousKey(tw, !!prevRows, true)]} />
        </>
      ) : (
        <NoData>{t("load.empty")}</NoData>
      )}
    </Card>
  );
}

function RecoveryCard({ rows, prevRows }: CardProps) {
  const { t } = useTranslation("fitWebOverview");
  const { t: tw } = useTranslation("fitWeb");
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
  ];
  return (
    <Card>
      <CardHeader title={t("recovery.title")} subtitle={t("recovery.subtitle")} />
      {has(rows, ["recoveryPct", "hrvMs"]) ? (
        <>
          <DayChart
            rows={rows}
            previous={prevRows}
            series={series}
            summary={t("recovery.aria", {
              avg: fmtDecimal(mean(col(rows, "recoveryPct")) ?? 0, 0),
            })}
            domain={[0, 100]}
          />
          <Legend items={[...legendOf(series), ...previousKey(tw, !!prevRows)]} />
        </>
      ) : (
        <NoData>{t("recovery.empty")}</NoData>
      )}
    </Card>
  );
}

function HeartCard({ rows, prevRows }: CardProps) {
  const { t } = useTranslation("fitWebOverview");
  const { t: tw } = useTranslation("fitWeb");
  const series: DaySeries[] = [
    {
      key: "restingHrBpm",
      label: t("heart.resting"),
      color: "var(--heart)",
      kind: "line",
      digits: 0,
      unit: "bpm",
    },
    {
      key: "vo2maxMlKgMin",
      label: t("heart.vo2max"),
      color: "var(--gram)",
      kind: "line",
      axis: "right",
      digits: 1,
    },
  ];
  return (
    <Card>
      <CardHeader title={t("heart.title")} subtitle={t("heart.subtitle")} />
      {has(rows, ["restingHrBpm", "vo2maxMlKgMin"]) ? (
        <>
          <DayChart
            rows={rows}
            previous={prevRows}
            series={series}
            summary={t("heart.aria", { avg: fmtDecimal(mean(col(rows, "restingHrBpm")) ?? 0, 0) })}
          />
          <Legend items={[...legendOf(series), ...previousKey(tw, !!prevRows)]} />
        </>
      ) : (
        <NoData>{t("heart.empty")}</NoData>
      )}
    </Card>
  );
}

function SleepCard({ rows, prevRows }: CardProps) {
  const { t } = useTranslation("fitWebOverview");
  const { t: tw } = useTranslation("fitWeb");
  const series: DaySeries[] = [
    {
      key: "sleepHours",
      label: t("sleep.hours"),
      color: "var(--tidur)",
      kind: "bar",
      digits: 1,
      unit: t("tiles.hoursUnit"),
    },
  ];
  const avg = mean(col(rows, "sleepHours"));
  return (
    <Card>
      <CardHeader
        title={t("sleep.title")}
        subtitle={t("sleep.subtitle")}
        action={
          <Link
            to="/tidur"
            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("sleep.more")}
          </Link>
        }
      />
      {avg !== null ? (
        <>
          <DayChart
            rows={rows}
            previous={prevRows}
            series={series}
            summary={t("sleep.aria", { avg: fmtSleep(avg) })}
            referenceY={Number(avg.toFixed(2))}
          />
          <Legend
            items={[
              ...legendOf(series),
              {
                label: t("sleep.average", { value: fmtSleep(avg) }),
                color: "var(--muted-foreground)",
                dashed: true,
              },
              ...previousKey(tw, !!prevRows, true),
            ]}
          />
        </>
      ) : (
        <NoData>{t("sleep.empty")}</NoData>
      )}
    </Card>
  );
}

function VolumeCard({
  items,
  from,
  to,
}: {
  items: Parameters<typeof totals>[0];
  from: string;
  to: string;
}) {
  const { t } = useTranslation("fitWebOverview");
  const { t: tw } = useTranslation("fitWeb");
  const [metric, setMetric] = useState<VolumeMetric>("time");
  const rows = useMemo(() => weeklyVolume(items, from, to, metric), [items, from, to, metric]);
  const labels = {
    run: tw("sport.run"),
    walk: tw("sport.walk"),
    ride: tw("sport.ride"),
    swim: tw("sport.swim"),
    other: tw("sport.other"),
  };
  const shown = SPORT_KINDS.filter((kind) => rows.some((row) => row[kind] > 0));
  return (
    <Card>
      <CardHeader
        title={t("volume.title")}
        subtitle={t("volume.subtitle")}
        action={
          <Segmented<VolumeMetric>
            label={t("volume.metric")}
            value={metric}
            onChange={setMetric}
            options={[
              { value: "time", label: t("volume.time") },
              { value: "distance", label: t("volume.distance") },
            ]}
          />
        }
      />
      {shown.length > 0 ? (
        <>
          <VolumeChart
            rows={rows}
            unit={metric === "time" ? t("volume.hoursUnit") : "km"}
            digits={1}
            labels={labels}
            summary={t("volume.aria", { n: items.length })}
          />
          <Legend
            items={shown.map((kind) => ({ label: labels[kind], color: SPORT_COLOR[kind] }))}
          />
        </>
      ) : (
        <NoData>{t("volume.empty")}</NoData>
      )}
    </Card>
  );
}

function RecentCard({
  items,
  className,
}: {
  items: Parameters<typeof totals>[0];
  className?: string;
}) {
  const { t } = useTranslation("fitWebOverview");
  const recent = items.slice(0, 6);
  return (
    <Card className={className}>
      <CardHeader
        title={t("recent.title")}
        action={
          <Link
            to="/latihan"
            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("recent.all")}
          </Link>
        }
      />
      {recent.length === 0 ? (
        <NoData>{t("recent.empty")}</NoData>
      ) : (
        <ul className="divide-y divide-border">
          {recent.map((w) => {
            const Icon = sportIcon(w.sportName, w.sportKind);
            return (
              <li key={w.start}>
                <Link
                  to="/latihan/$start"
                  params={{ start: String(w.start) }}
                  className="-mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <IconChip className="size-9 bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </IconChip>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold">{w.sportName}</span>
                    <span className="block break-words text-xs text-muted-foreground">
                      {fmtDateShort(w.date)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                    {w.distanceM ? fmtKm(w.distanceM) : fmtHm(w.movingSec)}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {w.distanceM ? fmtHm(w.movingSec) : w.avgHr ? `${w.avgHr} bpm` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
