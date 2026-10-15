import { FOOD_KIND_FILTERS } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { cn } from "@joyorogo/ui/lib/utils";
import { Coffee, Cookie, LayoutGrid, ShoppingBag, Utensils } from "lucide-react";
import type { ComponentType } from "react";

const ICONS: Record<FoodKindFilter, ComponentType<{ className?: string }>> = {
  semua: LayoutGrid,
  makanan: Utensils,
  camilan: Cookie,
  minuman: Coffee,
  lainnya: ShoppingBag,
};

/** Semua / Makanan / Minuman / Lainnya filter row under the view switcher. */
export function KindChips({
  value,
  onChange,
}: {
  value: FoodKindFilter;
  onChange: (kind: FoodKindFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Jenis catatan"
      className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1"
    >
      {FOOD_KIND_FILTERS.map((filter) => {
        const active = filter.value === value;
        const Icon = ICONS[filter.value];
        return (
          <button
            key={filter.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter.value)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none md:min-h-10",
              active
                ? "pressable bg-primary text-primary-foreground"
                : "bg-muted text-foreground hover:bg-border",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
