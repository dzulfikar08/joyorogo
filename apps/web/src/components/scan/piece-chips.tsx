import { hasBone } from "@joyorogo/api/lib/bone-chip";
import { clampCount, MAX_PIECES, pieceUnitKey } from "@joyorogo/api/lib/piece-chip";
import type { Pieces } from "@joyorogo/api/lib/piece-chip";
import { cn } from "@joyorogo/ui/lib/utils";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

const focusRing = "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

const stepClass = cn(
  "pressable grid size-8 shrink-0 place-items-center rounded-full text-foreground transition-colors duration-150 hover:bg-border disabled:pointer-events-none disabled:opacity-40",
  focusRing,
);

const chipClass = (active: boolean) =>
  cn(
    "inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-150",
    focusRing,
    active
      ? "pressable bg-primary text-primary-foreground"
      : "bg-muted text-foreground hover:bg-border",
  );

/**
 * Under a scan row of separate pieces (eggs, satay, dumplings): "Jumlah", a minus, the count with its unit and a
 * plus. One tap moves the count by one and the row's weight, kcal and macros follow (itemAtCount), so a count the
 * AI misread is fixed without typing.
 */
export function PieceCountChip({
  name,
  pieces,
  onChange,
}: {
  name: string;
  pieces: Pieces;
  onChange: (count: number) => void;
}) {
  const { t } = useTranslation("scan");
  return (
    <span
      role="group"
      aria-label={t("result.items.countGroup", { name })}
      className="inline-flex items-center gap-0.5 rounded-full bg-muted py-0.5 pr-0.5 pl-3"
    >
      <span className="mr-1 text-xs text-muted-foreground">{t("result.items.count")}</span>
      <button
        type="button"
        aria-label={t("result.items.countLess", { name })}
        disabled={pieces.count <= 1}
        onClick={() => onChange(clampCount(pieces.count - 1))}
        className={stepClass}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span
        className="min-w-[4.5ch] text-center text-xs font-semibold tabular-nums"
        aria-live="polite"
      >
        {pieces.count}{" "}
        {t(`result.items.unit.${pieceUnitKey(pieces.unit)}`, { count: pieces.count })}
      </span>
      <button
        type="button"
        aria-label={t("result.items.countMore", { name })}
        disabled={pieces.count >= MAX_PIECES}
        onClick={() => onChange(clampCount(pieces.count + 1))}
        className={stepClass}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </span>
  );
}

/**
 * Under a bone-in row (fried chicken, ribs, a whole fish): "Dengan tulang" / "Tanpa tulang" moves the row's
 * weight between the weight with the bone and the edible part (setWithBone). The kcal stay: they are those of
 * the meat that is eaten.
 */
export function BoneChips({
  name,
  item,
  onChange,
}: {
  name: string;
  item: { grams?: number; edibleGrams?: number; grossGrams?: number; withBone?: boolean };
  onChange: (withBone: boolean) => void;
}) {
  const { t } = useTranslation("scan");
  if (!hasBone(item)) return null;
  const withBone = item.withBone ?? true;
  return (
    <span
      role="group"
      aria-label={t("result.items.boneGroup", { name })}
      className="flex flex-wrap gap-1.5"
    >
      <button
        type="button"
        aria-pressed={withBone}
        onClick={() => onChange(true)}
        className={chipClass(withBone)}
      >
        {t("result.items.boneWith")}
      </button>
      <button
        type="button"
        aria-pressed={!withBone}
        onClick={() => onChange(false)}
        className={chipClass(!withBone)}
      >
        {t("result.items.boneWithout")}
      </button>
    </span>
  );
}
