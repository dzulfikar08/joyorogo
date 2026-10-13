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
    kind: text("kind", { enum: ["receipt", "admin", "founder_ending", "founder_expired"] }).notNull(),
    ref: text("ref").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("email_log_kind_ref_uidx").on(table.kind, table.ref)],
);
