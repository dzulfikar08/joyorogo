import { fmtClock, fmtDateMedium, fmtDateShort, fmtDecimal } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Select } from "@joyorogo/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardHeader } from "@/components/kit";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import { fmtHm } from "@/lib/format";
import { sleepStagesQuery } from "@/lib/queries";
import {
  CHART_ORDER,
  type SleepDay,
  type SleepNight,
  type SleepResponse,
  type Stage,
  averageStages,
  hypnogram,
  stageShare,
  stagesPresent,
} from "@/lib/sleep-stages";

const COLOR: Record<Stage, string> = {
  awake: "var(--stage-awake)",
  rem: "var(--stage-rem)",
  light: "var(--stage-light)",
  deep: "var(--stage-deep)",
  asleep: "var(--muted-foreground)",
};

/** Sleep stages per night from the JoyoFit cloud: a stage chart of one night at a time, and the nights side by side. */
export function SleepStagesCard({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation("fitWebSleep");
  const { clamped, options } = sleepStagesQuery(from, to);
  const result = useQuery(options);
  // Newest night first for the picker; the composition chart reads oldest to newest.
  const nights = useMemo(
    () => (result.data?.days ?? []).filter((d) => d.night !== null).toReversed(),
    [result.data],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const selected = nights.find((d) => d.day === picked) ?? nights[0];
  const index = selected ? nights.indexOf(selected) : -1;

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={t("stages.title")}
        subtitle={
          clamped !== from ? `${t("stages.subtitle")} ${t("stages.window")}` : t("stages.subtitle")
        }
      />
      {result.error ? (
        <QueryError error={result.error} onRetry={() => void result.refetch()} />
      ) : !result.data ? (
        <BlockSkeleton className="h-64" />
      ) : nights.length === 0 || !selected ? (
        <EmptyState title={t("stages.empty.title")}>{t("stages.empty.body")}</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("stages.previous")}
              disabled={index >= nights.length - 1}
              onClick={() => setPicked((nights[index + 1] as SleepDay).day)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Select<string>
              label={t("stages.pick")}
              searchLabel={t("stages.search")}
              noResults={t("stages.noMatch")}
              value={selected.day}
              onChange={setPicked}
              options={nights.map((d) => ({ value: d.day, label: fmtDateMedium(d.day) }))}
              className="min-w-0 flex-1 sm:w-64 sm:flex-none"
            />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("stages.next")}
              disabled={index <= 0}
              onClick={() => setPicked((nights[index - 1] as SleepDay).day)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>

          <Night day={selected} />
          <Composition days={result.data.days} />
          <Averages days={result.data.days} />
        </div>
      )}
    </Card>
  );
}

function stageSummary(night: SleepNight, t: (key: `stages.names.${Stage}`) => string): string {
  return stagesPresent(night)
    .map((stage) => `${t(`stages.names.${stage}`)} ${fmtHm(night.stages[stage])}`)
    .join(", ");
}

function Night({ day }: { day: SleepDay }) {
  const { t } = useTranslation("fitWebSleep");
  const night = day.night as SleepNight;
  const { bars, rows } = hypnogram(night);
  const ROW = 28;
  const height = rows.length * ROW;
  const mid = new Date(((night.start + night.end) / 2) * 1000);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <p className="mb-3 text-sm font-semibold tabular-nums">
          {t("stages.night.window", {
            start: fmtClock(new Date(night.start * 1000)),
            end: fmtClock(new Date(night.end * 1000)),
          })}
          <span className="font-normal text-muted-foreground">
            {" · "}
            {t("stages.night.asleep")} {fmtHm(night.asleepSec)} · {t("stages.night.awake")}{" "}
            {fmtHm(night.awakeSec)} · {t("stages.night.awakenings", { count: night.awakenings })}
          </span>
        </p>
        <div
          role="img"
          aria-label={t("stages.hypnogram.aria", {
            day: fmtDateMedium(day.day),
            summary: stageSummary(night, t),
          })}
        >
          <div className="flex gap-2">
            <div
              className="flex w-14 shrink-0 flex-col text-[0.6875rem] text-muted-foreground sm:w-16"
              style={{ height }}
            >
              {rows.map((stage) => (
                <span key={stage} className="flex items-center" style={{ height: ROW }}>
                  {t(`stages.names.${stage}`)}
                </span>
              ))}
            </div>
            <svg
              viewBox={`0 0 1000 ${height}`}
              preserveAspectRatio="none"
              className="min-w-0 flex-1 overflow-hidden rounded-lg bg-muted/50"
              style={{ height }}
              aria-hidden
            >
              {rows.map((stage, i) => (
                <line
                  key={stage}
                  x1="0"
                  x2="1000"
                  y1={i * ROW + ROW / 2}
                  y2={i * ROW + ROW / 2}
                  stroke="var(--border)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="3 5"
                />
              ))}
              {bars.map((bar, i) => (
                <rect
                  key={i}
                  x={bar.x * 1000}
                  y={bar.row * ROW + 4}
                  width={Math.max(bar.width * 1000, 1.5)}
                  height={ROW - 8}
                  rx="3"
                  fill={COLOR[bar.stage]}
                />
              ))}
            </svg>
          </div>
          <div className="mt-1 flex justify-between pl-16 text-[0.6875rem] text-muted-foreground tabular-nums sm:pl-[4.5rem]">
            <span>{fmtClock(new Date(night.start * 1000))}</span>
            <span>{fmtClock(mid)}</span>
            <span>{fmtClock(new Date(night.end * 1000))}</span>
          </div>
        </div>
        {!night.hasStages && (
          <p className="mt-3 text-xs text-muted-foreground">{t("stages.night.noStages")}</p>
        )}
      </div>

      <div>
        <ul aria-label={t("stages.list.label")} className="flex flex-col gap-3">
          {stagesPresent(night).map((stage) => (
            <li
              key={stage}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: COLOR[stage] }}
                />
                {t(`stages.names.${stage}`)}
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                {fmtHm(night.stages[stage])}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {fmtDecimal(stageShare(night, stage), 0)}%
                </span>
              </span>
              <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${stageShare(night, stage)}%`, background: COLOR[stage] }}
                />
              </div>
            </li>
          ))}
        </ul>
        {day.naps.length > 0 && (
          <div className="mt-5 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground">{t("stages.naps.title")}</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm tabular-nums">
              {day.naps.map((nap) => (
                <li key={nap.start}>
                  {t("stages.naps.item", {
                    start: fmtClock(new Date(nap.start * 1000)),
                    end: fmtClock(new Date(nap.end * 1000)),
                    duration: fmtHm(nap.asleepSec),
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Composition({ days }: { days: readonly SleepDay[] }) {
  const { t } = useTranslation("fitWebSleep");
  const rows = days
    .filter((d) => d.night !== null)
    .map((d) => {
      const n = d.night as SleepNight;
      return {
        day: d.day,
        awake: n.stages.awake / 3600,
        rem: n.stages.rem / 3600,
        light: n.stages.light / 3600,
        deep: n.stages.deep / 3600,
        asleep: n.stages.asleep / 3600,
      };
    });
  if (rows.length < 2) return null;
  const present = CHART_ORDER.filter((stage) => rows.some((r) => r[stage] > 0));
  // Deep sits at the bottom of the stack like it does at the bottom of the night's chart.
  const stack = present.toReversed();
  return (
    <div>
      <h3 className="text-sm font-bold">{t("stages.composition.title")}</h3>
      <p className="mb-2 text-xs text-muted-foreground">{t("stages.composition.subtitle")}</p>
      <div
        role="img"
        aria-label={t("stages.composition.aria", { count: rows.length })}
        className="h-56 w-full min-w-0"
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 4" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickFormatter={(d: string) => fmtDateShort(d)}
              interval="preserveStartEnd"
              minTickGap={28}
              tickMargin={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={32}
              tickFormatter={(v: number) => fmtDecimal(v, 0)}
            />
            <Tooltip
              content={<StageTooltip />}
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              isAnimationActive={false}
            />
            {stack.map((stage, i) => (
              <Bar
                key={stage}
                dataKey={stage}
                stackId="stages"
                fill={COLOR[stage]}
                maxBarSize={22}
                radius={i === stack.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {present.map((stage) => (
          <li key={stage} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ background: COLOR[stage] }}
            />
            {t(`stages.names.${stage}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StageTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: Record<string, number | string> }[];
}) {
  const { t } = useTranslation("fitWebSleep");
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="min-w-36 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1 font-bold">{fmtDateShort(String(row.day))}</p>
      <ul className="flex flex-col gap-0.5">
        {CHART_ORDER.filter((stage) => Number(row[stage]) > 0).map((stage) => (
          <li key={stage} className="flex items-center justify-between gap-4 tabular-nums">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                aria-hidden
                className="size-2 rounded-sm"
                style={{ background: COLOR[stage] }}
              />
              {t(`stages.names.${stage}`)}
            </span>
            <span className="font-semibold">{fmtHm(Number(row[stage]) * 3600)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Averages({ days }: { days: readonly SleepDay[] }) {
  const { t } = useTranslation("fitWebSleep");
  const avg = averageStages(days);
  if (!avg) return null;
  const items: { stage: Stage; seconds: number }[] = [
    { stage: "deep", seconds: avg.deep },
    { stage: "rem", seconds: avg.rem },
    { stage: "light", seconds: avg.light },
    { stage: "awake", seconds: avg.awake },
  ];
  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-bold">{t("stages.averages.title")}</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("stages.averages.nights", { count: avg.nights })}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(({ stage, seconds }) => (
          <div key={stage} className="rounded-xl bg-muted/50 p-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="size-2.5 rounded-sm"
                style={{ background: COLOR[stage] }}
              />
              {t(`stages.names.${stage}`)}
            </dt>
            <dd className="mt-1 text-lg font-extrabold tabular-nums">{fmtHm(seconds)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
