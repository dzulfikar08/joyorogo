import { and, eq, sql } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { googlePurchase, payment } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";

import {
  GOOGLE_BASE_PLANS,
  GOOGLE_PRO_PRODUCT_ID,
  NOTIFICATION_SUBSCRIPTION_REVOKED,
  VOIDED_PRODUCT_TYPE_SUBSCRIPTION,
  googleFounderGrant,
} from "./google-play";
import type {
  GoogleNotification,
  GooglePlayClient,
  GooglePlayConfig,
  GoogleSubscription,
} from "./google-play";
import { addMonths, planMonths } from "./tiers";
import type { FounderPlan } from "./tiers";

/** States in which Play says the buyer is entitled right now. */
const ENTITLED_STATES: Partial<Record<GoogleSubscription["state"], true>> = {
  active: true,
  canceled: true,
  grace: true,
};
const CREDIT_ATTEMPTS = 3;

export type GoogleBillingDeps = {
  db: Database;
  client: GooglePlayClient;
  config: Pick<GooglePlayConfig, "testEmails">;
  /** Plan prices in IDR for orders Play does not bill in IDR. */
  fallbackPriceIdr: Record<FounderPlan, number>;
  now?: () => Date;
};

export type GoogleVerifyResult =
  | { ok: true; status: "granted"; founderUntil: Date; orderId: string; amountIdr: number }
  | { ok: true; status: "already"; founderUntil: Date | null; orderId: string }
  | { ok: true; status: "pending" }
  | { ok: true; status: "inactive" }
  | { ok: false; error: "invalid-token" | "wrong-product" | "other-account" | "no-user" | "busy" };

/** Order id of a Play order in the shared payment ledger. */
export function googleLedgerId(playOrderId: string): string {
  return `google:${playOrderId}`;
}

type CreditResult =
  | { outcome: "granted"; until: Date; amountIdr: number }
  | { outcome: "already" | "refunded" | "no-user" | "busy" };

/**
 * Credits one charged Play order to the user's Founder period, in one D1
 * batch: the pending ledger row, the paid flip, and the user update. The flip
 * lands only while founder_until still holds the value we extended from, so a
 * replayed token or two concurrent syncs extend exactly once. A row that was
 * refunded ("failed") is never credited again.
 */
async function creditOrder(
  deps: GoogleBillingDeps,
  input: {
    orderId: string;
    userId: string;
    email: string;
    sub: GoogleSubscription;
    plan: FounderPlan;
  },
): Promise<CreditResult> {
  const { db } = deps;
  const ledgerId = googleLedgerId(input.orderId);
  const months = planMonths(input.plan);

  for (let attempt = 0; attempt < CREDIT_ATTEMPTS; attempt++) {
    const [existing] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);
    if (existing?.status === "paid") return { outcome: "already" };
    if (existing?.status === "failed") return { outcome: "refunded" };

    const [owner] = await db
      .select({ founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!owner) return { outcome: "no-user" };

    const now = deps.now?.() ?? new Date();
    const previousMs = owner.founderUntil?.getTime() ?? null;
    const { until, amountIdr } = googleFounderGrant({
      test: input.sub.test,
      buyerEmail: input.email,
      testEmails: deps.config.testEmails,
      months,
      priceIdr: input.sub.priceIdr ?? deps.fallbackPriceIdr[input.plan],
      current: owner.founderUntil,
      now,
    });

    const [, flipped] = await db.batch([
      db
        .insert(payment)
        .values({ orderId: ledgerId, userId: input.userId, amountIdr, months, isTest: input.sub.test ? 1 : 0 })
        .onConflictDoNothing(),
      db
        .update(payment)
        .set({ status: "paid", paidAt: now, founderUntil: until })
        .where(
          and(
            eq(payment.orderId, ledgerId),
            eq(payment.status, "pending"),
            sql`(select ${user.founderUntil} from ${user} where ${user.id} = ${input.userId}) is ${previousMs}`,
          ),
        )
        .returning({ orderId: payment.orderId }),
      db
        .update(user)
        .set({ founderUntil: until })
        .where(
          and(
            eq(user.id, input.userId),
            sql`exists (select 1 from ${payment} where ${payment.orderId} = ${ledgerId} and ${payment.status} = 'paid' and ${payment.paidAt} = ${now.getTime()})`,
          ),
        ),
    ]);
    if (flipped.length === 1) return { outcome: "granted", until, amountIdr };
    // Lost a race with another credit: re-read and try again from the new period.
  }
  return { outcome: "busy" };
}

async function founderUntilOf(db: Database, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ founderUntil: user.founderUntil })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.founderUntil ?? null;
}

/**
 * Applies one Play subscription snapshot for its linked user: credits the
 * latest charged order once, acknowledges the purchase, and records the state.
 * Throws when Play is unreachable (callers retry; nothing is half-applied
 * beyond what is idempotent).
 */
async function applySubscription(
  deps: GoogleBillingDeps,
  link: { purchaseToken: string; userId: string },
  sub: GoogleSubscription,
  plan: FounderPlan,
): Promise<GoogleVerifyResult> {
  const now = deps.now?.() ?? new Date();
  const setState = (latestOrderId: string | null) =>
    deps.db
      .update(googlePurchase)
      .set({ state: sub.state, latestOrderId, isTest: sub.test ? 1 : 0, updatedAt: now })
      .where(eq(googlePurchase.purchaseToken, link.purchaseToken));

  // Pending (cash / convenience store) is not paid yet: nothing to credit or
  // acknowledge. The purchase notification credits it once the buyer pays.
  if (sub.state === "pending") {
    await setState(null);
    return { ok: true, status: "pending" };
  }
  const entitled =
    ENTITLED_STATES[sub.state] === true &&
    sub.expiresAt !== null &&
    sub.expiresAt.getTime() > now.getTime();
  if (!entitled || !sub.orderId) {
    await setState(sub.orderId);
    return { ok: true, status: "inactive" };
  }

  const [owner] = await deps.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, link.userId))
    .limit(1);
  if (!owner) return { ok: false, error: "no-user" };

  const credit = await creditOrder(deps, {
    orderId: sub.orderId,
    userId: link.userId,
    email: owner.email,
    sub,
    plan,
  });
  if (credit.outcome === "no-user") return { ok: false, error: "no-user" };
  if (credit.outcome === "busy") return { ok: false, error: "busy" };
  await setState(sub.orderId);
  // A refunded order stays refunded, and nothing is acknowledged for it.
  if (credit.outcome === "refunded") return { ok: true, status: "inactive" };

  // Acknowledge only after the credit is stored, so a buyer is never charged
  // without Founder; Play refunds a purchase left unacknowledged for 3 days.
  if (!sub.acknowledged) await deps.client.acknowledge(sub.productId, link.purchaseToken);

  if (credit.outcome === "granted") {
    return {
      ok: true,
      status: "granted",
      founderUntil: credit.until,
      orderId: sub.orderId,
      amountIdr: credit.amountIdr,
    };
  }
  return {
    ok: true,
    status: "already",
    founderUntil: await founderUntilOf(deps.db, link.userId),
    orderId: sub.orderId,
  };
}

function planOf(sub: GoogleSubscription): FounderPlan | null {
  if (sub.productId !== GOOGLE_PRO_PRODUCT_ID || !sub.basePlanId) return null;
  return GOOGLE_BASE_PLANS[sub.basePlanId] ?? null;
}

/**
 * Client-submitted purchase token (new purchase, restore, or replay): checks
 * it with Play, links it to the signed-in user, credits the order, and
 * acknowledges. A token already linked to another account is refused, and so
 * is one the app bought for a different account (obfuscatedAccountId).
 */
export async function verifyGooglePurchase(
  deps: GoogleBillingDeps,
  input: { purchaseToken: string; userId: string },
): Promise<GoogleVerifyResult> {
  const { db } = deps;
  const [existing] = await db
    .select({ userId: googlePurchase.userId })
    .from(googlePurchase)
    .where(eq(googlePurchase.purchaseToken, input.purchaseToken))
    .limit(1);
  if (existing && existing.userId !== input.userId) return { ok: false, error: "other-account" };

  const sub = await deps.client.getSubscription(input.purchaseToken);
  if (!sub) return { ok: false, error: "invalid-token" };
  const plan = planOf(sub);
  if (!plan || !sub.basePlanId) return { ok: false, error: "wrong-product" };
  if (sub.accountId && sub.accountId !== input.userId) return { ok: false, error: "other-account" };

  // Link first-come; a concurrent redeem by another account loses on the re-read.
  const now = deps.now?.() ?? new Date();
  await db
    .insert(googlePurchase)
    .values({
      purchaseToken: input.purchaseToken,
      userId: input.userId,
      productId: sub.productId,
      basePlanId: sub.basePlanId,
      state: sub.state,
      isTest: sub.test ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [linked] = await db
    .select({ userId: googlePurchase.userId })
    .from(googlePurchase)
    .where(eq(googlePurchase.purchaseToken, input.purchaseToken))
    .limit(1);
  if (linked?.userId !== input.userId) return { ok: false, error: "other-account" };

  return applySubscription(
    deps,
    { purchaseToken: input.purchaseToken, userId: input.userId },
    sub,
    plan,
  );
}

export type GoogleNotificationResult = {
  kind: "ignored" | "synced" | "revoked";
  /** The Play order this notification newly credited, for the receipt email. */
  granted: { userId: string; orderId: string; amountIdr: number } | null;
};

/**
 * Takes back the Founder time a refunded (voided / revoked) Play order granted.
 * Ledger rows flip paid -> failed once, so duplicate notifications do nothing.
 * Zero-revenue tester trials are left to expire on their own.
 */
export async function revokeGoogleOrder(
  deps: Pick<GoogleBillingDeps, "db" | "now">,
  playOrderId: string,
): Promise<"revoked" | "none"> {
  const { db } = deps;
  const ledgerId = googleLedgerId(playOrderId);
  for (let attempt = 0; attempt < CREDIT_ATTEMPTS; attempt++) {
    const [row] = await db
      .select({
        userId: payment.userId,
        months: payment.months,
        amountIdr: payment.amountIdr,
        status: payment.status,
      })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);
    if (!row || row.status !== "paid" || row.amountIdr === 0) return "none";

    const [owner] = await db
      .select({ founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, row.userId))
      .limit(1);
    const previousMs = owner?.founderUntil?.getTime() ?? null;
    const reduced = owner?.founderUntil ? addMonths(owner.founderUntil, -row.months) : null;

    const [flipped] = await db.batch([
      db
        .update(payment)
        .set({ status: "failed" })
        .where(
          and(
            eq(payment.orderId, ledgerId),
            eq(payment.status, "paid"),
            sql`(select ${user.founderUntil} from ${user} where ${user.id} = ${row.userId}) is ${previousMs}`,
          ),
        )
        .returning({ orderId: payment.orderId }),
      db
        .update(user)
        .set({ founderUntil: reduced })
        .where(
          and(
            eq(user.id, row.userId),
            sql`${user.founderUntil} is ${previousMs}`,
            sql`exists (select 1 from ${payment} where ${payment.orderId} = ${ledgerId} and ${payment.status} = 'failed')`,
          ),
        ),
    ]);
    if (flipped.length === 1) return "revoked";
    // The period moved under us (a concurrent credit): redo from the new one.
  }
  return "none";
}

/**
 * One real-time developer notification. The payload is never trusted for the
 * credit itself: the linked token is re-read from Play and applied like a
 * client submission. Unknown tokens (purchase notification beaten by the app's
 * own verify call) are ignored; the client's verify credits them.
 */
export async function handleGoogleNotification(
  deps: GoogleBillingDeps,
  notification: GoogleNotification,
): Promise<GoogleNotificationResult> {
  const ignored: GoogleNotificationResult = { kind: "ignored", granted: null };
  if (notification.voided) {
    if (notification.voided.productType !== VOIDED_PRODUCT_TYPE_SUBSCRIPTION) return ignored;
    const revoked = await revokeGoogleOrder(deps, notification.voided.orderId);
    return revoked === "revoked" ? { kind: "revoked", granted: null } : ignored;
  }
  const event = notification.subscription;
  if (!event) return ignored;

  const [link] = await deps.db
    .select({ purchaseToken: googlePurchase.purchaseToken, userId: googlePurchase.userId })
    .from(googlePurchase)
    .where(eq(googlePurchase.purchaseToken, event.purchaseToken))
    .limit(1);
  if (!link) return ignored;

  const sub = await deps.client.getSubscription(event.purchaseToken);
  if (!sub) return ignored;
  const plan = planOf(sub);
  if (!plan) return ignored;

  if (event.notificationType === NOTIFICATION_SUBSCRIPTION_REVOKED && sub.orderId) {
    await revokeGoogleOrder(deps, sub.orderId);
    return { kind: "revoked", granted: null };
  }
  const result = await applySubscription(deps, link, sub, plan);
  // A concurrent credit still settling: let Pub/Sub redeliver.
  if (!result.ok && result.error === "busy") throw new Error("google credit busy");
  const granted =
    result.ok && result.status === "granted"
      ? { userId: link.userId, orderId: result.orderId, amountIdr: result.amountIdr }
      : null;
  return { kind: "synced", granted };
}
