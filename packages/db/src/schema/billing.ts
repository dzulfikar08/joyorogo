import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    // Founder period end this payment produced (set on the paid flip).
    founderUntil: integer("founder_until", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("payment_user_created_idx").on(table.userId, table.createdAt)],
);
