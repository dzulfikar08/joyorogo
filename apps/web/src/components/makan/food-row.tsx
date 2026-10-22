import { fmtClock, getActiveDayZone } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MacroLine } from "@/components/macro-line";
import { FoodThumb, useStickerTarget } from "@/components/sticker";
import type { FoodItem } from "@/lib/api-types";
import type { Presence } from "@/lib/use-presence";
import { fmtInt } from "@/lib/format";

/**
 * Nutrition-first diary row: small thumbnail, name (2 lines max), time and
 * weight, the P/K/L macro line, and the kcal as the bold number on the right.
 * The trash button is the only inline control; the rest of the row opens the editor.
 *
 * `nested` is a component of a plate: it sits under the plate header, so it drops the thumbnail and the
 * macro line (the header carries the plate's) and shrinks to a single quiet line with a small kcal.
 */
export function FoodRow({
  item,
  dayRows,
  presence,
  nested = false,
  onEdit,
  onDelete,
}: {
  item: FoodItem;
  /** The day's rows: a plate sticker opens as the whole scan, summed over its rows. */
  dayRows: readonly FoodItem[];
  /** "enter" / "leave" while the row animates in or out of the list. */
  presence?: Presence;
  nested?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("makan");
  const stickerTarget = useStickerTarget();
  const hasMacros = [item.protein, item.carbs, item.fat, item.fiber].some((g) => (g ?? 0) > 0);
  // Never filled in (null, not 0 g): the day total counts nothing for it, so say so and let a tap open the editor.
  const macrosMissing = item.protein == null && item.carbs == null && item.fat == null && item.kcal > 0;
  const created = new Date(item.createdAt);
  const meta = [
    Number.isNaN(created.getTime()) ? null : fmtClock(created, undefined, getActiveDayZone()),
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
          className={cn(
            "flex w-full cursor-pointer items-center text-left transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none",
            nested ? "gap-2 py-0.5 pr-1 pl-3" : "gap-3 px-4 py-3",
          )}
        >
          {!nested && (
            <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
              <FoodThumb
                scanId={item.scanId}
                photoId={item.photoId}
                name={item.name}
                kcal={item.kcal}
                protein={item.protein}
                carbs={item.carbs}
                fat={item.fat}
                {...stickerTarget(item, dayRows)}
                className="size-12"
                iconClassName="size-5"
              />
            </span>
          )}
          <span className="min-w-0 flex-1 space-y-0.5">
            <span
              className={cn(
                "break-words",
                nested
                  ? "line-clamp-2 text-sm leading-snug font-medium"
                  : "line-clamp-2 text-[0.9375rem] leading-snug font-semibold",
              )}
            >
              {item.name}
            </span>
            {meta.length > 0 && (
              <span className="block text-xs text-muted-foreground tabular-nums">
                {meta.join(" · ")}
              </span>
            )}
            {nested ? null : hasMacros ? (
              <MacroLine
                compact
                className="text-[0.8125rem] text-muted-foreground"
                protein={item.protein}
                carbs={item.carbs}
                fat={item.fat}
                fiber={item.fiber}
              />
            ) : macrosMissing ? (
              <span className="block text-xs text-muted-foreground">{t("foodRow.noMacros")}</span>
            ) : item.source === "ai" ? (
              <span className="block text-xs text-muted-foreground">{t("foodRow.fromAi")}</span>
            ) : null}
          </span>
          {nested ? (
            <span className="shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">
              {fmtInt(item.kcal)}
              <span className="ml-1 text-xs">{t("diary.summary.unit")}</span>
            </span>
          ) : (
            <span className="shrink-0 text-right">
              <span className="block text-lg leading-none font-extrabold text-kcal tabular-nums">
                {fmtInt(item.kcal)}
              </span>
              <span className="mt-0.5 block text-[0.6875rem] font-semibold text-muted-foreground">
                {t("diary.summary.unit")}
              </span>
            </span>
          )}
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
