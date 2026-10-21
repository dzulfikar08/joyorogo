import { chipGrams, priorLabelKey } from "@joyorogo/api/lib/portion-chip";
import type { PortionPriorChip } from "@joyorogo/api/lib/portion-chip";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

import { fmtGramsLabel } from "@/lib/format";

const chipClass = (active: boolean) =>
  cn(
    "inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
    active
      ? "pressable bg-primary text-primary-foreground"
      : "bg-muted text-foreground hover:bg-border",
  );

/**
 * Under a scan row that has a second portion (lib/portion-prior.ts): "AI: 150 g" and either
 * "Biasanya kamu: 100 g" (the user's own history) or "Biasanya: 100 g" (the typical rice
 * portion), one click to switch. The row's numbers follow the pick (swapPortionPrior).
 */
export function PortionPriorChips({
  name,
  item,
  onSwap,
}: {
  name: string;
  item: { grams?: number; portionPrior?: PortionPriorChip };
  onSwap: () => void;
}) {
  const { t } = useTranslation("scan");
  const grams = chipGrams(item);
  if (!grams) return null;
  const usualActive = item.portionPrior!.active === "prior";
  return (
    <span
      role="group"
      aria-label={t("result.items.priorGroup", { name })}
      className="flex flex-wrap gap-1.5"
    >
      <button
        type="button"
        aria-pressed={!usualActive}
        onClick={usualActive ? onSwap : undefined}
        className={chipClass(!usualActive)}
      >
        {t("result.items.priorAi", { grams: fmtGramsLabel(grams.ai) })}
      </button>
      <button
        type="button"
        aria-pressed={usualActive}
        onClick={usualActive ? undefined : onSwap}
        className={chipClass(usualActive)}
      >
        {t(priorLabelKey(item.portionPrior!), { grams: fmtGramsLabel(grams.usual) })}
      </button>
    </span>
  );
}
