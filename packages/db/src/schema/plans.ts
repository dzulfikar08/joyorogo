import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { exerciseLog } from "./fitness";

// Tables for strength training (workout_*), food prices (plate), and web push
// reminders (push_subscription). Dates are WIB calendar days 'YYYY-MM-DD'.

/** One strength-training session; its kcal is mirrored into exercise_log for Burn. */
export const workoutSession = sqliteTable(
  "workout_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    name: text("name").notNull(),
    durationMin: real("duration_min"),
    note: text("note"),
    // exercise_log row carrying this session's kcal; deleted with the session
    exerciseLogId: text("exercise_log_id").references(() => exerciseLog.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("workout_session_user_date_idx").on(table.userId, table.date)],
);

/** One performed set. exercise_id is a key of the code catalog (lib/exercises). */
export const workoutSet = sqliteTable(
  "workout_set",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => workoutSession.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    // order within the session
    position: integer("position").notNull(),
    reps: integer("reps").notNull(),
    // null for bodyweight sets
    weightKg: real("weight_kg"),
    rpe: real("rpe"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("workout_set_session_idx").on(table.sessionId),
    index("workout_set_user_exercise_idx").on(table.userId, table.exerciseId),
  ],
);

/**
 * What was paid for: one scan, one Cerita meal, or one manual entry. Its
 * components are the food_log rows with this plate_id; price is per plate.
 */
export const plate = sqliteTable(
  "plate",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    meal: text("meal").notNull(),
    name: text("name").notNull(),
    place: text("place"),
    priceIdr: integer("price_idr"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("plate_user_date_idx").on(table.userId, table.date)],
);

/** Browser Web Push endpoint for fasting reminders (one row per device). */
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // last reminder key sent ('YYYY-MM-DD:open' etc.) so cron never repeats one
    lastSentKey: text("last_sent_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("push_subscription_endpoint_uidx").on(table.endpoint)],
);
