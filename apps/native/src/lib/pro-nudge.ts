/**
 * When JoyoRogo points a free account at Pro outside the paywall itself. Pure rules, no storage and no UI: callers own
 * both. The rules keep the nudges honest and rare: each one is tied to something the person just did, shows once,
 * and goes away when dismissed.
 */

/** Streak lengths that earn a Pro card on Beranda, once each. */
export const STREAK_NUDGE_MILESTONES = [7, 14, 30, 60, 100] as const;

/** A milestone card only appears while the streak is this close to the milestone; later it would read as stale. */
const STREAK_NUDGE_WINDOW_DAYS = 2;

/**
 * The milestone to show a card for, or null. `lastShown` is the highest milestone already shown (or dismissed) on this
 * phone for this account; 0 when none. A streak of 9 days after 7 was shown shows nothing, and a streak of 45 that was
 * never nudged shows nothing either (30 is more than two days back).
 */
export function streakNudge(streakDays: number, lastShown: number): number | null {
  let hit: number | null = null;
  for (const milestone of STREAK_NUDGE_MILESTONES) {
    if (streakDays >= milestone && streakDays - milestone <= STREAK_NUDGE_WINDOW_DAYS) hit = milestone;
  }
  return hit !== null && hit > lastShown ? hit : null;
}

/** A free account's scan allowance as the server reports it (`profile.scanAllowance`). */
export type ScanAllowanceLike = {
  tier: "free" | "founder";
  quota: number | null;
  left: number | null;
};

/**
 * Whether the scan screen shows "N of M free scans left". Free accounts with a real limit only: Pro and unlimited
 * accounts have nothing to be told, and a server without a paywall reports no quota.
 */
export function showScanAllowance(allowance: ScanAllowanceLike | null | undefined): allowance is ScanAllowanceLike & {
  quota: number;
  left: number;
} {
  return !!allowance && allowance.tier === "free" && allowance.quota !== null && allowance.left !== null;
}

/** Why the paywall opened; picks its subhead and tells analytics which moment sold. Every caller passes one of these. */
export const PAYWALL_MOMENTS = [
  "onboarding",
  "quota",
  "scanleft",
  "banner",
  "chip",
  "profile",
  "fitness",
  "challenge",
  "joyofit",
  "mealplan",
  "sleep",
  "recap",
  "workout",
  "streak",
] as const;

export type PaywallMoment = (typeof PAYWALL_MOMENTS)[number];

/** The moment named by a route param; an unknown or missing one is the plain banner. */
export function paywallMoment(value: unknown): PaywallMoment {
  return PAYWALL_MOMENTS.find((moment) => moment === value) ?? "banner";
}

export const BENEFIT_KEYS = ["scans", "mealPlan", "advice", "sleep", "cloud", "challenge"] as const;
export type BenefitKey = (typeof BENEFIT_KEYS)[number];

/** The benefit each moment is about; it leads the list so the paywall opens on what the person came for. */
const LEAD_BENEFIT: Record<PaywallMoment, BenefitKey> = {
  onboarding: "scans",
  quota: "scans",
  scanleft: "scans",
  banner: "scans",
  chip: "scans",
  profile: "scans",
  streak: "scans",
  fitness: "advice",
  challenge: "challenge",
  joyofit: "cloud",
  mealplan: "mealPlan",
  sleep: "sleep",
  recap: "sleep",
  workout: "cloud",
};

/** All Pro benefits, the one this moment is about first, the rest in their usual order. */
export function benefitOrder(moment: PaywallMoment): BenefitKey[] {
  const lead = LEAD_BENEFIT[moment];
  return [lead, ...BENEFIT_KEYS.filter((key) => key !== lead)];
}
