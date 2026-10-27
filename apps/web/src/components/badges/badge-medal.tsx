import { cn } from "@joyorogo/ui/lib/utils";
import { Star } from "lucide-react";

import type { BadgeView } from "@/lib/api-types";

/** Ring metal for an earned badge: tier 1 bronze, 2 silver, 3 gold (the top tier of a 2-tier badge is gold, one-time badges are gold). */
export type Metal = "bronze" | "silver" | "gold";

export function badgeMetal(badge: Pick<BadgeView, "tiers" | "tier">): Metal | null {
  if (badge.tier <= 0) return null;
  if (badge.tier >= badge.tiers.length) return "gold";
  return badge.tier === 1 ? "bronze" : "silver";
}

const RING: Record<Metal, string> = {
  bronze: "ring-[#b9794a]",
  silver: "ring-[#aab2bd]",
  gold: "ring-[#e0b23c]",
};
const STAR: Record<Metal, string> = {
  bronze: "fill-[#b9794a] text-[#b9794a]",
  silver: "fill-[#aab2bd] text-[#aab2bd]",
  gold: "fill-[#e0b23c] text-[#e0b23c]",
};

const SIZES = {
  sm: { box: "size-16", ring: "ring-[3px]", star: "size-2.5" },
  md: { box: "size-20", ring: "ring-4", star: "size-3" },
  lg: { box: "size-36", ring: "ring-[6px]", star: "size-5" },
} as const;

/** Medallion art with a tier ring and 1-3 stars drawn in code. Locked badges are greyed out. */
export function BadgeMedal({
  badge,
  size = "md",
  className,
}: {
  badge: Pick<BadgeView, "id" | "tiers" | "tier">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const metal = badgeMetal(badge);
  const s = SIZES[size];
  const stars = metal && badge.tiers.length > 1 ? badge.tier : 0;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <img
        src={`/badge/${badge.id}.webp`}
        alt=""
        width={512}
        height={512}
        loading="lazy"
        className={cn(
          s.box,
          "rounded-full bg-card object-cover ring-offset-2 ring-offset-card",
          s.ring,
          metal ? RING[metal] : "opacity-45 ring-border grayscale",
        )}
      />
      {metal && stars > 0 && (
        <span className="absolute bottom-0 left-1/2 flex -translate-x-1/2 translate-y-1/3 gap-px rounded-full bg-card px-1 py-0.5 shadow-[0_1px_2px_oklch(0.3_0.02_85/20%)]">
          {Array.from({ length: stars }, (_, i) => (
            <Star key={i} className={cn(s.star, STAR[metal])} aria-hidden />
          ))}
        </span>
      )}
    </span>
  );
}

type BadgeKey = "konsisten.name" | "konsisten.desc";

/** Typed i18n key for a catalogue id; the API returns ids as plain strings, the `badges` namespace holds one name/desc pair per id. */
export function badgeKey(id: string, part: "name" | "desc"): BadgeKey {
  return `${id}.${part}` as BadgeKey;
}
