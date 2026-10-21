import { eatTone, macroTargets } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

import { useGainIntake } from "@/components/gain/gain-today";
import { useGain } from "@/components/gain/use-gain";
import { CountUp } from "@/components/kit/count-up";
import { Card } from "@/components/kit/surface";
import { MacroLine } from "@/components/macro-line";
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

const BAR_TONE = { ok: "bg-makan", near: "bg-amber-400", over: "bg-destructive" } as const;

/**
 * Day summary card for the diary: eaten kcal as the big number, the target on
 * its right, a thin progress bar in the eat tone, then the macro bars. Protein
 * target is the server's `day.summary.protein.targetG` (1,5 g/kg capped at the
 * healthy range); carb/fat floors come from the engine, so the reference stays
 * one place. Without a target there is nothing to measure against: the number
 * and the macro grams only.
 */
export function MakanSummaryCard({
  eatKcal,
  eatenKcal,
  proteinTargetG,
  totals,
  neutral: neutralProp = false,
}: {
  eatKcal: number | null;
  eatenKcal: number;
  proteinTargetG: number | null;
  totals: MacroTotals;
  /** Hamil / Menyusui: progress toward a need, never an over-target tone. */
  neutral?: boolean;
}) {
  const { t } = useTranslation(["makan", "misc"]);
  const { gain } = useGain();
  const gaining = gain !== null;
  // Under a gain plan nothing is "over": progress toward a need, like Hamil / Menyusui.
  const neutral = neutralProp || gaining;
  const target = eatKcal ?? 0;
  const intake = useGainIntake(target, eatenKcal);
  const over = !neutral && eatKcal !== null && eatenKcal > eatKcal;
  const tone = gaining ? intake.tone : neutral ? "ok" : eatTone(eatenKcal, target);
  const pct = target > 0 ? Math.min(100, (eatenKcal / target) * 100) : 0;
  // carb/fat/fiber floors from the engine; protein target comes from the server
  const budgets = eatKcal !== null ? macroTargets(eatKcal, 70) : null;

  return (
    <Card className="p-5" aria-label={t("misc:macro.summaryTitle")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[2rem] leading-none font-extrabold tracking-tight tabular-nums">
            <CountUp value={eatenKcal} />
          </span>
          <span className="text-sm font-semibold text-muted-foreground">
            {t("makan:diary.summary.unit")}
          </span>
        </p>
        {eatKcal !== null && (
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              over ? "text-bakar-ink" : "text-muted-foreground",
            )}
          >
            {over
              ? t("makan:diary.summary.over", { kcal: fmtInt(eatenKcal - eatKcal) })
              : t("makan:diary.summary.ofTarget", { kcal: fmtInt(eatKcal) })}
          </p>
        )}
      </div>
      {eatKcal !== null && (
        <span
          role="progressbar"
          aria-label={t("misc:macro.eatenOf", { eaten: fmtInt(eatenKcal), budget: fmtInt(eatKcal) })}
          aria-valuemin={0}
          aria-valuemax={Math.round(eatKcal)}
          aria-valuenow={Math.round(Math.min(eatenKcal, eatKcal))}
          className="mt-3 block h-2 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={cn("block h-full rounded-full", BAR_TONE[tone])}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
      {gaining && eatKcal !== null && (
        <p className="mt-3 text-sm leading-snug font-semibold text-makan-ink">{intake.line}</p>
      )}
      {budgets && proteinTargetG !== null ? (
        <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <MacroBar macro="protein" eaten={totals.protein} budget={proteinTargetG} neutral={neutral} />
          <MacroBar macro="carbs" eaten={totals.carbs} budget={budgets.carbsG} neutral={neutral} />
          <MacroBar macro="fat" eaten={totals.fat} budget={budgets.fatG} neutral={neutral} />
          <MacroBar macro="fiber" eaten={totals.fiber} budget={budgets.fiberG} neutral={neutral} />
        </div>
      ) : (
        <MacroLine
          className="mt-3 text-sm text-muted-foreground"
          protein={totals.protein}
          carbs={totals.carbs}
          fat={totals.fat}
          fiber={totals.fiber}
        />
      )}
    </Card>
  );
}
