import { sql } from "drizzle-orm";

import { payment } from "@joyorogo/db/schema/billing";

/** Ledger rows that count as money: not a test purchase (is_test null = unknown, old rows, counted). */
export const realPayment = sql`coalesce(${payment.isTest}, 0) = 0`;
