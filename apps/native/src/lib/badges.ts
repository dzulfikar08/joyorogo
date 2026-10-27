/** Pure badge helpers: ring/stars mapping, next threshold, unlock diff, board weeks (WIB). */

export type BadgeLike = { id: string; tiers: number[]; tier: number; awardedAt: number | null };

export type Ring = "bronze" | "silver" | "gold";

export const RING_COLORS: Record<Ring, string> = {
  bronze: "#B87333",
  silver: "#A9B2BC",
  gold: "#E3A71B",
};

/** One-time badges earn a gold ring; 2-tier badges end in gold; 3-tier run bronze, silver, gold. */
export function ringFor(badge: BadgeLike): Ring | null {
  if (badge.tier <= 0) return null;
  const top = badge.tiers.length;
  if (top <= 1) return "gold";
  if (badge.tier >= top) return "gold";
  if (top === 2) return "bronze";
  return badge.tier === 1 ? "bronze" : "silver";
}

/** Small stars under a medal: the earned tier of a tiered badge; none for one-time badges or locked ones. */
export function starsFor(badge: BadgeLike): number {
  return badge.tiers.length > 1 ? Math.max(0, Math.min(3, badge.tier)) : 0;
}

/** Threshold of the next tier, or null for a locked, one-time or maxed badge. */
export function nextThreshold(badge: BadgeLike): number | null {
  if (badge.tiers.length <= 1 || badge.tier <= 0) return null;
  return badge.tiers[badge.tier] ?? null;
}

/** Number substituted into `<id>.desc`: the first threshold. */
export function ruleCount(badge: BadgeLike): number {
  return badge.tiers[0] ?? 1;
}

export const earnedKey = (badge: Pick<BadgeLike, "id" | "tier">): string => `${badge.id}:${badge.tier}`;

export function earnedKeys(badges: BadgeLike[]): string[] {
  return badges.filter((b) => b.tier > 0).map(earnedKey);
}

/**
 * Badges earned since the stored set. `seen === null` is the first run: nothing is new, the caller
 * stores the baseline silently.
 */
export function newlyEarned(seen: string[] | null, badges: BadgeLike[]): BadgeLike[] {
  if (seen === null) return [];
  const known = new Set(seen);
  return badges.filter((b) => b.tier > 0 && !known.has(earnedKey(b)));
}

const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;

/** YYYY-MM-DD of an instant in Asia/Jakarta. */
export function wibDate(ms: number): string {
  return new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD) of the week containing `ms`, in Asia/Jakarta. */
export function weekMonday(ms: number): string {
  const local = new Date(ms + WIB_OFFSET_MS);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(local.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday `weeks` weeks before `monday` (a YYYY-MM-DD Monday). */
export function shiftWeeks(monday: string, weeks: number): string {
  return new Date(new Date(`${monday}T00:00:00Z`).getTime() - weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** Typed i18n key for a catalogue id; the API returns ids as plain strings, the `badges` namespace holds one name/desc pair per id. */
export function badgeKey(id: string, part: "name" | "desc"): "konsisten.name" | "konsisten.desc" {
  return `${id}.${part}` as "konsisten.name" | "konsisten.desc";
}
