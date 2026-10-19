import { cn } from "@joyorogo/ui/lib/utils";
import { ArrowDown, ArrowUp, Check, Info } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { MetaLine } from "@/components/meta-line";
import type { MealPlanDay } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";

type Target = number | readonly [number, number];

/** A tick at the target, or a band over the target range, with the day's total as the bar. */
function TargetBar({
  label,
  total,
  target,
  ok,
  value,
  of,
  valueText,
  status,
}: {
  label: string;
  total: number;
  target: Target;
  ok: boolean;
  value: string;
  of: string;
  valueText: string;
  status?: { tone: "ok" | "off"; icon: ReactNode; text: string };
}) {
  const range = typeof target !== "number";
  const top = range ? target[1] : target;
  // Headroom past the target so an overshoot is visible instead of a full bar.
  const max = Math.max(top * 1.2, total * 1.04, 1);
  const at = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[0.8125rem] font-semibold text-muted-foreground">{label}</span>
        <span className="text-sm tabular-nums">
          <span className="font-bold">{value}</span>{" "}
          <span className="text-muted-foreground">{of}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(Math.min(total, max))}
        aria-valuetext={valueText}
        className="relative mt-1 h-4"
      >
        <span aria-hidden className="absolute inset-x-0 top-1 h-2 rounded-full bg-muted" />
        {range ? (
          <span
            aria-hidden
            className="absolute inset-y-0 rounded-md bg-makan/20 ring-1 ring-makan/50 ring-inset"
            style={{ left: at(target[0]), width: `calc(${at(target[1])} - ${at(target[0])})` }}
          />
        ) : (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: at(target as number) }}
          />
        )}
        <span
          aria-hidden
          className={cn("absolute top-1 h-2 rounded-full", ok ? "bg-makan" : "bg-bakar")}
          style={{ width: at(total) }}
        />
        {range && (
          <span
            aria-hidden
            className={cn(
              "absolute top-0.5 size-3.5 -translate-x-1/2 rounded-full border-2 border-card",
              ok ? "bg-makan" : "bg-bakar",
            )}
            style={{ left: at(total) }}
          />
        )}
      </div>
      {status && (
        <p
          className={cn(
            "mt-1 flex items-start gap-1.5 text-[0.8125rem] leading-snug font-semibold",
            status.tone === "ok" ? "text-makan-ink" : "text-bakar-ink",
          )}
        >
          <span aria-hidden className="mt-0.5 shrink-0 [&>svg]:size-3.5">
            {status.icon}
          </span>
          {status.text}
        </p>
      )}
    </div>
  );
}

/** The day's total against its four targets, split into eaten and still planned. */
export function DayTotals({ day }: { day: MealPlanDay }) {
  const { t } = useTranslation("mealPlan");
  const { total, targets, met } = day;
  const kcal = (n: number) => t("day.unitKcal", { n: fmtInt(n) });
  const grams = (n: number) => t("day.unitG", { n: fmtInt(n) });
  const range = (r: readonly [number, number]) =>
    t("day.range", { min: fmtInt(r[0]), max: fmtInt(r[1]) });
  const within = (n: number, r: readonly [number, number]) => n >= r[0] && n <= r[1];

  const kcalStatus = met.kcal
    ? { tone: "ok" as const, icon: <Check />, text: t("day.kcalOk") }
    : day.kcalDelta > 0
      ? {
          tone: "off" as const,
          icon: <ArrowUp />,
          text: t("day.kcalOver", { kcal: fmtInt(day.kcalDelta) }),
        }
      : {
          tone: "off" as const,
          icon: <ArrowDown />,
          text: t("day.kcalUnder", { kcal: fmtInt(-day.kcalDelta) }),
        };
  const proteinStatus = met.protein
    ? { tone: "ok" as const, icon: <Check />, text: t("day.proteinOk") }
    : {
        tone: "off" as const,
        icon: <ArrowDown />,
        text: t("day.proteinShort", { g: fmtInt(day.proteinShort) }),
      };

  return (
    <Card aria-labelledby="day-total-title" className="p-5">
      <h2 id="day-total-title" className="text-base font-bold tracking-tight">
        {t("day.total")}
      </h2>
      <p className="mt-0.5 text-[0.8125rem] text-muted-foreground tabular-nums">
        <MetaLine
          items={[
            `${t("day.eaten")} ${kcal(day.eaten.kcal)}`,
            !day.isPast && `${t("day.planned")} ${kcal(day.planned.kcal)}`,
          ]}
        />
      </p>

      <div className="mt-4 space-y-4">
        <TargetBar
          label={t("day.kcal")}
          total={total.kcal}
          target={targets.kcal}
          ok={met.kcal}
          value={fmtInt(total.kcal)}
          of={t("day.of", { target: kcal(targets.kcal) })}
          valueText={`${kcal(total.kcal)} ${t("day.of", { target: kcal(targets.kcal) })}`}
          status={kcalStatus}
        />
        <TargetBar
          label={t("day.protein")}
          total={total.proteinG}
          target={targets.proteinG}
          ok={met.protein}
          value={grams(total.proteinG)}
          of={t("day.of", { target: grams(targets.proteinG) })}
          valueText={`${grams(total.proteinG)} ${t("day.of", { target: grams(targets.proteinG) })}`}
          status={proteinStatus}
        />
        <TargetBar
          label={t("day.carbs")}
          total={total.carbsG}
          target={targets.carbsG}
          ok={within(total.carbsG, targets.carbsG)}
          value={grams(total.carbsG)}
          of={t("day.of", { target: range(targets.carbsG) })}
          valueText={`${grams(total.carbsG)} ${t("day.of", { target: range(targets.carbsG) })}`}
        />
        <TargetBar
          label={t("day.fat")}
          total={total.fatG}
          target={targets.fatG}
          ok={within(total.fatG, targets.fatG)}
          value={grams(total.fatG)}
          of={t("day.of", { target: range(targets.fatG) })}
          valueText={`${grams(total.fatG)} ${t("day.of", { target: range(targets.fatG) })}`}
        />
      </div>

      <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-[0.8125rem] leading-snug text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {targets.source === "live" ? t("day.sourceLive") : t("day.sourceBase")}
      </p>
    </Card>
  );
}
