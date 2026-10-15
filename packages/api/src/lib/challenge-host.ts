import { effectiveTier, paywallEnabled } from "./tiers";
import type { PaywallConfig, Tier } from "./tiers";

/**
 * Only Founders host group challenges; free users still join and take part.
 * A server without a paywall (self-host) has nothing to sell, so everyone hosts.
 */
export function canHostChallenge(
  row: { tier: Tier; founderUntil: Date | null } | undefined,
  config: PaywallConfig,
  now = new Date(),
): boolean {
  return effectiveTier(row, now) === "founder" || !paywallEnabled(config);
}
