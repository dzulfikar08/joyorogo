import { CUP_DRINKS, CUP_SIZES, cupDrinkName, cupSizeLabel } from "@joyorogo/api/lib/drink-options";
import type { CupChoice } from "@joyorogo/api/lib/drink-options";
import { getActiveLocale } from "@joyorogo/i18n";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

const focusRing =
  "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

const chipClass = (active: boolean) =>
  cn(
    "inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-150",
    focusRing,
    active
      ? "pressable bg-primary text-primary-foreground"
      : "bg-muted text-foreground hover:bg-border",
  );

const segmentClass = (active: boolean) =>
  cn(
    "inline-flex min-h-8 flex-1 items-center justify-center rounded-full px-2 text-xs font-semibold whitespace-nowrap transition-colors duration-150",
    focusRing,
    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
  );

/**
 * Under a scan row for a cup whose contents the photo hides: the usual drinks
 * as a wrapping chip cloud and the cup size as one compact segmented control.
 * The row's numbers come from the pick (cupPick), so choosing Coke Zero is
 * 0 kcal rather than a guess.
 */
export function CupChoices({
  choice,
  onPick,
}: {
  choice: CupChoice;
  onPick: (next: CupChoice) => void;
}) {
  const { t } = useTranslation("scan");
  const locale = getActiveLocale();
  return (
    <span className="block space-y-1.5">
      <span className="block text-xs text-muted-foreground">{t("result.items.cupWhich")}</span>
      <span role="group" aria-label={t("result.items.cupWhich")} className="flex flex-wrap gap-1.5">
        {CUP_DRINKS.map((drink) => (
          <button
            key={drink.id}
            type="button"
            aria-pressed={choice.drink === drink.id}
            onClick={() => onPick({ ...choice, drink: drink.id })}
            className={chipClass(choice.drink === drink.id)}
          >
            {cupDrinkName(drink.id, locale)}
          </button>
        ))}
      </span>
      <span
        role="group"
        aria-label={t("result.items.cupSize")}
        className="flex gap-0.5 rounded-full bg-muted p-0.5"
      >
        {CUP_SIZES.map((size) => (
          <button
            key={size.id}
            type="button"
            aria-pressed={choice.size === size.id}
            onClick={() => onPick({ ...choice, size: size.id })}
            className={segmentClass(choice.size === size.id)}
          >
            {cupSizeLabel(size.id)}
          </button>
        ))}
      </span>
    </span>
  );
}
