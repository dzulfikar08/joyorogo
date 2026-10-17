import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MaternalInfo, MaternalNutrient } from "@joyorogo/api/lib/maternal";
import { cn } from "@joyorogo/ui/lib/utils";

import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

function TrackedRow({
  n,
  eaten,
  valueText,
  hint,
}: {
  n: MaternalNutrient;
  eaten: number;
  valueText: string;
  hint?: string;
}) {
  const { t } = useTranslation(["maternal", "home"]);
  const goal = n.key === "water" ? 1 : n.target;
  const pct = goal > 0 ? Math.min(100, Math.max(0, (eaten / goal) * 100)) : 0;
  const name = t(`maternal:nutrients.${n.key}.name`);
  const unit = t(`maternal:nutrients.unit.${n.unit}`);
  const baseAndAdd = [
    n.base > 0 ? t("maternal:nutrients.base", { base: `${fmtInt(n.base)} ${unit}` }) : null,
    n.add > 0 ? t("maternal:nutrients.plus", { add: `${fmtInt(n.add)} ${unit}` }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold">{name}</p>
        <p className="text-sm font-semibold tabular-nums">{valueText}</p>
      </div>
      {/* Progress toward the need, one calm colour whatever the value. */}
      <span
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full rounded-full bg-makan" style={{ width: `${pct}%` }} />
      </span>
      <p className="mt-1 text-xs text-muted-foreground">{hint ?? baseAndAdd}</p>
    </li>
  );
}

/**
 * Daily nutrients of a Hamil / Menyusui plan: protein, fiber and water are
 * tracked from the day's data; the rest is "Perhatikan" guidance that
 * JoyoRogo does not measure.
 */
export function NutrientList({
  info,
  date,
  protein,
  className,
  defaultOpenGuidance = false,
}: {
  info: MaternalInfo;
  date: string;
  protein: { eatenG: number; targetG: number } | null;
  className?: string;
  defaultOpenGuidance?: boolean;
}) {
  const { t } = useTranslation(["maternal", "home"]);
  const foods = useQuery(orpc.food.listByDate.queryOptions({ input: { date } }));
  const water = useQuery(orpc.water.today.queryOptions({ input: { date } }));

  const tracked = info.nutrients.filter((n) => n.tracked);
  const guidance = info.nutrients.filter((n) => !n.tracked);
  const unitOf = (n: MaternalNutrient) => t(`maternal:nutrients.unit.${n.unit}`);

  return (
    <div className={className}>
      <p className="text-xs font-semibold text-muted-foreground">{t("maternal:nutrients.trackedTitle")}</p>
      <ul className="mt-2 space-y-3.5">
        {tracked.map((n) => {
          if (n.key === "protein") {
            const eaten = protein?.eatenG ?? 0;
            return (
              <TrackedRow
                key={n.key}
                n={n}
                eaten={eaten}
                valueText={`${fmtInt(eaten)} / ${fmtInt(n.target)} ${unitOf(n)}`}
              />
            );
          }
          if (n.key === "fiber") {
            const eaten = foods.data?.totals.fiber ?? 0;
            return (
              <TrackedRow
                key={n.key}
                n={n}
                eaten={eaten}
                valueText={`${fmtInt(eaten)} / ${fmtInt(n.target)} ${unitOf(n)}`}
              />
            );
          }
          if (n.key === "water") {
            const glasses = water.data?.glasses ?? 0;
            const goal = water.data?.goal ?? 8;
            return (
              <TrackedRow
                key={n.key}
                n={n}
                eaten={goal > 0 ? glasses / goal : 0}
                valueText={`${glasses} ${t("home:water.ofGoal", { count: goal })}`}
                hint={t("maternal:nutrients.water.hint")}
              />
            );
          }
          return null;
        })}
      </ul>

      {guidance.length > 0 && (
        <details className="group mt-4 rounded-2xl bg-muted/60" open={defaultOpenGuidance}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-sm font-bold select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            {t("maternal:nutrients.guidanceTitle")}
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="px-4 pb-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("maternal:nutrients.guidanceNote")}
            </p>
            <ul className="mt-3 divide-y divide-border/70">
              {guidance.map((n) => (
                <li key={n.key} className={cn("py-2.5 first:pt-0 last:pb-0")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-bold">{t(`maternal:nutrients.${n.key}.name`)}</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {fmtInt(n.target)} {unitOf(n)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t(`maternal:nutrients.${n.key}.hint`)}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[0.6875rem] leading-snug text-muted-foreground">
              {t("maternal:nutrients.source")}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
