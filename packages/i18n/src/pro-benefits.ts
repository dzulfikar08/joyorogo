/**
 * What JoyoRogo Pro unlocks, as ids only: web (/harga, /pro, the landing and /my and /sg pricing, the Profil
 * subscription screen) and native (the paywall) turn them into text with the `billing` namespace
 * (`pro.groups.<group>`, `pro.items.<item>`; `scans` is the exception, see below).
 *
 * Every item here is enforced on the server; the gate that enforces it is named next to it. Add an item only when its
 * gate exists, and add the gate's line here when a new one lands, so the marketing copy never claims more than the code
 * checks (pricing.md, "What Pro unlocks").
 */
export const PRO_BENEFIT_GROUPS = [
  {
    id: "ai",
    items: [
      // Daily scan quota above the free one: packages/api lib/tiers.ts + lib/quota.ts. Text comes from
      // `benefits.scansUnlimited` / `benefits.scansCapped` because it carries the live /api/config cap.
      "scans",
      // routers/joyo.ts chat (cloudUnlocked)
      "joyoChat",
      // routers/coach.ts putDoc + chat (cloudUnlocked)
      "coach",
      // routers/mcp-connection.ts info + apps/server/src/mcp.ts (cloudUnlocked)
      "connect",
      // routers/stats.ts + lib/recap-reflection.ts (cloudUnlocked)
      "recap",
      // routers/sleep-insights.ts get (premiumUnlocked: personal findings)
      "sleep",
    ],
  },
  {
    id: "meals",
    items: [
      // routers/meal-plan.ts requirePro (cloudUnlocked)
      "mealPlan",
      // routers/day.ts readinessGuidance (premiumUnlocked)
      "advice",
    ],
  },
  {
    id: "joyofit",
    items: [
      // routers/fitness.ts cloudAccess, sync.ts (fit ns), strength.ts, fit-web.ts, lib/watch-workout-store.ts
      "cloud",
    ],
  },
  {
    id: "social",
    items: [
      // routers/challenge.ts create (canHostChallenge); joining stays free
      "challenge",
      // routers/social.ts workout detail of other people's posts (premiumUnlocked)
      "workoutDetail",
    ],
  },
  {
    id: "more",
    items: [
      // lib/reminders.ts "plan" reminder (premiumUnlocked)
      "reminders",
      // the Pro pill on Profil
      "badge",
      // PRIORITY_SUPPORT below: answered by hand, not a server gate
      "support",
    ],
  },
] as const;

export type ProBenefitGroup = (typeof PRO_BENEFIT_GROUPS)[number]["id"];
export type ProBenefit = (typeof PRO_BENEFIT_GROUPS)[number]["items"][number];

/** Every Pro benefit, in display order. */
export const PRO_BENEFITS: readonly ProBenefit[] = PRO_BENEFIT_GROUPS.flatMap((group) => group.items);

/**
 * Priority support for Pro: a Threads DM to the owner's account, answered within `replyWorkdays` working days. Anyone can
 * DM, so Pro users name the email of their JoyoRogo account and the owner looks it up in the admin. One edit here moves
 * every surface (web, native, the pricing pages) to an official account or a different promise.
 */
export const PRIORITY_SUPPORT = {
  handle: "@dzulfikar.at",
  threadsUrl: "https://www.threads.com/@dzulfikar.at",
  replyWorkdays: 1,
} as const;

/** The items of one group, in display order. */
export function proBenefitItems(group: ProBenefitGroup): readonly ProBenefit[] {
  return PRO_BENEFIT_GROUPS.find((candidate) => candidate.id === group)?.items ?? [];
}
