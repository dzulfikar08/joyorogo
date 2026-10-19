import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import { user } from "./auth";

// Push notifications of the whole account (JoyoRogo web + native, JoyoFit). One JoyoRogo account is the hub: both apps
// register their Expo tokens here and every event goes through packages/api/src/lib/notify.ts. Contract: docs/push.md.
// Web Push endpoints stay in `push_subscription` (schema/plans.ts).

/** An Expo push token of one phone: JoyoRogo native or JoyoFit, signed in to this account. */
export const pushDevice = sqliteTable(
  "push_device",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    app: text("app", { enum: ["joyorogo", "joyofit"] }).notNull(),
    platform: text("platform", { enum: ["android", "ios"] }).notNull(),
    expoToken: text("expo_token").notNull(),
    // The language the app renders in, a fallback when the account has no saved one.
    locale: text("locale"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("push_device_token_uidx").on(table.expoToken),
    index("push_device_user_idx").on(table.userId),
  ],
);

/**
 * Per-account switches. A missing row means the defaults: every category on, quiet hours 21:30 - 06:30 WIB.
 * Categories: social (kudos, comments, replies, follows, new posts), group (poke, notes, challenges, members),
 * meal (food logging reminders, streak), weigh (weigh-in reminder), recap (weekly recap, target change, meal plan).
 */
export const pushPrefs = sqliteTable("push_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  social: integer("social", { mode: "boolean" }).notNull().default(true),
  group: integer("group_notes", { mode: "boolean" }).notNull().default(true),
  meal: integer("meal", { mode: "boolean" }).notNull().default(true),
  weigh: integer("weigh", { mode: "boolean" }).notNull().default(true),
  recap: integer("recap", { mode: "boolean" }).notNull().default(true),
  quietEnabled: integer("quiet_enabled", { mode: "boolean" }).notNull().default(true),
  // 'HH:MM' WIB; a start later than the end wraps over midnight.
  quietStart: text("quiet_start").notNull().default("21:30"),
  quietEnd: text("quiet_end").notNull().default("06:30"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * Every notification the pipeline accepted, and what became of it.
 * - queued: waits for `send_after` (quiet hours, a retry, a fan-out batch); the five-minute cron delivers it
 * - sent: delivered to at least one target; `tickets_json` holds Expo ticket ids until the receipts are read
 * - digest: over the category's daily cap, folded into the evening digest push
 * - digested / dropped / failed: closed (digested = counted by the digest; dropped = nobody to send to, superseded,
 *   muted meanwhile or stale; failed = transient errors ran out of attempts)
 * `dedupe_key` is unique per user: the same event never produces two rows.
 */
export const pushOutbox = sqliteTable(
  "push_outbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category", { enum: ["social", "group", "meal", "weigh", "recap"] }).notNull(),
    kind: text("kind").notNull(),
    // JSON: { title: Msg, body?: Msg, link: PushLink, app?: 'joyofit' } (lib/notify.ts), written in the reader's language at send time.
    payloadJson: text("payload_json").notNull(),
    dedupeKey: text("dedupe_key"),
    // Rows of one user with the same collapse key that wait together are replaced by the newest.
    collapseKey: text("collapse_key"),
    status: text("status", { enum: ["queued", "sent", "digest", "digested", "dropped", "failed"] })
      .notNull()
      .default("queued"),
    sendAfter: integer("send_after", { mode: "timestamp_ms" }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ticketsJson: text("tickets_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("push_outbox_dedupe_uidx").on(table.userId, table.dedupeKey),
    index("push_outbox_due_idx").on(table.status, table.sendAfter),
    index("push_outbox_user_cat_idx").on(table.userId, table.category, table.createdAt),
  ],
);

export type PushDeviceRow = typeof pushDevice.$inferSelect;
export type PushPrefsRow = typeof pushPrefs.$inferSelect;
export type PushOutboxRow = typeof pushOutbox.$inferSelect;
