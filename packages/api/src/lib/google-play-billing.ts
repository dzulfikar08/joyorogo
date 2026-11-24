import { and, eq, sql } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { googlePurchase, payment } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";

import { notifyLedger } from "./revklik";
import type { LedgerHook } from "./revklik";

import {
  NOTIFICATION_SUBSCRIPTION_REVOKED,
  VOIDED_PRODUCT_TYPE_SUBSCRIPTION,
  googleFounderGrant,
  googlePlanFor,
  googleProductKind,
} from "./google-play";
import type {
  GoogleNotification,
  GooglePlayClient,
  GooglePlayConfig,
  GoogleSubscription,
} from "./google-play";
import { keluargaAmountIdr, ledgerProduct, periodTarget } from "./household";
import type { PaidProduct } from "./household";
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
  /** The Android Publisher client of an enabled package; null for any other package. */
  clientFor: (packageName: string) => GooglePlayClient | null;
  config: Pick<GooglePlayConfig, "testEmails">;
  /** Pro plan prices in IDR for orders Play does not bill in IDR (Keluarga: 2x). */
  fallbackPriceIdr: Record<FounderPlan, number>;
  now?: () => Date;
  /** Queues the ledger event for RevKlik after a paid flip or a refund. */
  onLedger?: LedgerHook;
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
 * Credits one charged Play order to the user's Founder period (a `keluarga` order: the household the buyer owns,
 * made on first payment), in one D1 batch: the pending ledger row, the paid flip, and the period update. The flip
 * lands only while the period still holds the value we extended from, so a
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
    product: PaidProduct;
  },
): Promise<CreditResult> {
  const { db } = deps;
  const ledgerId = googleLedgerId(input.orderId);
  // A free-trial order buys no months: the trial ends at Play's expiry, and the first paid renewal is its own order.
  const months = input.sub.freeTrial ? 0 : planMonths(input.plan);

  for (let attempt = 0; attempt < CREDIT_ATTEMPTS; attempt++) {
    const [existing] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);
    if (existing?.status === "paid") return { outcome: "already" };
    if (existing?.status === "failed") return { outcome: "refunded" };

    const target = await periodTarget(db, input.userId, input.product, { create: true });
    if (!target) return { outcome: "no-user" };

    const now = deps.now?.() ?? new Date();
    const previousMs = target.current?.getTime() ?? null;
    const fallbackIdr = deps.fallbackPriceIdr[input.plan];
    const { until, amountIdr } = googleFounderGrant({
      test: input.sub.test,
      buyerEmail: input.email,
      testEmails: deps.config.testEmails,
      months,
      priceIdr: input.sub.priceIdr ?? (input.product === "keluarga" ? keluargaAmountIdr(fallbackIdr) : fallbackIdr),
      current: target.current,
      now,
      freeTrial: input.sub.freeTrial,
      expiresAt: input.sub.expiresAt,
    });

    const [, flipped] = await db.batch([
      db
        .insert(payment)
        .values({
          orderId: ledgerId,
          userId: input.userId,
          amountIdr,
          months,
          isTest: input.sub.test ? 1 : 0,
          product: ledgerProduct(input.product),
        })
        .onConflictDoNothing(),
      db
        .update(payment)
        .set({ status: "paid", paidAt: now, founderUntil: until })
        .where(and(eq(payment.orderId, ledgerId), eq(payment.status, "pending"), target.holds(previousMs)))
        .returning({ orderId: payment.orderId }),
      target.write(
        until,
        sql`exists (select 1 from ${payment} where ${payment.orderId} = ${ledgerId} and ${payment.status} = 'paid' and ${payment.paidAt} = ${now.getTime()})`,
      ),
    ]);
    if (flipped.length === 1) {
      await notifyLedger(deps.onLedger, ledgerId, "paid");
      return { outcome: "granted", until, amountIdr };
    }
    // Lost a race with another credit: re-read and try again from the new period.
  }
  return { outcome: "busy" };
}

/** The period a product's purchase extends: the buyer's own Pro, or the household they own. */
async function periodOf(db: Database, userId: string, product: PaidProduct): Promise<Date | null> {
  return (await periodTarget(db, userId, product, { create: false }))?.current ?? null;
}

/**
 * Applies one Play subscription snapshot for its linked user: credits the
 * latest charged order once, acknowledges the purchase, and records the state.
 * Throws when Play is unreachable (callers retry; nothing is half-applied
 * beyond what is idempotent).
 */
async function applySubscription(
  deps: GoogleBillingDeps,
  link: { purchaseToken: string; userId: string; packageName: string },
  client: GooglePlayClient,
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
    product: googleProductKind(link.packageName, sub.productId),
  });
  if (credit.outcome === "no-user") return { ok: false, error: "no-user" };
  if (credit.outcome === "busy") return { ok: false, error: "busy" };
  await setState(sub.orderId);
  // A refunded order stays refunded, and nothing is acknowledged for it.
  if (credit.outcome === "refunded") return { ok: true, status: "inactive" };

  // Acknowledge only after the credit is stored, so a buyer is never charged
  // without Founder; Play refunds a purchase left unacknowledged for 3 days.
  if (!sub.acknowledged) await client.acknowledge(sub.productId, link.purchaseToken);

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
    founderUntil: await periodOf(deps.db, link.userId, googleProductKind(link.packageName, sub.productId)),
    orderId: sub.orderId,
  };
}

/** The plan a subscription sells, only when its product + base plan belong to `packageName`. */
function planOf(packageName: string, sub: GoogleSubscription): FounderPlan | null {
  if (!sub.basePlanId) return null;
  return googlePlanFor(packageName, sub.productId, sub.basePlanId);
}

/**
 * Client-submitted purchase token (new purchase, restore, or replay): checks
 * it with Play, links it to the signed-in user, credits the order, and
 * acknowledges. A token already linked to another account is refused, and so
 * is one the app bought for a different account (obfuscatedAccountId).
 */
export async function verifyGooglePurchase(
  deps: GoogleBillingDeps,
  input: { purchaseToken: string; userId: string; packageName: string },
): Promise<GoogleVerifyResult> {
  const { db } = deps;
  const client = deps.clientFor(input.packageName);
  if (!client) return { ok: false, error: "invalid-token" };
  const [existing] = await db
    .select({ userId: googlePurchase.userId })
    .from(googlePurchase)
    .where(eq(googlePurchase.purchaseToken, input.purchaseToken))
    .limit(1);
  if (existing && existing.userId !== input.userId) return { ok: false, error: "other-account" };

  const sub = await client.getSubscription(input.purchaseToken);
  if (!sub) return { ok: false, error: "invalid-token" };
  const plan = planOf(input.packageName, sub);
  if (!plan || !sub.basePlanId) return { ok: false, error: "wrong-product" };
  if (sub.accountId && sub.accountId !== input.userId) return { ok: false, error: "other-account" };

  // Link first-come; a concurrent redeem by another account loses on the re-read.
  const now = deps.now?.() ?? new Date();
  await db
    .insert(googlePurchase)
    .values({
      purchaseToken: input.purchaseToken,
      userId: input.userId,
      packageName: input.packageName,
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
    { purchaseToken: input.purchaseToken, userId: input.userId, packageName: input.packageName },
    client,
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
  deps: Pick<GoogleBillingDeps, "db" | "now" | "onLedger">,
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
        product: payment.product,
      })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);
    if (!row || row.status !== "paid" || row.amountIdr === 0) return "none";

    // A Keluarga order's months come off the household the buyer owns; a household deleted since has nothing left.
    const target = await periodTarget(db, row.userId, row.product === "keluarga" ? "keluarga" : "pro", { create: false });
    const previousMs = target?.current?.getTime() ?? null;
    const reduced = target?.current ? addMonths(target.current, -row.months) : null;
    const failedNow = sql`exists (select 1 from ${payment} where ${payment.orderId} = ${ledgerId} and ${payment.status} = 'failed')`;

    const [flipped] = await db.batch([
      db
        .update(payment)
        .set({ status: "failed" })
        .where(
          and(eq(payment.orderId, ledgerId), eq(payment.status, "paid"), ...(target ? [target.holds(previousMs)] : [])),
        )
        .returning({ orderId: payment.orderId }),
      ...(target ? [target.write(reduced, and(target.holds(previousMs), failedNow)!)] : []),
    ]);
    if (flipped.length === 1) {
      await notifyLedger(deps.onLedger, ledgerId, "refund");
      return "revoked";
    }
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
    .select({
      purchaseToken: googlePurchase.purchaseToken,
      userId: googlePurchase.userId,
      packageName: googlePurchase.packageName,
    })
    .from(googlePurchase)
    .where(eq(googlePurchase.purchaseToken, event.purchaseToken))
    .limit(1);
  if (!link) return ignored;

  // The package the purchase was verified under; the notification's own is only a fallback.
  const packageName = link.packageName || notification.packageName;
  const client = deps.clientFor(packageName);
  if (!client) return ignored;
  const sub = await client.getSubscription(event.purchaseToken);
  if (!sub) return ignored;
  const plan = planOf(packageName, sub);
  if (!plan) return ignored;

  if (event.notificationType === NOTIFICATION_SUBSCRIPTION_REVOKED && sub.orderId) {
    await revokeGoogleOrder(deps, sub.orderId);
    return { kind: "revoked", granted: null };
  }
  const result = await applySubscription(deps, { ...link, packageName }, client, sub, plan);
  // A concurrent credit still settling: let Pub/Sub redeliver.
  if (!result.ok && result.error === "busy") throw new Error("google credit busy");
  const granted =
    result.ok && result.status === "granted"
      ? { userId: link.userId, orderId: result.orderId, amountIdr: result.amountIdr }
      : null;
  return { kind: "synced", granted };
}
