import { fmtClock } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MacroLine } from "@/components/macro-line";
import { FoodThumb } from "@/components/sticker";
import type { FoodItem } from "@/lib/api-types";
import type { Presence } from "@/lib/use-presence";
import { fmtInt } from "@/lib/format";

/**
 * Nutrition-first diary row: small thumbnail, name (2 lines max), time and
 * weight, the P/K/L macro line, and the kcal as the bold number on the right.
 * The trash button is the only inline control; the rest of the row opens the editor.
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
  const meta = [
    Number.isNaN(created.getTime()) ? null : fmtClock(created),
    item.grams ? `${fmtInt(item.grams)} g` : null,
  ].filter(Boolean);
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
          className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
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
              className="size-12"
              iconClassName="size-5"
            />
          </span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="line-clamp-2 break-words text-[0.9375rem] leading-snug font-semibold">
              {item.name}
            </span>
            {meta.length > 0 && (
              <span className="block text-xs text-muted-foreground tabular-nums">
                {meta.join(" · ")}
              </span>
            )}
            {hasMacros ? (
              <MacroLine
                compact
                className="text-[0.8125rem] text-muted-foreground"
                protein={item.protein}
                carbs={item.carbs}
                fat={item.fat}
                fiber={item.fiber}
              />
            ) : item.source === "ai" ? (
              <span className="block text-xs text-muted-foreground">{t("foodRow.fromAi")}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-lg leading-none font-extrabold text-kcal tabular-nums">
              {fmtInt(item.kcal)}
            </span>
            <span className="mt-0.5 block text-[0.6875rem] font-semibold text-muted-foreground">
              {t("diary.summary.unit")}
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
