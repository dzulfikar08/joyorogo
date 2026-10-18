import { Activity, Bike, Footprints, PersonStanding, Waves, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  run: Footprints,
  walk: PersonStanding,
  ride: Bike,
  swim: Waves,
};

/** Round tile with the icon of a sport kind (`other` and unknown kinds get the activity pulse). */
export function SportIcon({ kind }: { kind: string }) {
  const Icon = ICONS[kind] ?? Activity;
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bakar-soft">
      <Icon className="size-5 text-bakar-ink" aria-hidden />
    </span>
  );
}
