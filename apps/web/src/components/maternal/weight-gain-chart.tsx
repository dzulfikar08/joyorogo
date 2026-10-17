import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WeightGainChart as GainChartData } from "@joyorogo/api/lib/maternal";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { fmtDecimal } from "@joyorogo/i18n";

import { Card } from "@/components/kit/surface";
import { fmtDateMedium, fmtKg } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const PAD = { top: 14, right: 14, bottom: 28, left: 36 };
const TERM_WEEK = 40;
const X_TICKS = [0, 10, 20, 30, 40];
const STEPS = [1, 2, 5, 10] as const;

/** Callback ref + observer: the chart container mounts only after the query resolved. */
function useChartWidth() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const update = () => el.clientWidth > 0 && setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return { ref: setEl, width };
}

/** Weeks 0..40 on x, kilograms gained since the pre-pregnancy weight on y, the IOM band shaded. */
function GainSvg({ data, width, height }: { data: GainChartData; width: number; height: number }) {
  const { t } = useTranslation("maternal");
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const gains = data.points.map((p) => p.gainKg);
  const hiData = Math.max(data.plan.totalMaxKg, ...data.band.map((b) => b.maxKg), ...gains);
  const loData = Math.min(0, ...gains, ...data.band.map((b) => b.minKg));
  const step = STEPS.find((s) => (hiData - loData) / s <= 5) ?? 10;
  const lo = Math.floor(loData / step) * step;
  const hi = Math.ceil(hiData / step) * step;
  const x = (week: number) => PAD.left + (Math.min(Math.max(week, 0), TERM_WEEK) / TERM_WEEK) * innerW;
  const y = (kg: number) => PAD.top + (1 - (kg - lo) / (hi - lo)) * innerH;
  const yTicks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

  const edge = (key: "minKg" | "maxKg") =>
    data.band.map((b) => `${x(b.week).toFixed(1)} ${y(b[key]).toFixed(1)}`);
  const bandPath = `M${edge("maxKg").join(" L")} L${edge("minKg").toReversed().join(" L")} Z`;
  const linePath =
    data.points.length > 1
      ? data.points
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.week).toFixed(1)} ${y(p.gainKg).toFixed(1)}`)
          .join(" ")
      : null;
  const last = data.points.at(-1);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="h-auto max-w-full select-none"
      role="img"
      aria-label={t("gain.chartLabel")}
    >
      <g className="stroke-border/70">
        {yTicks.map((tick) => (
          <line key={tick} x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} strokeWidth={1} />
        ))}
      </g>
      {/* trimester boundaries, quiet */}
      <g className="stroke-border" strokeDasharray="2 4">
        {[14, 28].map((w) => (
          <line key={w} x1={x(w)} x2={x(w)} y1={PAD.top} y2={PAD.top + innerH} strokeWidth={1} />
        ))}
      </g>
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={y(0)}
        y2={y(0)}
        strokeWidth={1.25}
        className="stroke-muted-foreground/40"
      />
      <path d={bandPath} className="fill-makan/20 stroke-makan/50" strokeWidth={1} strokeLinejoin="round" />
      <g fontSize={11} fontWeight={600} className="fill-muted-foreground">
        {yTicks.map((tick) => (
          <text key={tick} x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
            {fmtDecimal(tick, 0)}
          </text>
        ))}
      </g>
      <g fontSize={11} fontWeight={500} className="fill-muted-foreground">
        {X_TICKS.map((w, i) => (
          <text
            key={w}
            x={x(w)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === X_TICKS.length - 1 ? "end" : "middle"}
          >
            {w}
          </text>
        ))}
      </g>
      {linePath && (
        <path
          d={linePath}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-primary"
        />
      )}
      {data.points.map((p) => (
        <circle
          key={p.date}
          cx={x(p.week)}
          cy={y(p.gainKg)}
          r={p === last ? 4.5 : 3}
          className={p === last ? "fill-primary stroke-card" : "fill-primary/50"}
          strokeWidth={p === last ? 2 : 0}
        >
          <title>
            {t("gain.current", {
              gain: fmtKg(p.gainKg),
              week: fmtDecimal(p.week, 1),
              min: fmtKg(data.band[Math.round(Math.min(Math.max(p.week, 0), TERM_WEEK))]!.minKg),
              max: fmtKg(data.band[Math.round(Math.min(Math.max(p.week, 0), TERM_WEEK))]!.maxKg),
            })}{" "}
            {fmtDateMedium(p.date)}
          </title>
        </circle>
      ))}
    </svg>
  );
}

const STATUS_TONE = {
  within: "bg-makan-soft text-makan-ink",
  below: "bg-muted text-foreground",
  above: "bg-muted text-foreground",
} as const;

/** Berat page: the pregnancy weight-gain chart against the IOM 2009 band. */
export function WeightGainCard({ onWeigh }: { onWeigh: () => void }) {
  const { t } = useTranslation("maternal");
  const chartQuery = useQuery(orpc.weight.pregnancyChart.queryOptions());
  const size = useChartWidth();
  const data = chartQuery.data;

  if (chartQuery.isPending) return <Skeleton className="h-72 rounded-3xl" />;
  if (!data) return null;
  const { plan, current } = data;
  const twinsRange = plan.twins;

  return (
    <Card aria-label={t("gain.title")} className="p-4 sm:p-5">
      <h2 className="text-base font-bold tracking-tight">{t("gain.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("gain.subtitle")}</p>

      {current ? (
        <div className={cn("mt-3 rounded-2xl p-3.5", STATUS_TONE[current.status])}>
          <p className="text-sm font-bold tabular-nums">
            {t("gain.current", {
              gain: fmtKg(current.gainKg),
              week: fmtDecimal(current.week, 1),
              min: fmtKg(current.bandMinKg),
              max: fmtKg(current.bandMaxKg),
            })}
          </p>
          <p className="mt-1 text-sm leading-snug">{t(`gain.status.${current.status}`)}</p>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-muted p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("gain.empty")}</p>
          <Button className="mt-3" variant="secondary" onClick={onWeigh}>
            {t("gain.weighIn")}
          </Button>
        </div>
      )}

      <div ref={size.ref} className={cn("mt-3", !size.width && "h-48")}>
        {size.width && (
          <GainSvg data={data} width={size.width} height={size.width < 480 ? 210 : 260} />
        )}
      </div>
      <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm border border-makan/50 bg-makan/20" />
          {t("gain.band")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-primary" />
          {t("gain.you")}
        </li>
        <li className="ml-auto">{t("gain.axis.week")}</li>
      </ul>

      <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-sm">
        <p className="tabular-nums">{t("gain.preWeight", { kg: fmtKg(plan.prePregnancyWeightKg) })}</p>
        <p className="tabular-nums">
          {t("gain.bmi", {
            bmi: fmtDecimal(plan.bmi, 1),
            category: t(`gain.category.${plan.category}`),
          })}
        </p>
        <p className="tabular-nums">
          {t(twinsRange ? "gain.totalTwins" : "gain.total", {
            min: fmtKg(plan.totalMinKg),
            max: fmtKg(plan.totalMaxKg),
          })}
        </p>
        {plan.weeklyRateKg && (
          <p className="tabular-nums">
            {t("gain.rate", {
              min: fmtKg(plan.weeklyRateKg.minKg),
              max: fmtKg(plan.weeklyRateKg.maxKg),
            })}
          </p>
        )}
      </div>
      {plan.borrowedRange && (
        <p className="mt-3 rounded-2xl bg-muted px-4 py-3 text-sm leading-snug text-muted-foreground">
          {t("notes.TWINS_UNDERWEIGHT")}
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("gain.source")}</p>
    </Card>
  );
}
