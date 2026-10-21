import { FOOD_KIND_FILTERS } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { Popover, PopoverContent, PopoverTrigger } from "@joyorogo/ui/components/popover";
import { cn } from "@joyorogo/ui/lib/utils";
import { Check, Coffee, Cookie, LayoutGrid, ListFilter, ShoppingBag, Utensils } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const ICONS: Record<FoodKindFilter, ComponentType<{ className?: string }>> = {
  semua: LayoutGrid,
  makanan: Utensils,
  camilan: Cookie,
  minuman: Coffee,
  lainnya: ShoppingBag,
};

/**
 * One filter button beside the view switcher; the kinds live in a popover so
 * no full-width chip row costs vertical space. A dot marks an active filter.
 */
export function KindFilter({
  value,
  onChange,
}: {
  value: FoodKindFilter;
  onChange: (kind: FoodKindFilter) => void;
}) {
  const { t } = useTranslation("makan");
  const [open, setOpen] = useState(false);
  const filtered = value !== "semua";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("kindChips.label")}
          className={cn(
            "pressable relative flex size-[3.25rem] shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none md:size-12",
            filtered ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <ListFilter className="size-5" aria-hidden />
          {filtered && (
            <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-primary-foreground ring-2 ring-primary" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1.5">
        <div role="radiogroup" aria-label={t("kindChips.label")}>
          {FOOD_KIND_FILTERS.map((filter) => {
            const active = filter.value === value;
            const Icon = ICONS[filter.value];
            return (
              <button
                key={filter.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onChange(filter.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                  active && "bg-muted",
                )}
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 text-left">
                  {filter.value === "semua" ? t("kind.all") : t(`kind.${filter.value}`)}
                </span>
                {active && <Check className="size-4" aria-hidden />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
