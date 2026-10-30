import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * One DOKU Checkout order for a month of Founder. The webhook flips
 * pending -> paid exactly once; only that flip extends user.founder_until.
 */
export const payment = sqliteTable(
  "payment",
  {
    orderId: text("order_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amountIdr: integer("amount_idr").notNull(),
    status: text("status", { enum: ["pending", "paid", "failed"] })
      .default("pending")
      .notNull(),
    paymentUrl: text("payment_url"),
    // Founder months this order buys: 1 = monthly, 12 = yearly (0 = a plan-change proration charge that grants no time).
    months: integer("months").default(1).notNull(),
    // What a Polar order actually charged, in US cents before tax (null on every other gateway).
    // amount_idr is then the IDR equivalent the ledger counts, priced like a non-IDR Apple transaction.
    amountUsdCents: integer("amount_usd_cents"),
    // What a Polar order really charged, any currency: ISO code (USD, MYR, SGD), net and tax in that currency's
    // minor units (sen/cents; tax is on top of net, Polar prices are tax-inclusive so net = price - tax). Null elsewhere.
    chargedCurrency: text("charged_currency"),
    chargedAmountMinor: integer("charged_amount_minor"),
    chargedTaxMinor: integer("charged_tax_minor"),
    // IDR per 1 major unit of chargedCurrency when amount_idr was converted at a real rate (MYR/SGD orders; null for
    // USD orders, which are priced like Apple, and for free or proration charges), with where the rate came from
    // ("frankfurter:<rate date>" = ECB reference rate, "static:<date>" = the in-code fallback table).
    fxRateIdr: real("fx_rate_idr"),
    fxSource: text("fx_source"),
    // 1 = a test purchase that was not really charged (Play license tester, Apple Sandbox, Polar sandbox), 0 = real, null = unknown (old rows).
    // Excluded from revenue totals.
    isTest: integer("is_test"),
    // RevKlik visitor and session ids of the browser that opened a web checkout (the tag's _kp_vid / _kp_sid), so the
    // forwarded sale inherits that visitor's utm/referrer/geo. Null for native purchases and renewals.
    revklikVisitorId: text("revklik_visitor_id"),
    revklikSessionId: text("revklik_session_id"),
    // Founder period end this payment produced (set on the paid flip).
    founderUntil: integer("founder_until", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("payment_user_created_idx").on(table.userId, table.createdAt),
    // Admin orders list: newest first, order id as the tiebreak.
    index("payment_created_idx").on(table.createdAt, table.orderId),
  ],
);

/**
 * email_log.kind. Plain text in D1 (no CHECK), so a new kind is a TS-only change.
 * `broadcast:<campaignId>` (ref = userId) is one announcement mail per user;
 * `broadcast_test:<campaignId>` (ref = "<userId>:<sentMs>-<random>") is an admin test send;
 * `testflight_notice` (ref = userId) is the once-per-user mail after a TestFlight (Sandbox) purchase.
 * `lifecycle_activate_1` / `lifecycle_activate_2` (ref = userId) nudge accounts that never logged a meal;
 * `lifecycle_winback` (ref = "<userId>:<lastActiveMs>") is one mail per lapse (apps/server/src/lifecycle-email.ts).
 */
export type EmailLogKind =
  | "receipt"
  | "admin"
  | "founder_ending"
  | "founder_expired"
  | "accuracy_digest"
  | "testflight_notice"
  | "lifecycle_activate_1"
  | "lifecycle_activate_2"
  | "lifecycle_winback"
  | `broadcast:${string}`
  | `broadcast_test:${string}`;

/**
 * One row per transactional email we decided to send, written (or ignored)
 * BEFORE the actual send so concurrent webhooks/crons never double-send.
 * ref is the order id for receipts/admin notices, "<userId>:<untilMs>" for
 * founder expiry reminders — UNIQUE(kind, ref) makes each mail once-per-cause.
 */
export const emailLog = sqliteTable(
  "email_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<EmailLogKind>().notNull(),
    ref: text("ref").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("email_log_kind_ref_uidx").on(table.kind, table.ref)],
);

/**
 * Google Play subscription purchase tokens, each linked to the one account that
 * redeemed it. The link is what stops a token being credited to a second
 * account, and what lets a Play notification (renewal, refund) find its user.
 * Founder time itself is credited per Play order in `payment` as `google:<orderId>`.
 */
export const googlePurchase = sqliteTable(
  "google_purchase",
  {
    purchaseToken: text("purchase_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    basePlanId: text("base_plan_id").notNull(),
    // Last subscriptionsv2 state we saw (pending, active, canceled, grace, hold, paused, expired).
    state: text("state").notNull(),
    latestOrderId: text("latest_order_id"),
    // 1 when Play reported a testPurchase (license tester, not charged), 0 real, null = unknown (rows before this column).
    isTest: integer("is_test"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("google_purchase_user_idx").on(table.userId)],
);

/**
 * App Store auto-renewable subscriptions, each linked to the one account that
 * redeemed it. `original_transaction_id` is stable across renewals, so it is
 * what lets an App Store Server Notification (renewal, refund, expiry) find
 * its user, and what stops one subscription crediting a second account.
 * Founder time itself is credited per transaction in `payment` as `apple:<transactionId>`.
 */
export const appleSubscription = sqliteTable(
  "apple_subscription",
  {
    originalTransactionId: text("original_transaction_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    environment: text("environment", { enum: ["Sandbox", "Production"] }).notNull(),
    // The StoreKit appAccountToken the app bought with (see appleAccountToken); fallback key for notifications.
    appAccountToken: text("app_account_token"),
    // Last state we saw: active, canceled (auto-renew off), grace, retry (billing retry), expired, revoked.
    state: text("state").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("apple_subscription_user_idx").on(table.userId),
    index("apple_subscription_token_idx").on(table.appAccountToken),
  ],
);

/**
 * Polar (USD, merchant of record) subscriptions, each linked to the one account
 * that bought it. Pro time itself is credited per paid order in `payment` as
 * `polar:<orderId>`; this row carries what the account page needs (state, renewal
 * date, cancel-at-period-end) and lets an event without a customer external id
 * find its user. `modified_at` is Polar's own modified time: an older event never
 * overwrites a newer state.
 */
export const polarSubscription = sqliteTable(
  "polar_subscription",
  {
    subscriptionId: text("subscription_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull(),
    productId: text("product_id").notNull(),
    plan: text("plan", { enum: ["monthly", "yearly"] }).notNull(),
    // active, canceled (auto-renew off, Pro until the period end), past_due, paused, revoked.
    state: text("state").notNull(),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).default(false).notNull(),
    polarModifiedAt: integer("polar_modified_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("polar_subscription_user_idx").on(table.userId)],
);

/** Polar webhook deliveries already processed, by Standard Webhooks `webhook-id`. */
export const polarEvent = sqliteTable("polar_event", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/**
 * Revenue events waiting to be forwarded to RevKlik (docs/revklik-forwarding.md). One row per ledger event, keyed by the
 * RevKlik external_id (sale = payment.order_id, refund = order_id + ':refund'), so enqueueing twice is a no-op.
 * forwarded_at set = delivered (or already known to RevKlik); attempts >= the cap or a 4xx parks the row with last_error.
 */
export const revklikOutbox = sqliteTable(
  "revklik_outbox",
  {
    externalId: text("external_id").primaryKey(),
    // The /api/v1/events/server body without site_id and token (those come from the Worker env at send time).
    body: text("body").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    forwardedAt: integer("forwarded_at", { mode: "timestamp_ms" }),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("revklik_outbox_pending_idx").on(table.forwardedAt, table.createdAt)],
);
