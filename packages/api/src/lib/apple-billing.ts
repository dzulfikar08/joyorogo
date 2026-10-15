import { and, eq, sql } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { appleSubscription, payment } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";

import { appleAccountToken } from "./apple";
import type { AppleNotification, AppleTransaction } from "./apple";
import {
  addMonths,
  appleFounderGrant,
  appleSubscriptionGrant,
  planMonths,
} from "./tiers";
import type { FounderPlan } from "./tiers";

const CREDIT_ATTEMPTS = 3;

export type AppleBillingDeps = {
  db: Database;
  config: {
    /** Auto-renewable subscription product ids. */
    subscriptionIds: Record<FounderPlan, string>;
    /** Legacy non-renewing product ids; still credited when replayed. */
    legacyIds: Record<FounderPlan, string>;
    sandboxAllowlist?: string;
    /** Plan prices in IDR for transactions Apple does not bill in IDR. */
    fallbackPriceIdr: Record<FounderPlan, number>;
  };
  now?: () => Date;
};

export type AppleProductInfo = { plan: FounderPlan; subscription: boolean };

/** Which plan a product id sells, and whether it renews. null = not a Founder product. */
export function appleProductInfo(
  config: AppleBillingDeps["config"],
  productId: string,
): AppleProductInfo | null {
  if (productId === config.subscriptionIds.monthly) return { plan: "monthly", subscription: true };
  if (productId === config.subscriptionIds.yearly) return { plan: "yearly", subscription: true };
  if (productId === config.legacyIds.monthly) return { plan: "monthly", subscription: false };
  if (productId === config.legacyIds.yearly) return { plan: "yearly", subscription: false };
  return null;
}

/** Order id of an App Store transaction in the shared payment ledger. */
export function appleLedgerId(transactionId: string): string {
  return `apple:${transactionId}`;
}

type CreditResult =
  | { outcome: "granted"; until: Date; amountIdr: number }
  | { outcome: "already" | "refunded" | "expired" | "no-user" | "busy" };

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
    info: AppleProductInfo;
  },
): Promise<CreditResult> {
  const { db, config } = deps;
  const { transaction, info } = input;
  const ledgerId = appleLedgerId(transaction.transactionId);
  const months = planMonths(info.plan);
  const priceIdr = transaction.priceIdr ?? config.fallbackPriceIdr[info.plan];

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

    const [owner] = await db
      .select({ founderUntil: user.founderUntil })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!owner) return { outcome: "no-user" };

    const now = deps.now?.() ?? new Date();
    const previousMs = owner.founderUntil?.getTime() ?? null;
    let grant: { until: Date; amountIdr: number } | null;
    if (info.subscription) {
      grant = transaction.expiresDate
        ? appleSubscriptionGrant(
            transaction.environment,
            input.email,
            config.sandboxAllowlist,
            priceIdr,
            transaction.expiresDate,
            owner.founderUntil,
            now,
          )
        : null;
    } else {
      grant = appleFounderGrant(
        transaction.environment,
        input.email,
        config.sandboxAllowlist,
        priceIdr,
        owner.founderUntil,
        now,
        months,
      );
    }
    if (!grant) return { outcome: "expired" };
    const { until, amountIdr } = grant;

    const [, flipped] = await db.batch([
      db
        .insert(payment)
        .values({ orderId: ledgerId, userId: input.userId, amountIdr, months })
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
  | { ok: false; error: "wrong-product" | "other-account" | "no-user" | "busy" };

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
  const info = appleProductInfo(deps.config, transaction.productId);
  if (!info) return { ok: false, error: "wrong-product" };

  if (info.subscription) {
    if (
      transaction.appAccountToken &&
      transaction.appAccountToken.toLowerCase() !== (await appleAccountToken(input.userId))
    ) {
      return { ok: false, error: "other-account" };
    }
    const linkedUser = await linkSubscription(deps, input.userId, transaction);
    if (linkedUser !== input.userId) return { ok: false, error: "other-account" };
  }

  const credit = await creditTransaction(deps, { ...input, info });
  if (credit.outcome === "no-user") return { ok: false, error: "no-user" };
  if (credit.outcome === "busy") return { ok: false, error: "busy" };

  if (info.subscription && credit.outcome !== "refunded") {
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
    founderUntil: await founderUntilOf(deps.db, input.userId),
  };
}

/**
 * Takes back the Founder time a refunded or revoked transaction granted.
 * Ledger rows flip paid -> failed once, so duplicate notifications do nothing.
 * A subscription period gives up only when it is the current one: founder_until
 * drops to now unless the user holds time beyond that period (another
 * purchase). A legacy non-renewing month is subtracted. Zero-revenue sandbox
 * trials are left to lapse on their own.
 */
export async function revokeAppleTransaction(
  deps: Pick<AppleBillingDeps, "db" | "now">,
  transaction: AppleTransaction,
): Promise<"revoked" | "none"> {
  const { db } = deps;
  const ledgerId = appleLedgerId(transaction.transactionId);
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

    const now = deps.now?.() ?? new Date();
    const owner = { founderUntil: await founderUntilOf(db, row.userId) };
    const previousMs = owner.founderUntil?.getTime() ?? null;
    let reduced: Date | null = owner.founderUntil;
    if (owner.founderUntil) {
      if (transaction.expiresDate) {
        const current = owner.founderUntil.getTime() <= transaction.expiresDate.getTime();
        if (current && owner.founderUntil.getTime() > now.getTime()) reduced = now;
      } else {
        reduced = addMonths(owner.founderUntil, -row.months);
      }
    }

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
  const info = appleProductInfo(deps.config, transaction.productId);
  if (!info) return ignored;

  // Refunds hit the ledger by transaction id: no subscription link needed,
  // and legacy non-renewing purchases are covered too.
  if (REVOKE_TYPES[type] === true) {
    const revoked = await revokeAppleTransaction(deps, transaction);
    if (info.subscription) {
      await setSubscriptionState(deps, transaction.originalTransactionId, "revoked");
    }
    return revoked === "revoked" ? { kind: "revoked", granted: null } : ignored;
  }
  if (!info.subscription) return ignored;

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
      info,
    });
    // A concurrent credit still settling: let Apple redeliver.
    if (credit.outcome === "busy") throw new Error("apple credit busy");
    if (credit.outcome === "no-user") return { kind: "unmapped", granted: null };
    if (credit.outcome === "refunded") return ignored;
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
