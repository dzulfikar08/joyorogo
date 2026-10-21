import { MAKAN_VIEWS } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { cn } from "@joyorogo/ui/lib/utils";
import { CalendarDays, Camera, List, MapPin } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/**
 * Icon-first segmented tabs. Every segment shows its icon; the chosen one
 * grows to show its label too, so four views fit a 390px phone. Shared by
 * Makan and Feed.
 */
export function IconTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; icon: IconType }>;
  /** Accessible tablist name. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-1 rounded-full bg-muted p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-[flex-grow,background-color,color,box-shadow] duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none md:min-h-10",
              active
                ? "flex-[2.4] bg-card px-3 text-foreground shadow-[0_1px_3px_oklch(0.3_0.02_85/12%)]"
                : "flex-1 text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-[1.125rem] shrink-0" aria-hidden />
            {active && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

const ICONS: Record<MakanView, IconType> = {
  daftar: List,
  kalender: CalendarDays,
  stiker: Camera,
  tempat: MapPin,
};

export function MakanViewSwitcher({
  value,
  onChange,
  className,
}: {
  value: MakanView;
  onChange: (view: MakanView) => void;
  className?: string;
}) {
  const { t } = useTranslation("makan");
  return (
    <IconTabs
      value={value}
      onChange={onChange}
      label={t("viewSwitcher.label")}
      className={className}
      options={MAKAN_VIEWS.map((view) => ({
        value: view.value,
        label: t(`viewSwitcher.view.${view.value}`),
        icon: ICONS[view.value],
      }))}
    />
  );
}
