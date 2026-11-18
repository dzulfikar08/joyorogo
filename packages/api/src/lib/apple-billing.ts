import { and, eq, sql } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { appleSubscription, payment } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";

import { appleAccountToken, appleProduct } from "./apple";
import type { AppleNotification, AppleTransaction } from "./apple";
import { notifyLedger } from "./revklik";
import type { LedgerHook } from "./revklik";
import { keluargaAmountIdr, ledgerProduct, periodTarget } from "./household";
import type { PaidProduct } from "./household";
import { appleSubscriptionGrant, planMonths } from "./tiers";
import type { FounderPlan } from "./tiers";

const CREDIT_ATTEMPTS = 3;

export type AppleBillingDeps = {
  db: Database;
  config: {
    sandboxAllowlist?: string;
    /** Plan prices in IDR for transactions Apple does not bill in IDR; the same for every app's product of that plan. */
    fallbackPriceIdr: Record<FounderPlan, number>;
  };
  now?: () => Date;
  /** Queues the ledger event for RevKlik after a paid flip or a refund. */
  onLedger?: LedgerHook;
};

/** Order id of an App Store transaction in the shared payment ledger. */
export function appleLedgerId(transactionId: string): string {
  return `apple:${transactionId}`;
}

type CreditResult =
  | { outcome: "granted"; until: Date; amountIdr: number }
  | { outcome: "already" | "refunded" | "expired" | "no-user" | "busy" | "shared" };

/**
 * Credits one App Store transaction to the user's Founder period, in one D1
 * batch: the pending ledger row, the paid flip, and the user update. The flip
 * lands only while founder_until still holds the value we extended from, so a
 * replayed JWS or two concurrent submissions extend exactly once. A refunded
 * ("failed") transaction is never credited again.
 */
async function creditTransaction(
  deps: AppleBillingDeps,
  input: {
    userId: string;
    email: string;
    transaction: AppleTransaction;
    plan: FounderPlan;
    product: PaidProduct;
  },
): Promise<CreditResult> {
  const { db, config } = deps;
  const { transaction, plan, product } = input;
  // Family Sharing is off on every product; a transaction that reached someone through it anyway (a toggle switched
  // on by mistake, which Apple says cannot be undone) must not mint Pro or household time.
  if (transaction.inAppOwnershipType && transaction.inAppOwnershipType !== "PURCHASED") return { outcome: "shared" };
  const ledgerId = appleLedgerId(transaction.transactionId);
  // A free trial buys no months: Founder runs to the trial's expiresDate, and the first paid renewal is its own transaction.
  const months = transaction.freeTrial ? 0 : planMonths(plan);
  const fallbackIdr = config.fallbackPriceIdr[plan];
  const priceIdr = transaction.priceIdr ?? (product === "keluarga" ? keluargaAmountIdr(fallbackIdr) : fallbackIdr);

  for (let attempt = 0; attempt < CREDIT_ATTEMPTS; attempt++) {
    const [existing] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);
    if (existing?.status === "paid") return { outcome: "already" };
    if (existing?.status === "failed" || transaction.revocationDate) {
      return { outcome: "refunded" };
    }

    // Keluarga: the household the buyer owns (made on first payment), with the store's period end as for Pro.
    const target = await periodTarget(db, input.userId, product, { create: Boolean(transaction.expiresDate) });
    if (!target) return transaction.expiresDate ? { outcome: "no-user" } : { outcome: "expired" };

    const now = deps.now?.() ?? new Date();
    const previousMs = target.current?.getTime() ?? null;
    const grant = transaction.expiresDate
      ? appleSubscriptionGrant(
          transaction.environment,
          input.email,
          config.sandboxAllowlist,
          priceIdr,
          transaction.expiresDate,
          target.current,
          now,
        )
      : null;
    if (!grant) return { outcome: "expired" };
    const { until, amountIdr } = grant;

    const [, flipped] = await db.batch([
      db
        .insert(payment)
        .values({
          orderId: ledgerId,
          userId: input.userId,
          amountIdr,
          months,
          isTest: transaction.environment === "Sandbox" ? 1 : 0,
          product: ledgerProduct(product),
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

async function setSubscriptionState(
  deps: AppleBillingDeps,
  originalTransactionId: string,
  state: string,
  expiresAt?: Date | null,
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await deps.db
    .update(appleSubscription)
    .set({
      state,
      updatedAt: now,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    })
    .where(eq(appleSubscription.originalTransactionId, originalTransactionId));
}

/** Links a subscription to a user first-come; returns the linked user id. */
async function linkSubscription(
  deps: AppleBillingDeps,
  userId: string,
  transaction: AppleTransaction,
): Promise<string | null> {
  const now = deps.now?.() ?? new Date();
  await deps.db
    .insert(appleSubscription)
    .values({
      originalTransactionId: transaction.originalTransactionId,
      userId,
      productId: transaction.productId,
      environment: transaction.environment,
      appAccountToken: transaction.appAccountToken?.toLowerCase() ?? null,
      state: "active",
      expiresAt: transaction.expiresDate,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [linked] = await deps.db
    .select({ userId: appleSubscription.userId })
    .from(appleSubscription)
    .where(eq(appleSubscription.originalTransactionId, transaction.originalTransactionId))
    .limit(1);
  return linked?.userId ?? null;
}

export type AppleRedeemResult =
  | { ok: true; status: "granted"; founderUntil: Date; amountIdr: number }
  | { ok: true; status: "already" | "inactive"; founderUntil: Date | null }
  | { ok: false; error: "wrong-product" | "other-account" | "no-user" | "busy" | "family-shared" };

/**
 * Client-submitted verified transaction (new purchase, restore, or replay).
 * A subscription is linked to the signed-in user by originalTransactionId; one
 * already linked to another account, or bought with another account's
 * appAccountToken, is refused. Founder time is the store's own period end.
 */
export async function redeemAppleTransaction(
  deps: AppleBillingDeps,
  input: { userId: string; email: string; transaction: AppleTransaction },
): Promise<AppleRedeemResult> {
  const { transaction } = input;
  const sold = appleProduct(transaction.productId);
  if (!sold) return { ok: false, error: "wrong-product" };
  const { plan } = sold;
  const product = sold.product ?? "pro";
  // Only the Apple account that bought it may redeem it: Family Sharing is off, so a shared copy is refused before it
  // links the subscription to this account (docs/pricing/joyo-keluarga.md 4.3).
  if (transaction.inAppOwnershipType && transaction.inAppOwnershipType !== "PURCHASED") {
    return { ok: false, error: "family-shared" };
  }

  if (
    transaction.appAccountToken &&
    transaction.appAccountToken.toLowerCase() !== (await appleAccountToken(input.userId))
  ) {
    return { ok: false, error: "other-account" };
  }
  const linkedUser = await linkSubscription(deps, input.userId, transaction);
  if (linkedUser !== input.userId) return { ok: false, error: "other-account" };

  const credit = await creditTransaction(deps, { ...input, plan, product });
  if (credit.outcome === "no-user") return { ok: false, error: "no-user" };
  if (credit.outcome === "busy") return { ok: false, error: "busy" };
  if (credit.outcome === "shared") return { ok: false, error: "family-shared" };

  if (credit.outcome !== "refunded") {
    await setSubscriptionState(
      deps,
      transaction.originalTransactionId,
      credit.outcome === "expired" ? "expired" : "active",
      transaction.expiresDate,
    );
  }
  if (credit.outcome === "granted") {
    return { ok: true, status: "granted", founderUntil: credit.until, amountIdr: credit.amountIdr };
  }
  return {
    ok: true,
    status: credit.outcome === "already" ? "already" : "inactive",
    founderUntil: await periodOf(deps.db, input.userId, product),
  };
}

/**
 * Takes back the Founder time a refunded or revoked transaction granted.
 * Ledger rows flip paid -> failed once, so duplicate notifications do nothing.
 * A subscription period gives up only when it is the current one: founder_until
 * drops to now unless the user holds time beyond that period (another
 * purchase). Zero-revenue sandbox trials are left to lapse on their own.
 */
export async function revokeAppleTransaction(
  deps: Pick<AppleBillingDeps, "db" | "now" | "onLedger">,
  transaction: AppleTransaction,
): Promise<"revoked" | "none"> {
  const { db } = deps;
  const ledgerId = appleLedgerId(transaction.transactionId);
  for (let attempt = 0; attempt < CREDIT_ATTEMPTS; attempt++) {
    const [row] = await db
      .select({
        userId: payment.userId,
        amountIdr: payment.amountIdr,
        status: payment.status,
        product: payment.product,
      })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);
    if (!row || row.status !== "paid" || row.amountIdr === 0) return "none";

    const now = deps.now?.() ?? new Date();
    // A Keluarga transaction gives back the household's period; a household deleted since has nothing left to cut.
    const target = await periodTarget(db, row.userId, row.product === "keluarga" ? "keluarga" : "pro", { create: false });
    const period = target?.current ?? null;
    const previousMs = period?.getTime() ?? null;
    let reduced: Date | null = period;
    if (period && transaction.expiresDate) {
      const current = period.getTime() <= transaction.expiresDate.getTime();
      if (current && period.getTime() > now.getTime()) reduced = now;
    }
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

export type AppleNotificationResult = {
  kind: "test" | "ignored" | "unmapped" | "synced" | "lapsed" | "revoked";
  /** The transaction this notification newly credited, for the receipt email. */
  granted: { userId: string; orderId: string; amountIdr: number } | null;
};

const CREDIT_TYPES: Record<string, true> = {
  SUBSCRIBED: true,
  DID_RENEW: true,
  OFFER_REDEEMED: true,
  RENEWAL_EXTENDED: true,
};
const REVOKE_TYPES: Record<string, true> = { REFUND: true, REVOKE: true };

/**
 * One verified App Store Server Notification V2. Maps the transaction to its
 * user by originalTransactionId (falling back to appAccountToken), then:
 * SUBSCRIBED / DID_RENEW extend Founder to the transaction's expiresDate;
 * EXPIRED / DID_FAIL_TO_RENEW / GRACE_PERIOD_EXPIRED never extend (the period
 * just lapses); REFUND / REVOKE take the period back. Verified-but-unmapped
 * notifications are logged and acknowledged: the app's own submission links
 * and credits them. Throws on a D1 failure so Apple redelivers.
 */
export async function handleAppleNotification(
  deps: AppleBillingDeps,
  notification: AppleNotification,
): Promise<AppleNotificationResult> {
  const ignored: AppleNotificationResult = { kind: "ignored", granted: null };
  const { notificationType: type, subtype, transaction } = notification;
  if (type === "TEST") return { kind: "test", granted: null };
  if (!transaction) return ignored;
  const sold = appleProduct(transaction.productId);
  if (!sold) return ignored;
  const { plan } = sold;

  // Refunds hit the ledger by transaction id: no subscription link needed.
  if (REVOKE_TYPES[type] === true) {
    const revoked = await revokeAppleTransaction(deps, transaction);
    await setSubscriptionState(deps, transaction.originalTransactionId, "revoked");
    return revoked === "revoked" ? { kind: "revoked", granted: null } : ignored;
  }

  const [linked] = await deps.db
    .select({ userId: appleSubscription.userId })
    .from(appleSubscription)
    .where(eq(appleSubscription.originalTransactionId, transaction.originalTransactionId))
    .limit(1);
  let userId = linked?.userId ?? null;
  if (!userId && transaction.appAccountToken) {
    const [byToken] = await deps.db
      .select({ userId: appleSubscription.userId })
      .from(appleSubscription)
      .where(eq(appleSubscription.appAccountToken, transaction.appAccountToken.toLowerCase()))
      .limit(1);
    if (byToken) {
      userId = await linkSubscription(deps, byToken.userId, transaction);
    }
  }
  if (!userId) {
    console.error(
      `apple notification ${type}/${subtype ?? "-"}: no user for original transaction ${transaction.originalTransactionId}`,
    );
    return { kind: "unmapped", granted: null };
  }
  const original = transaction.originalTransactionId;

  if (CREDIT_TYPES[type] === true) {
    const [owner] = await deps.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!owner) return { kind: "unmapped", granted: null };
    const credit = await creditTransaction(deps, {
      userId,
      email: owner.email,
      transaction,
      plan,
      product: sold.product ?? "pro",
    });
    // A concurrent credit still settling: let Apple redeliver.
    if (credit.outcome === "busy") throw new Error("apple credit busy");
    if (credit.outcome === "no-user") return { kind: "unmapped", granted: null };
    if (credit.outcome === "refunded" || credit.outcome === "shared") return ignored;
    await setSubscriptionState(
      deps,
      original,
      credit.outcome === "expired" ? "expired" : "active",
      transaction.expiresDate,
    );
    return {
      kind: "synced",
      granted:
        credit.outcome === "granted"
          ? {
              userId,
              orderId: appleLedgerId(transaction.transactionId),
              amountIdr: credit.amountIdr,
            }
          : null,
    };
  }

  if (type === "EXPIRED" || type === "GRACE_PERIOD_EXPIRED") {
    await setSubscriptionState(deps, original, "expired", transaction.expiresDate);
    return { kind: "lapsed", granted: null };
  }
  if (type === "DID_FAIL_TO_RENEW") {
    await setSubscriptionState(deps, original, subtype === "GRACE_PERIOD" ? "grace" : "retry");
    return { kind: "lapsed", granted: null };
  }
  if (type === "DID_CHANGE_RENEWAL_STATUS") {
    const off =
      subtype === "AUTO_RENEW_DISABLED" || notification.renewalInfo?.autoRenewStatus === 0;
    await setSubscriptionState(deps, original, off ? "canceled" : "active");
    return { kind: "synced", granted: null };
  }
  return ignored;
}
