import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Threads mention bot (docs/threads-bot.md): someone tags the brand account on a food photo and gets a calorie estimate
// as a reply. Two tables. Neither holds a photo: the image is read from Threads into memory for one scan and dropped.

/** The one brand Threads account the bot posts as: long-lived token (60 days, refreshed in lib/threads-bot/token.ts) and the mentions cursor. */
export const threadsAccount = sqliteTable("threads_account", {
  // Always 1: there is a single brand account.
  id: integer("id").primaryKey(),
  threadsUserId: text("threads_user_id"),
  username: text("username"),
  accessToken: text("access_token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  // 'ok' = more than 7 days left; 'expiring' = refresh due or failing; 'expired' = past expires_at.
  status: text("status", { enum: ["ok", "expiring", "expired"] })
    .notNull()
    .default("ok"),
  // 'oauth' = admin Connect flow; 'seed' = the THREADS_ACCESS_TOKEN secret.
  source: text("source", { enum: ["oauth", "seed"] }).notNull(),
  refreshedAt: integer("refreshed_at", { mode: "timestamp_ms" }),
  refreshAttemptedAt: integer("refresh_attempted_at", { mode: "timestamp_ms" }),
  // Unix seconds of the newest mention the cron poll has seen (the `since` of the next GET /{user-id}/mentions).
  mentionsSince: integer("mentions_since"),
  lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

export const THREADS_MENTION_STATUS = [
  // Seen, not decided yet (also: a Graph call failed on the way, the cron sweep retries it).
  "received",
  // Slot taken (caps counted), the model is running.
  "scanning",
  // Dropped by a filter or the food gate; `skip_reason` says which.
  "skipped",
  // Draft waiting in the admin queue (review mode, or an auto publish that failed).
  "pending_review",
  // An approve (or auto publish) is posting it right now.
  "publishing",
  "sent",
  "rejected",
  // The model or the image fetch failed; nothing was sent.
  "failed",
] as const;

/**
 * One mention of the brand account, keyed by the Threads media id of the post that tagged us (the idempotency key: a
 * webhook retry and the cron poll land on the same row). Keeps only what the admin needs: who, what the estimate
 * said, what happened. No photo, no post text. The photo shown to an admin is fetched live from Threads.
 */
export const threadsMention = sqliteTable(
  "threads_mention",
  {
    mediaId: text("media_id").primaryKey(),
    // Lower-case Threads username of the person who tagged us ('' when Threads did not say).
    authorUsername: text("author_username").notNull(),
    // The post that holds the photo: the mention itself or the post it replies to. Lets the admin page fetch the picture.
    sourceMediaId: text("source_media_id"),
    status: text("status", { enum: THREADS_MENTION_STATUS }).notNull().default("received"),
    // Why a mention was skipped: stale, own_post, own_thread, no_image, duplicate_photo, user_cap, global_cap, not_food.
    skipReason: text("skip_reason"),
    // 'estimate' = kcal ranges per dish; 'unclear' = the short polite "photo not clear enough" reply.
    kind: text("kind", { enum: ["estimate", "unclear"] }),
    // JSON [{ name, kcal, low, high }]: dish names and the kcal range shown in the reply.
    dishesJson: text("dishes_json"),
    kcalLow: integer("kcal_low"),
    kcalHigh: integer("kcal_high"),
    // Draft, and after sending the exact text that went out (<= 500 characters).
    replyText: text("reply_text"),
    // THREADS_BOT_MODE when the draft was made: 'review' or 'auto'.
    mode: text("mode", { enum: ["review", "auto"] }),
    // Media id of our published reply.
    replyMediaId: text("reply_media_id"),
    // Retries of the Graph steps before the model call.
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    // Set when the slot was taken; the per-user and global daily caps count rows by it.
    scannedAt: integer("scanned_at", { mode: "timestamp_ms" }),
    // Admin email that approved or rejected.
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("threads_mention_author_scanned_idx").on(table.authorUsername, table.scannedAt),
    index("threads_mention_scanned_idx").on(table.scannedAt),
    index("threads_mention_status_created_idx").on(table.status, table.createdAt),
    index("threads_mention_source_idx").on(table.sourceMediaId),
  ],
);
