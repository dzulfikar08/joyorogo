import { foodKind } from "@joyorogo/api/lib/food-kind";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { fmtClock } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Clock, Cookie, CupSoda, Shapes, Trash2, Utensils } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MacroLine } from "@/components/macro-line";
import { FoodThumb } from "@/components/sticker";
import type { FoodItem } from "@/lib/api-types";
import type { Presence } from "@/lib/use-presence";
import { fmtInt, fmtKcalLabel } from "@/lib/format";
import { MACRO_META } from "@/lib/macro-icons";

const KIND_ICON = {
  makanan: Utensils,
  camilan: Cookie,
  minuman: CupSoda,
  lainnya: Shapes,
} as const;

function KindChip({ kind }: { kind: FoodKind }) {
  const { t } = useTranslation("makan");
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-makan-soft px-2 py-0.5 text-xs font-semibold text-makan-ink">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`kind.${kind}`)}
    </span>
  );
}

/**
 * Sticker-first diary row: large cutout on the left, name (2 lines max), kind
 * chip + time, then kkal / gram / macro metadata. The trash button is the only
 * inline control; the rest of the row opens the editor.
 */
export function FoodRow({
  item,
  presence,
  onEdit,
  onDelete,
}: {
  item: FoodItem;
  /** "enter" / "leave" while the row animates in or out of the list. */
  presence?: Presence;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("makan");
  const hasMacros = [item.protein, item.carbs, item.fat, item.fiber].some((g) => (g ?? 0) > 0);
  const created = new Date(item.createdAt);
  return (
    <li
      className="row-presence relative"
      data-presence={presence}
      aria-hidden={presence === "leave" || undefined}
    >
      <div>
        <div
          onClick={onEdit}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onEdit();
            }
          }}
          className="flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        >
          <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <FoodThumb
              scanId={item.scanId}
              photoId={item.photoId}
              name={item.name}
              kcal={item.kcal}
              protein={item.protein}
              carbs={item.carbs}
              fat={item.fat}
              className="size-16 min-[400px]:size-20"
              iconClassName="size-7"
            />
          </span>
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="line-clamp-2 break-words text-[0.9375rem] leading-snug font-semibold">
              {item.name}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <KindChip kind={foodKind(item.name)} />
              {Number.isNaN(created.getTime()) ? null : (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Clock className="size-3.5 shrink-0" aria-hidden />
                  {fmtClock(created)}
                </span>
              )}
            </span>
            {/* Energy and weight lead the line, each with its own icon and hue, then the macro chips. */}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.8125rem] text-muted-foreground">
              <span
                className="inline-flex items-center gap-1.5 font-semibold text-kcal"
                aria-label={`${MACRO_META.kcal.label} ${fmtKcalLabel(item.kcal)}`}
              >
                <MACRO_META.kcal.Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="tabular-nums">{fmtKcalLabel(item.kcal)}</span>
              </span>
              {item.grams ? (
                <span
                  className="inline-flex items-center gap-1.5 font-semibold text-gram"
                  aria-label={`${MACRO_META.grams.label} ${fmtInt(item.grams)} g`}
                >
                  <MACRO_META.grams.Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="tabular-nums">{fmtInt(item.grams)} g</span>
                </span>
              ) : null}
              {hasMacros ? (
                <MacroLine
                  compact
                  protein={item.protein}
                  carbs={item.carbs}
                  fat={item.fat}
                  fiber={item.fiber}
                />
              ) : item.source === "ai" ? (
                <span>{t("foodRow.fromAi")}</span>
              ) : null}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("foodRow.delete", { name: item.name })}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </li>
  );
}
