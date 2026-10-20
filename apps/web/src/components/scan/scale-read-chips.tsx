import { scaleGrams, scaleValue } from "@joyorogo/api/lib/scale-chip";
import type { ScaleReadChip } from "@joyorogo/api/lib/scale-chip";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

import { fmtGramsLabel } from "@/lib/format";

const chipClass = (active: boolean) =>
  cn(
    "inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
    active
      ? "pressable bg-primary text-primary-foreground"
      : "bg-muted text-foreground hover:bg-border",
  );

/**
 * Under a scan row whose weight was read off a kitchen-scale display in the
 * photo (lib/scale-reading.ts): "Terbaca dari timbangan: 100 g" and "Perkiraan
 * foto: 150 g", one click to switch. The row's numbers follow the pick
 * (swapScaleRead); the grams can still be corrected in the box below.
 */
export function ScaleReadChips({
  name,
  item,
  onSwap,
}: {
  name: string;
  item: { grams?: number; scaleRead?: ScaleReadChip };
  onSwap: () => void;
}) {
  const { t } = useTranslation("scan");
  const grams = scaleGrams(item);
  const chip = item.scaleRead;
  if (!grams || !chip) return null;
  const scaleActive = chip.active === "scale";
  const value = scaleValue(chip, fmtGramsLabel);
  return (
    <span
      role="group"
      aria-label={t("result.items.scaleGroup", { name })}
      className="mt-1.5 flex flex-wrap gap-1.5"
    >
      <button
        type="button"
        aria-pressed={scaleActive}
        onClick={scaleActive ? undefined : onSwap}
        className={chipClass(scaleActive)}
      >
        {chip.count > 1
          ? t("result.items.scaleReadShared", { value, count: chip.count })
          : t("result.items.scaleRead", { value })}
      </button>
      <button
        type="button"
        aria-pressed={!scaleActive}
        onClick={scaleActive ? onSwap : undefined}
        className={chipClass(!scaleActive)}
      >
        {t("result.items.scaleAi", { grams: fmtGramsLabel(grams.ai) })}
      </button>
    </span>
  );
}
