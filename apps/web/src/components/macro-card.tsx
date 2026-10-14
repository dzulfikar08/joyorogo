import { eatTone, macroTargets } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";

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

function MacroBar({ macro, eaten, budget }: { macro: MacroKey; eaten: number; budget: number }) {
  const { label, Icon, tone } = MACRO_META[macro];
  const over = eaten > budget;
  const pct = budget > 0 ? Math.min(100, Math.max(0, (eaten / budget) * 100)) : 0;
  return (
    <div
      className="grid grid-cols-[4.75rem_1fr_auto] items-center gap-2"
      title={`${label}: ${fmtInt(eaten)} dari ${fmtInt(budget)} g`}
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
}: {
  eatKcal: number;
  eatenKcal: number;
  proteinTargetG: number;
  totals: MacroTotals;
}) {
  // carb/fat/fiber floors from the engine; protein target comes from the server
  const budgets = macroTargets(eatKcal, 70);
  const over = eatenKcal > eatKcal;

  return (
    <Card className="p-6" aria-label="Ringkasan kalori hari ini">
      <div className="flex items-center gap-6">
        <Ring
          metric="makan"
          value={eatenKcal}
          max={eatKcal}
          size={124}
          stroke={12}
          tone={eatTone(eatenKcal, eatKcal)}
          label={`Dimakan ${fmtInt(eatenKcal)} dari ${fmtInt(eatKcal)} kcal`}
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
              {over ? `+${fmtInt(eatenKcal - eatKcal)} lebih` : `dari ${fmtInt(eatKcal)}`}
            </p>
          </div>
        </Ring>
        <div className="min-w-0 flex-1 space-y-3.5">
          <MacroBar macro="protein" eaten={totals.protein} budget={proteinTargetG} />
          <MacroBar macro="carbs" eaten={totals.carbs} budget={budgets.carbsG} />
          <MacroBar macro="fat" eaten={totals.fat} budget={budgets.fatG} />
          <MacroBar macro="fiber" eaten={totals.fiber} budget={budgets.fiberG} />
        </div>
      </div>
    </Card>
  );
}
