import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * Joyo Keluarga (docs/pricing/joyo-keluarga.md): one payer, Pro for up to HOUSEHOLD_MAX_SEATS accounts. A household
 * carries only what seat management needs: the member list, the paid period and invites. Nobody sees another
 * member's data because they share one.
 */
export const household = sqliteTable(
  "household",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The paid period; written only by billing code. Members are Pro while it runs (proUntil in lib/household.ts).
    paidUntil: integer("paid_until", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("household_owner_uidx").on(table.ownerId)],
);

/** Everyone in a household, the owner included (role 'owner'). One household per account. */
export const householdMember = sqliteTable(
  "household_member",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.userId] }),
    uniqueIndex("household_member_user_uidx").on(table.userId),
  ],
);

/**
 * Single-use invites that expire after 7 days. Only the SHA-256 of the code is stored, so a database read never
 * yields a working link. A pending invite (unused, not revoked, not expired) holds a seat.
 */
export const householdInvite = sqliteTable(
  "household_invite",
  {
    codeHash: text("code_hash").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("household_invite_household_idx").on(table.householdId)],
);

/**
 * Seat churn log (joins, leaves, removals), for the churn limit and support. user_id goes null when that account is
 * deleted, so deleting a member never hands the household its join back.
 */
export const householdEvent = sqliteTable(
  "household_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["join", "leave", "removed"] }).notNull(),
    at: integer("at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("household_event_household_at_idx").on(table.householdId, table.at)],
);
