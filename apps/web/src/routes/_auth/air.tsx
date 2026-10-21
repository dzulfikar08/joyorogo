import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";

import { BarChart, type BarChartDatum } from "@/components/kit/bar-chart";
import { ErrorNote } from "@/components/kit/error-note";
import { Card, Page, PageHeader, Segmented } from "@/components/kit/surface";
import { WaterCard } from "@/components/water-card";
import { fmtDateShort, fmtDecimal } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/air")({
  component: AirPage,
});

type Range = "7" | "30";

/** Longest range the chart offers; the 7-day view is its last week. */
const LONG_RANGE = 30;
/** The 30-day axis names every 5th day, counting back from today. */
const LABEL_EVERY = 5;

/** Water: today's glass counter, then glasses per day against the daily goal. */
function AirPage() {
  const { t } = useTranslation(["home", "common"]);
  return (
    <Page className="max-w-xl">
      <Link
        to="/beranda"
        className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronLeft className="size-5" aria-hidden />
        {t("common:actions.back")}
      </Link>
      <PageHeader title={t("tile.water")} className="pt-0 pb-3" />
      <div className="space-y-3">
        <WaterCard />
        <TrendCard />
      </div>
    </Page>
  );
}

function TrendCard() {
  const { t, i18n } = useTranslation("home");
  const [range, setRange] = useState<Range>("7");
  const today = jakartaToday();
  const series = useQuery(
    orpc.water.series.queryOptions({
      input: { from: shiftDate(today, 1 - LONG_RANGE), to: today },
    }),
  );

  const weekday = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: "UTC" }),
    [i18n.language],
  );

  const goal = series.data?.goal ?? 8;
  const days = useMemo(
    () => series.data?.days.slice(-Number(range)) ?? [],
    [series.data, range],
  );
  const total = days.reduce((sum, day) => sum + day.glasses, 0);
  const hit = days.filter((day) => day.glasses >= goal).length;

  const data: BarChartDatum[] = days.map((day, index) => {
    const name = relativeDayLabel(day.date, today);
    return {
      key: day.date,
      value: day.glasses,
      label:
        range === "7"
          ? weekday.format(new Date(`${day.date}T00:00:00Z`))
          : (days.length - 1 - index) % LABEL_EVERY === 0
            ? fmtDateShort(day.date)
            : undefined,
      readout: t("water.trend.readout", { date: name, count: day.glasses, goal }),
      ariaLabel: t("water.trend.a11yDay", { date: name, count: day.glasses }),
    };
  });

  const summary = t("water.trend.summary", {
    avg: fmtDecimal(days.length > 0 ? total / days.length : 0, 1),
    hit,
    total: days.length,
  });

  return (
    <Card className="p-4">
      <h2 className="text-base font-bold tracking-tight">{t("water.trend.title")}</h2>
      <Segmented<Range>
        className="mt-3"
        label={t("water.trend.title")}
        value={range}
        onChange={setRange}
        options={[
          { value: "7", label: t("water.trend.range7") },
          { value: "30", label: t("water.trend.range30") },
        ]}
      />
      <div className="mt-4">
        {series.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : series.error ? (
          <ErrorNote message={t("water.loadError")} onRetry={() => void series.refetch()} />
        ) : total === 0 ? (
          <p className="rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
            {t("water.trend.empty")}
          </p>
        ) : (
          <>
            <BarChart
              data={data}
              target={goal}
              hint={t("water.trend.hint")}
              ariaLabel={t("water.trend.a11y", { goal, days: summary })}
            />
            <p className="mt-3 text-sm font-semibold text-muted-foreground tabular-nums">{summary}</p>
          </>
        )}
      </div>
    </Card>
  );
}
