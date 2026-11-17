/** Where the Pro paywall screen was opened from; picks its subhead. `joyoarto` = JoyoArto's Upgrade link. */
export type PaywallFrom =
  | "onboarding"
  | "quota"
  | "banner"
  | "profile"
  | "fitness"
  | "challenge"
  | "joyofit"
  | "joyoarto";

export type PaywallSearch = { next?: string; from?: PaywallFrom; polar?: "success" };

/** Where a new account lands after onboarding and the skippable Pro offer: the first photo scan (first success), not the home screen. */
export const ONBOARDING_NEXT = "/makan/ai";

/** Search params of the paywall route: `next` must be an in-app path. */
export function validatePaywallSearch(search: Record<string, unknown>): PaywallSearch {
  return {
    next:
      typeof search.next === "string" &&
      search.next.startsWith("/") &&
      !search.next.startsWith("//")
        ? search.next
        : undefined,
    from: (["onboarding", "quota", "banner", "profile", "fitness", "challenge", "joyofit", "joyoarto"] as const).find(
      (value) => search.from === value,
    ),
    polar: search.polar === "success" ? ("success" as const) : undefined,
  };
}
