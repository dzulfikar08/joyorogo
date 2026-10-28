import { and, eq, like, ne, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";
import { payment, polarEvent, polarSubscription } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";

import { idrQuote, minorToIdr } from "./fx";
import type { FxQuote, FxRateSource } from "./fx";
import { notifyLedger } from "./revklik";
import type { LedgerHook } from "./revklik";
import { POLAR_SANDBOX_URL, polarLedgerId, polarProductPlan } from "./polar";
import type { PolarConfig } from "./polar";
import { addMonths, nextFounderUntil, planMonths } from "./tiers";
import type { FounderPlan } from "./tiers";

const CREDIT_ATTEMPTS = 3;

export type PolarBillingDeps = {
  db: Database;
  config: Pick<PolarConfig, "productIds" | "priceUsdCents"> & Partial<Pick<PolarConfig, "baseUrl">>;
  /** Plan prices in IDR: the ledger's equivalent of a USD order, as for non-IDR Apple transactions. */
  fallbackPriceIdr: Record<FounderPlan, number>;
  /** IDR rate for a MYR/SGD order (see fx.ts); without it only the in-code fallback table prices those. */
  fxRate?: FxRateSource;
  now?: () => Date;
  /** Queues the ledger event for RevKlik after a paid flip or a refund. */
  onLedger?: LedgerHook;
};

const customerSchema = z.object({ id: z.string(), external_id: z.string().nullish() });

const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  customer_id: z.string(),
  product_id: z.string(),
  created_at: z.string(),
  modified_at: z.string().nullish(),
  current_period_end: z.string().nullish(),
  cancel_at_period_end: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  customer: customerSchema.nullish(),
});
type PolarSubscription = z.infer<typeof subscriptionSchema>;

const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  billing_reason: z.string(),
  currency: z.string(),
  net_amount: z.number().int(),
  tax_amount: z.number().int().default(0),
  created_at: z.string().nullish(),
  customer_id: z.string(),
  product_id: z.string().nullish(),
  subscription_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  customer: customerSchema.nullish(),
  subscription: subscriptionSchema.nullish(),
});
type PolarOrder = z.infer<typeof orderSchema>;

const envelopeSchema = z.object({ type: z.string(), data: z.unknown() });

export type PolarEventResult = {
  outcome:
    | "granted"
    | "already"
    | "refunded"
    | "revoked"
    | "synced"
    | "recorded"
    | "ignored"
    | "no-user"
    | "duplicate"
    | "invalid"
    | "busy";
  /** Set on "granted" with revenue: the caller sends the admin notice. */
  granted?: { orderId: string; userId: string; amountIdr: number };
};

/** Subscription states that keep (or may regain) Pro: another one means a revoke is not the account's end. */
const LIVE_STATES = ["active", "canceled", "past_due", "paused"];

/**
 * Processes one verified Polar webhook delivery. Idempotent by the delivery's
 * `webhook-id`: a redelivery is acknowledged without work, and the ledger row
 * `polar:<orderId>` stops a replay under a new delivery id crediting twice.
 * "busy" (lost every race on founder_until) is the only outcome the caller
 * should answer with a retryable status. Events are recorded only after they
 * were handled, so a failure is redelivered.
 */
export async function processPolarEvent(
  deps: PolarBillingDeps,
  eventId: string,
  payload: unknown,
): Promise<PolarEventResult> {
  const { db } = deps;
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return { outcome: "invalid" };
  const [seen] = await db
    .select({ eventId: polarEvent.eventId })
    .from(polarEvent)
    .where(eq(polarEvent.eventId, eventId))
    .limit(1);
  if (seen) return { outcome: "duplicate" };

  const result = await dispatch(deps, envelope.data.type, envelope.data.data);
  if (result.outcome !== "busy") {
    await db.insert(polarEvent).values({ eventId, type: envelope.data.type }).onConflictDoNothing();
  }
  return result;
}

async function dispatch(deps: PolarBillingDeps, type: string, data: unknown): Promise<PolarEventResult> {
  if (type === "order.paid" || type === "order.refunded") {
    const order = orderSchema.safeParse(data);
    if (!order.success) {
      console.error(`polar ${type}: unreadable order payload: ${order.error.message}`);
      return { outcome: "invalid" };
    }
    return type === "order.paid" ? handleOrderPaid(deps, order.data) : handleOrderRefunded(deps, order.data);
  }
  if (type.startsWith("subscription.")) {
    const subscription = subscriptionSchema.safeParse(data);
    if (!subscription.success) {
      console.error(`polar ${type}: unreadable subscription payload: ${subscription.error.message}`);
      return { outcome: "invalid" };
    }
    return handleSubscription(deps, type, subscription.data);
  }
  return { outcome: "ignored" };
}

async function resolveUserId(
  db: Database,
  hint: {
    customer?: { external_id?: string | null } | null;
    metadata?: Record<string, unknown> | null;
    subscriptionId?: string | null;
  },
): Promise<string | null> {
  if (hint.customer?.external_id) return hint.customer.external_id;
  const fromMetadata = hint.metadata?.user_id;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  if (hint.subscriptionId) {
    const [row] = await db
      .select({ userId: polarSubscription.userId })
      .from(polarSubscription)
      .where(eq(polarSubscription.subscriptionId, hint.subscriptionId))
      .limit(1);
    if (row) return row.userId;
  }
  return null;
}

async function founderUntilOf(db: Database, userId: string): Promise<{ founderUntil: Date | null } | null> {
  const [row] = await db
    .select({ founderUntil: user.founderUntil })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * IDR the ledger counts for an order.
 * - USD: priced like a non-IDR Apple transaction: the plan's IDR price, scaled down by what a discount code took
 *   off the USD list price. A free (100% off) order is Rp0, so it never takes a ladder seat or sets a grandfathered
 *   price.
 * - Any currency with a rate (MYR, SGD): what was really charged (net of tax) at the recorded rate.
 * - A currency with no rate at all: the plan's IDR price, as before.
 */
function ledgerAmountIdr(deps: PolarBillingDeps, order: PolarOrder, plan: FounderPlan, fx: FxQuote | null): number {
  if (order.net_amount <= 0) return 0;
  const fallback = deps.fallbackPriceIdr[plan];
  if (order.currency.toLowerCase() === "usd") {
    const share = Math.min(1, order.net_amount / deps.config.priceUsdCents[plan]);
    return Math.max(1, Math.round(fallback * share));
  }
  if (!fx) return fallback;
  return Math.max(1, minorToIdr(order.net_amount, order.currency, fx.rate));
}

/** The day an order was placed, for a dated rate: its own timestamp, else the clock (a delivery follows the payment within seconds). */
function orderDate(deps: PolarBillingDeps, order: PolarOrder): Date {
  const created = order.created_at ? new Date(order.created_at) : null;
  return created && !Number.isNaN(created.getTime()) ? created : (deps.now?.() ?? new Date());
}

async function handleOrderPaid(deps: PolarBillingDeps, order: PolarOrder): Promise<PolarEventResult> {
  const plan = polarProductPlan(deps.config, order.product_id);
  if (!plan) return { outcome: "ignored" };
  if (order.status !== "paid") return { outcome: "ignored" };
  const userId = await resolveUserId(deps.db, {
    customer: order.customer,
    metadata: order.metadata,
    subscriptionId: order.subscription_id,
  });
  if (!userId || !(await founderUntilOf(deps.db, userId))) {
    console.error(`polar order ${order.id} paid but no JoyoRogo account matches (user ${userId ?? "unknown"})`);
    return { outcome: "no-user" };
  }

  const result = await creditOrder(deps, order, plan, userId);
  if (order.subscription && order.subscription.status !== "incomplete") {
    await syncSubscription(deps, "order.paid", order.subscription, userId);
  }
  return result;
}

/**
 * Credits one paid Polar order to the account's Pro period, in one D1 batch:
 * the pending ledger row, the paid flip, and the user update. The flip lands
 * only while founder_until still holds the value we extended from, so
 * redelivery and concurrent deliveries extend exactly once. Months stack on
 * the remaining period like the web gateways. A plan-change proration charge
 * (billing_reason subscription_update) is recorded but grants no time: the
 * period it changes was already credited by the order that opened it.
 */
async function creditOrder(
  deps: PolarBillingDeps,
  order: PolarOrder,
  plan: FounderPlan,
  userId: string,
): Promise<PolarEventResult> {
  const { db } = deps;
  const ledgerId = polarLedgerId(order.id);
  const prorationOnly = order.billing_reason === "subscription_update";
  const months = prorationOnly ? 0 : planMonths(plan);
  const isUsd = order.currency.toLowerCase() === "usd";
  const needsRate = !prorationOnly && !isUsd && order.net_amount > 0;
  const fx = needsRate ? await idrQuote(deps.fxRate, order.currency, orderDate(deps, order)) : null;
  const amountIdr = prorationOnly ? 0 : ledgerAmountIdr(deps, order, plan, fx);
  const charged = {
    amountUsdCents: isUsd ? order.net_amount : null,
    chargedCurrency: order.currency.toUpperCase(),
    chargedAmountMinor: order.net_amount,
    chargedTaxMinor: order.tax_amount,
    fxRateIdr: fx?.rate ?? null,
    fxSource: fx?.source ?? null,
    isTest: deps.config.baseUrl === POLAR_SANDBOX_URL ? 1 : 0,
  };

  for (let attempt = 0; attempt < CREDIT_ATTEMPTS; attempt++) {
    const [existing] = await db
      .select({ status: payment.status })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);
    if (existing?.status === "paid") return { outcome: "already" };
    if (existing?.status === "failed") return { outcome: "refunded" };

    const owner = await founderUntilOf(db, userId);
    if (!owner) return { outcome: "no-user" };
    const now = deps.now?.() ?? new Date();

    if (months === 0) {
      await db
        .insert(payment)
        .values({ orderId: ledgerId, userId, amountIdr, months, ...charged, status: "paid", paidAt: now })
        .onConflictDoNothing();
      await notifyLedger(deps.onLedger, ledgerId, "paid");
      return { outcome: "recorded" };
    }

    const previousMs = owner.founderUntil?.getTime() ?? null;
    const until = nextFounderUntil(owner.founderUntil, now, months);
    const [, flipped] = await db.batch([
      db
        .insert(payment)
        .values({ orderId: ledgerId, userId, amountIdr, months, ...charged })
        .onConflictDoNothing(),
      db
        .update(payment)
        .set({ status: "paid", paidAt: now, founderUntil: until })
        .where(
          and(
            eq(payment.orderId, ledgerId),
            eq(payment.status, "pending"),
            sql`(select ${user.founderUntil} from ${user} where ${user.id} = ${userId}) is ${previousMs}`,
          ),
        )
        .returning({ orderId: payment.orderId }),
      db
        .update(user)
        .set({ founderUntil: until })
        .where(
          and(
            eq(user.id, userId),
            sql`exists (select 1 from ${payment} where ${payment.orderId} = ${ledgerId} and ${payment.status} = 'paid' and ${payment.paidAt} = ${now.getTime()})`,
          ),
        ),
    ]);
    if (flipped.length === 1) {
      await notifyLedger(deps.onLedger, ledgerId, "paid");
      return { outcome: "granted", granted: { orderId: ledgerId, userId, amountIdr } };
    }
    // Lost a race with another credit: re-read and try again from the new period.
  }
  return { outcome: "busy" };
}

/**
 * A fully refunded order takes back the Pro time it granted (its months come
 * off the current period, never below now) and can never be credited again,
 * even if its `order.paid` is delivered afterwards. Partial refunds change
 * nothing. Ledger rows flip paid -> failed once, so redelivery does nothing.
 */
async function handleOrderRefunded(deps: PolarBillingDeps, order: PolarOrder): Promise<PolarEventResult> {
  const { db } = deps;
  if (!polarProductPlan(deps.config, order.product_id)) return { outcome: "ignored" };
  if (order.status !== "refunded") return { outcome: "ignored" };
  const ledgerId = polarLedgerId(order.id);

  for (let attempt = 0; attempt < CREDIT_ATTEMPTS; attempt++) {
    const [row] = await db
      .select({ userId: payment.userId, status: payment.status, months: payment.months })
      .from(payment)
      .where(eq(payment.orderId, ledgerId))
      .limit(1);

    if (!row) {
      // Refund seen before the payment: block the later order.paid from granting.
      const userId = await resolveUserId(db, {
        customer: order.customer,
        metadata: order.metadata,
        subscriptionId: order.subscription_id,
      });
      if (!userId || !(await founderUntilOf(db, userId))) return { outcome: "no-user" };
      await db
        .insert(payment)
        .values({ orderId: ledgerId, userId, amountIdr: 0, months: 0, status: "failed" })
        .onConflictDoNothing();
      return { outcome: "refunded" };
    }
    if (row.status !== "paid") return { outcome: row.status === "failed" ? "already" : "ignored" };

    const now = deps.now?.() ?? new Date();
    const owner = await founderUntilOf(db, row.userId);
    const previousMs = owner?.founderUntil?.getTime() ?? null;
    let reduced = owner?.founderUntil ?? null;
    if (reduced && row.months > 0 && reduced.getTime() > now.getTime()) {
      const back = addMonths(reduced, -row.months);
      reduced = back.getTime() > now.getTime() ? back : now;
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
    if (flipped.length === 1) {
      await notifyLedger(deps.onLedger, ledgerId, "refund");
      return { outcome: "refunded" };
    }
  }
  return { outcome: "busy" };
}

/** Account-page state of a Polar subscription. */
function subscriptionState(type: string, sub: PolarSubscription): string {
  if (type === "subscription.revoked") return "revoked";
  switch (sub.status) {
    case "active":
    case "trialing":
      return sub.cancel_at_period_end ? "canceled" : "active";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "revoked";
    default:
      return "incomplete";
  }
}

async function handleSubscription(
  deps: PolarBillingDeps,
  type: string,
  sub: PolarSubscription,
): Promise<PolarEventResult> {
  if (!polarProductPlan(deps.config, sub.product_id)) return { outcome: "ignored" };
  const userId = await resolveUserId(deps.db, {
    customer: sub.customer,
    metadata: sub.metadata,
    subscriptionId: sub.id,
  });
  if (!userId || !(await founderUntilOf(deps.db, userId))) {
    console.error(`polar ${type} ${sub.id}: no JoyoRogo account matches (user ${userId ?? "unknown"})`);
    return { outcome: "no-user" };
  }
  await syncSubscription(deps, type, sub, userId);
  if (type === "subscription.revoked") return endAccess(deps, userId, sub.id);
  return { outcome: "synced" };
}

/**
 * Stores the subscription's latest state. First link wins the owner; an event
 * older than the stored one (Polar's `modified_at`) never overwrites it.
 */
async function syncSubscription(
  deps: PolarBillingDeps,
  type: string,
  sub: PolarSubscription,
  userId: string,
): Promise<void> {
  const plan = polarProductPlan(deps.config, sub.product_id);
  if (!plan) return;
  const modifiedMs = Date.parse(sub.modified_at ?? sub.created_at);
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const values = {
    productId: sub.product_id,
    plan,
    state: subscriptionState(type, sub),
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    polarModifiedAt: new Date(Number.isFinite(modifiedMs) ? modifiedMs : Date.now()),
    updatedAt: deps.now?.() ?? new Date(),
  };
  await deps.db
    .insert(polarSubscription)
    .values({ subscriptionId: sub.id, userId, customerId: sub.customer_id, ...values })
    .onConflictDoUpdate({
      target: polarSubscription.subscriptionId,
      set: values,
      setWhere: sql`${polarSubscription.polarModifiedAt} <= ${values.polarModifiedAt.getTime()}`,
    });
}

/**
 * `subscription.revoked`: billing ended. After a normal cancel this lands at the
 * period end, when the time we credited has already run out, so nothing changes.
 * An immediate revocation by the merchant cuts the remaining Polar-bought time
 * to now. Time that came from another purchase (founder_until beyond the last
 * Polar grant) and accounts with another live Polar subscription are left alone.
 */
async function endAccess(deps: PolarBillingDeps, userId: string, subscriptionId: string): Promise<PolarEventResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const [others] = await db
    .select({ n: sql<number>`count(*)` })
    .from(polarSubscription)
    .where(
      and(
        eq(polarSubscription.userId, userId),
        ne(polarSubscription.subscriptionId, subscriptionId),
        inArray(polarSubscription.state, LIVE_STATES),
      ),
    );
  if ((others?.n ?? 0) > 0) return { outcome: "synced" };

  const [grant] = await db
    .select({ latest: sql<number | null>`max(${payment.founderUntil})` })
    .from(payment)
    .where(and(eq(payment.userId, userId), eq(payment.status, "paid"), like(payment.orderId, "polar:%")));
  const owner = await founderUntilOf(db, userId);
  const current = owner?.founderUntil ?? null;
  if (!current || grant?.latest == null) return { outcome: "synced" };
  if (current.getTime() <= now.getTime() || current.getTime() > grant.latest) return { outcome: "synced" };

  await db
    .update(user)
    .set({ founderUntil: now })
    .where(and(eq(user.id, userId), sql`${user.founderUntil} is ${current.getTime()}`));
  return { outcome: "revoked" };
}
