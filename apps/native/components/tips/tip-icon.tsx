import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";

import type { TipIcon } from "@joyorogo/api/lib/tips";

type IonName = ComponentProps<typeof Ionicons>["name"];

/** Peta ikon netral konten tips ke Ionicons. Web memetakan ke lucide-nya sendiri. */
const TIP_ICONS: Record<TipIcon, IonName> = {
  salad: "restaurant-outline",
  egg: "egg-outline",
  beef: "fish-outline",
  wheat: "leaf-outline",
  droplets: "water",
  "glass-water": "pint-outline",
  timer: "timer-outline",
  package: "cube-outline",
  "cup-soda": "cafe-outline",
  utensils: "color-fill-outline",
  moon: "moon-outline",
  footprints: "footsteps-outline",
  dumbbell: "barbell-outline",
  calendar: "calendar-outline",
  scale: "scale-outline",
  soup: "fast-food-outline",
  heart: "heart-outline",
};

export function TipIconGlyph({
  icon,
  size = 18,
  color,
}: {
  icon: TipIcon;
  size?: number;
  color: string;
}) {
  return <Ionicons name={TIP_ICONS[icon]} size={size} color={color} />;
}
