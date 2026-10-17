import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    // Founder months this order buys: 1 = monthly, 12 = yearly.
    months: integer("months").default(1).notNull(),
    // Founder period end this payment produced (set on the paid flip).
    founderUntil: integer("founder_until", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("payment_user_created_idx").on(table.userId, table.createdAt)],
);

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
    kind: text("kind", {
      enum: ["receipt", "admin", "founder_ending", "founder_expired", "accuracy_digest"],
    }).notNull(),
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
