import { MAKAN_VIEWS } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { cn } from "@joyorogo/ui/lib/utils";
import { CalendarDays, Camera, List, MapPin } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

const ICONS: Record<MakanView, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  daftar: List,
  kalender: CalendarDays,
  stiker: Camera,
  tempat: MapPin,
};

/**
 * Segmented view switcher for Makan. Every segment shows its icon; the chosen
 * one grows to show its label too, so four views fit a 390px phone.
 */
export function MakanViewSwitcher({
  value,
  onChange,
}: {
  value: MakanView;
  onChange: (view: MakanView) => void;
}) {
  const { t } = useTranslation("makan");
  return (
    <div
      role="tablist"
      aria-label={t("viewSwitcher.label")}
      className="flex gap-1 rounded-full bg-muted p-1"
    >
      {MAKAN_VIEWS.map((view) => {
        const active = view.value === value;
        const Icon = ICONS[view.value];
        return (
          <button
            key={view.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t(`viewSwitcher.view.${view.value}`)}
            onClick={() => onChange(view.value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-[flex-grow,background-color,color,box-shadow] duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none md:min-h-10",
              active
                ? "flex-[2.4] bg-card px-3 text-foreground shadow-[0_1px_3px_oklch(0.3_0.02_85/12%)]"
                : "flex-1 text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-[1.125rem] shrink-0" aria-hidden />
            {active && <span>{t(`viewSwitcher.view.${view.value}`)}</span>}
          </button>
        );
      })}
    </div>
  );
}
