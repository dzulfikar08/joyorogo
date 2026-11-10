import { and, desc, eq, gt, isNotNull } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { account, user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";

import { ledgerRail } from "./revklik";
import { effectiveTier, paywallEnabled } from "./tiers";
import type { PaywallConfig, Tier } from "./tiers";

/**
 * Joyo Pro for sibling apps. One subscription per JoyoRogo account covers JoyoRogo, JoyoFit and JoyoArto; JoyoRogo is
 * the only billing authority. JoyoArto keeps its own accounts but signs in with the same Google OAuth client, so a
 * person's Google account id (`sub`) is the same in both apps. It asks `POST /api/internal/joyo-pro/status`
 * (apps/server/src/joyo-pro.ts) with that id and the email, and gets this answer back. Contract: docs/joyo-pro.md.
 */
export type JoyoProPlan = "monthly" | "yearly" | "lifetime";

export type JoyoProStatus = {
  pro: boolean;
  /** ISO time the paid period ends; null when not Pro or Pro without an end (comp, no paywall). */
  until: string | null;
  plan: JoyoProPlan | null;
  /**
   * What made the account Pro: "doku", "pakasir", "apple", "google_play", "polar" (the ledger row of the current
   * period), "comp" (granted by hand: tier founder, or a period set in the admin), "no_paywall" (a server that sells
   * nothing treats everyone as Pro). null when not Pro.
   */
  source: string | null;
};

export type JoyoProLookup = { googleSub?: string | null; email?: string | null };

const NOT_PRO: JoyoProStatus = { pro: false, until: null, plan: null, source: null };

/** A period end this far past the newest ledger row's was extended by hand (admin), not bought. */
const LEDGER_SLACK_MS = 24 * 60 * 60 * 1000;

type UserRow = { id: string; tier: Tier; founderUntil: Date | null };

const userColumns = { id: user.id, tier: user.tier, founderUntil: user.founderUntil };

/**
 * The JoyoRogo account a sibling app's user is: by Google account id first (better-auth `account`, provider google),
 * then by a verified email. An unverified email never matches, so nobody gets Pro by signing up with someone else's
 * address.
 */
export async function findJoyoUser(db: Database, lookup: JoyoProLookup): Promise<UserRow | undefined> {
  const sub = lookup.googleSub?.trim();
  if (sub) {
    const [byGoogle] = await db
      .select(userColumns)
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(and(eq(account.providerId, "google"), eq(account.accountId, sub)))
      .limit(1);
    if (byGoogle) return byGoogle;
  }
  // better-auth stores emails lowercased.
  const email = lookup.email?.trim().toLowerCase();
  if (!email) return undefined;
  const [byEmail] = await db
    .select(userColumns)
    .from(user)
    .where(and(eq(user.email, email), eq(user.emailVerified, true)))
    .limit(1);
  return byEmail;
}

/**
 * The JoyoRogo account a JoyoArto buyer's App Store purchase is credited to: the one `findJoyoUser` matches, else a
 * new account for that email (verified: JoyoArto only signs in with Google or Apple, which both prove the address),
 * with the Google account linked when JoyoArto knows its id, so signing in to JoyoRogo later with the same Google or
 * Apple account lands in it. An unverified JoyoRogo account with the same email is taken over and marked verified:
 * the email's owner proved it in JoyoArto, the account's creator never did. Returns null without an email.
 */
export async function findOrCreateJoyoUser(
  db: Database,
  lookup: JoyoProLookup & { name?: string | null },
  now = new Date(),
): Promise<UserRow | null> {
  const found = await findJoyoUser(db, lookup);
  if (found) return found;
  const email = lookup.email?.trim().toLowerCase();
  if (!email) return null;
  const sub = lookup.googleSub?.trim() || null;
  const name = lookup.name?.trim() || email.split("@")[0] || email;
  await db.insert(user).values({ id: crypto.randomUUID(), name, email, emailVerified: true }).onConflictDoNothing();
  const [row] = await db.select({ ...userColumns, emailVerified: user.emailVerified }).from(user).where(eq(user.email, email)).limit(1);
  if (!row) return null;
  if (!row.emailVerified) await db.update(user).set({ emailVerified: true }).where(eq(user.id, row.id));
  if (sub) {
    const [linked] = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.providerId, "google"), eq(account.accountId, sub)))
      .limit(1);
    if (!linked) {
      await db.insert(account).values({ id: crypto.randomUUID(), accountId: sub, providerId: "google", userId: row.id, createdAt: now, updatedAt: now });
    }
  }
  return { id: row.id, tier: row.tier, founderUntil: row.founderUntil };
}

/**
 * Joyo Pro state of one JoyoRogo account, by the rule JoyoRogo applies to itself (`premiumUnlocked`): a manual comp
 * (`tier = 'founder'`), a paid period still running (`founder_until`, written by every gateway: DOKU, Pakasir, Apple,
 * Google Play, Polar), or a server without a paywall. Plan and source come from the newest paid ledger row.
 */
export async function joyoProStatus(
  db: Database,
  config: PaywallConfig,
  row: UserRow | undefined,
  now = new Date(),
): Promise<JoyoProStatus> {
  if (!row) return NOT_PRO;
  if (row.tier === "founder") return { pro: true, until: null, plan: "lifetime", source: "comp" };
  if (effectiveTier(row, now) === "founder" && row.founderUntil) {
    const [last] = await db
      .select({
        orderId: payment.orderId,
        paymentUrl: payment.paymentUrl,
        months: payment.months,
        founderUntil: payment.founderUntil,
      })
      .from(payment)
      .where(
        and(
          eq(payment.userId, row.id),
          eq(payment.status, "paid"),
          gt(payment.months, 0),
          isNotNull(payment.founderUntil),
        ),
      )
      .orderBy(desc(payment.founderUntil))
      .limit(1);
    const bought =
      last?.founderUntil != null &&
      last.founderUntil.getTime() + LEDGER_SLACK_MS >= row.founderUntil.getTime();
    return {
      pro: true,
      until: row.founderUntil.toISOString(),
      plan: bought ? (last.months >= 12 ? "yearly" : "monthly") : null,
      source: bought ? ledgerRail(last) : "comp",
    };
  }
  if (!paywallEnabled(config)) return { pro: true, until: null, plan: null, source: "no_paywall" };
  return NOT_PRO;
}
