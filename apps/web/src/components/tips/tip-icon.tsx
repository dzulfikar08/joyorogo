import {
  Beef,
  CalendarDays,
  CupSoda,
  Droplets,
  Dumbbell,
  Egg,
  Footprints,
  GlassWater,
  Heart,
  Moon,
  Package,
  Salad,
  Scale,
  Soup,
  Timer,
  Utensils,
  Wheat,
  type LucideIcon,
} from "lucide-react";

import type { TipIcon } from "@joyorogo/api/lib/tips";

/** Peta ikon netral konten tips ke lucide. Native memetakan ke Ionicons-nya sendiri. */
const TIP_ICON: Record<TipIcon, LucideIcon> = {
  salad: Salad,
  egg: Egg,
  beef: Beef,
  wheat: Wheat,
  droplets: Droplets,
  "glass-water": GlassWater,
  timer: Timer,
  package: Package,
  "cup-soda": CupSoda,
  utensils: Utensils,
  moon: Moon,
  footprints: Footprints,
  dumbbell: Dumbbell,
  calendar: CalendarDays,
  scale: Scale,
  soup: Soup,
  heart: Heart,
};

export function TipIconGlyph({ icon, className }: { icon: TipIcon; className?: string }) {
  const Glyph = TIP_ICON[icon];
  return <Glyph className={className} aria-hidden />;
}
