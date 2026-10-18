import { eatTone, macroTargets } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

import { useGainIntake } from "@/components/gain/gain-today";
import { useGain } from "@/components/gain/use-gain";
import { Ring } from "@/components/kit/ring";
import { Card } from "@/components/kit/surface";
import { fmtInt } from "@/lib/format";
import { MACRO_META, type MacroKey } from "@/lib/macro-icons";

export type MacroTotals = {
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

function MacroBar({
  macro,
  eaten,
  budget,
  neutral,
}: {
  macro: MacroKey;
  eaten: number;
  budget: number;
  neutral: boolean;
}) {
  const { t } = useTranslation("misc");
  const { label, Icon, tone } = MACRO_META[macro];
  const over = !neutral && eaten > budget;
  const pct = budget > 0 ? Math.min(100, Math.max(0, (eaten / budget) * 100)) : 0;
  return (
    <div
      className="grid grid-cols-[4.75rem_1fr_auto] items-center gap-2"
      title={t("macro.progress", { label, eaten: fmtInt(eaten), budget: fmtInt(budget), unit: "g" })}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className={cn("size-3.5 shrink-0", tone)} aria-hidden />
        {label}
      </span>
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(budget)}
        aria-valuenow={Math.round(Math.min(eaten, budget))}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        {/* Over budget is ink + terracotta per the design, never alarm red. */}
        <span
          className={cn("block h-full rounded-full", over ? "bg-bakar" : "bg-makan")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={cn(
          "text-xs tabular-nums",
          over ? "font-bold text-bakar-ink" : "font-semibold text-muted-foreground",
        )}
      >
        {fmtInt(eaten)}/{fmtInt(budget)}
        <span className="ml-0.5 text-[0.625rem]">g</span>
      </span>
    </div>
  );
}

/**
 * Day summary strip for the diary: a compact makan ring (eaten vs budget) and
 * the macro bars. Protein target is the server's `day.summary.protein.targetG`
 * (1,5 g/kg capped at the healthy range); carb/fat floors come from the
 * engine, so the reference stays one place.
 */
export function MakanSummaryCard({
  eatKcal,
  eatenKcal,
  proteinTargetG,
  totals,
  neutral: neutralProp = false,
}: {
  eatKcal: number;
  eatenKcal: number;
  proteinTargetG: number;
  totals: MacroTotals;
  /** Hamil / Menyusui: progress toward a need, never an over-target tone. */
  neutral?: boolean;
}) {
  const { t } = useTranslation("misc");
  const { gain } = useGain();
  const gaining = gain !== null;
  // Under a gain plan nothing is "over": progress toward a need, like Hamil / Menyusui.
  const neutral = neutralProp || gaining;
  const intake = useGainIntake(eatKcal, eatenKcal);
  // carb/fat/fiber floors from the engine; protein target comes from the server
  const budgets = macroTargets(eatKcal, 70);
  const over = !neutral && eatenKcal > eatKcal;

  return (
    <Card className="p-6" aria-label={t("macro.summaryTitle")}>
      <div className="flex items-center gap-6">
        <Ring
          metric="makan"
          value={eatenKcal}
          max={eatKcal}
          size={124}
          stroke={12}
          tone={gaining ? intake.tone : neutral ? "ok" : eatTone(eatenKcal, eatKcal)}
          label={t("macro.eatenOf", { eaten: fmtInt(eatenKcal), budget: fmtInt(eatKcal) })}
        >
          <div>
            <p className="text-[1.375rem] leading-none font-extrabold tracking-tight tabular-nums">
              {fmtInt(eatenKcal)}
            </p>
            <p className="mt-1 text-[0.6875rem] font-semibold text-muted-foreground">kcal</p>
            <p
              className={cn(
                "mt-0.5 text-[0.625rem] font-semibold tabular-nums",
                over ? "text-bakar-ink" : "text-muted-foreground",
              )}
            >
              {over
                ? t("macro.over", { kcal: fmtInt(eatenKcal - eatKcal) })
                : t("macro.ofTarget", { kcal: fmtInt(eatKcal) })}
            </p>
          </div>
        </Ring>
        <div className="min-w-0 flex-1 space-y-3.5">
          <MacroBar macro="protein" eaten={totals.protein} budget={proteinTargetG} neutral={neutral} />
          <MacroBar macro="carbs" eaten={totals.carbs} budget={budgets.carbsG} neutral={neutral} />
          <MacroBar macro="fat" eaten={totals.fat} budget={budgets.fatG} neutral={neutral} />
          <MacroBar macro="fiber" eaten={totals.fiber} budget={budgets.fiberG} neutral={neutral} />
        </div>
      </div>
      {gaining && (
        <p className="mt-4 text-sm leading-snug font-semibold text-makan-ink">{intake.line}</p>
      )}
    </Card>
  );
}
