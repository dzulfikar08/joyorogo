import { relations, sql } from "drizzle-orm";
import {
  integer,
  index,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// 'male' | 'female'
// 'low' | 'mid' | 'high' — daily-life activity; exercise is logged separately and counted in Burn
// targetDate and date columns hold WIB calendar days as 'YYYY-MM-DD'
export const profile = sqliteTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  shareCode: text("share_code"),
  shareEnabled: integer("share_enabled", { mode: "boolean" }).notNull().default(false),
  birthYear: integer("birth_year").notNull(),
  gender: text("gender").notNull(),
  heightCm: real("height_cm").notNull(),
  startWeightKg: real("start_weight_kg").notNull(),
  targetWeightKg: real("target_weight_kg").notNull(),
  targetDate: text("target_date").notNull(),
  activityLevel: text("activity_level").notNull(),
  // Ramadan schedule: 'auto' follows the Hijri calendar, on/off force it.
  ramadanMode: text("ramadan_mode", { enum: ["auto", "on", "off"] })
    .notNull()
    .default("auto"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const weightLog = sqliteTable(
  "weight_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    weightKg: real("weight_kg").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("weight_log_user_date_uidx").on(table.userId, table.date)],
);

export const foodLog = sqliteTable(
  "food_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    // 'sarapan' | 'makan_siang' | 'makan_malam' | 'snack'
    meal: text("meal").notNull(),
    name: text("name").notNull(),
    kcal: real("kcal").notNull(),
    protein: real("protein"),
    carbs: real("carbs"),
    fat: real("fat"),
    fiber: real("fiber"),
    // 'manual' | 'ai'
    source: text("source").notNull().default("manual"),
    // raw AI breakdown kept for reference; photos themselves are never stored
    // scan_id keys the background-removed dish sticker in R2 (scans/<id>.png);
    // the original photo is transformed in-memory and never persisted
    scanId: text("scan_id"),
    itemsJson: text("items_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("food_log_user_date_idx").on(table.userId, table.date)],
);

export const exerciseLog = sqliteTable(
  "exercise_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    type: text("type"),
    name: text("name").notNull(),
    durationMin: real("duration_min"),
    kcal: real("kcal").notNull(),
    // 'manual' | 'strava' | 'health_connect'
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("exercise_log_user_date_idx").on(table.userId, table.date),
    // NULL external_id (manual rows) never collides: SQLite UNIQUE treats NULLs as distinct
    uniqueIndex("exercise_log_source_external_uidx").on(
      table.userId,
      table.source,
      table.externalId,
    ),
  ],
);

export const sleepLog = sqliteTable(
  "sleep_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    hours: real("hours").notNull(),
    // 'manual' | 'health_connect' — a manual entry is user intent and is
    // never auto-overwritten by a later Health Connect sync
    source: text("source").notNull().default("manual"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("sleep_log_user_date_uidx").on(table.userId, table.date)],
);

export const stravaAccount = sqliteTable("strava_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  athleteId: text("athlete_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const profileRelations = relations(profile, ({ one }) => ({
  user: one(user, {
    fields: [profile.userId],
    references: [user.id],
  }),
}));

export const weightLogRelations = relations(weightLog, ({ one }) => ({
  user: one(user, {
    fields: [weightLog.userId],
    references: [user.id],
  }),
}));

export const foodLogRelations = relations(foodLog, ({ one }) => ({
  user: one(user, {
    fields: [foodLog.userId],
    references: [user.id],
  }),
}));

export const exerciseLogRelations = relations(exerciseLog, ({ one }) => ({
  user: one(user, {
    fields: [exerciseLog.userId],
    references: [user.id],
  }),
}));

export const sleepLogRelations = relations(sleepLog, ({ one }) => ({
  user: one(user, {
    fields: [sleepLog.userId],
    references: [user.id],
  }),
}));

export const stravaAccountRelations = relations(stravaAccount, ({ one }) => ({
  user: one(user, {
    fields: [stravaAccount.userId],
    references: [user.id],
  }),
}));

/**
 * AI cost ledger: one row per successful vision scan, anon or user.
 * Quota counts rows inside the WIB day; cost reports read latencyMs.
 */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    scanType: text("scan_type", { enum: ["anon", "user"] }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    usageJson: text("usage_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("ai_usage_user_created_idx").on(table.userId, table.createdAt)],
);

// Miss log: what the AI estimated vs what the user actually kept. Feeds the
// weekly TKPI calibration loop (JRG-32).
export const scanCorrection = sqliteTable(
  "scan_correction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["web", "native"] }).notNull(),
    meal: text("meal").notNull(),
    dishName: text("dish_name").notNull(),
    aiKcal: real("ai_kcal").notNull(),
    savedKcal: real("saved_kcal").notNull(),
    aiGrams: real("ai_grams"),
    aiConfidence: real("ai_confidence"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("scan_correction_created_idx").on(table.createdAt)],
);

/** Daily water glasses; WIB calendar day, one row per user-day. */
export const waterLog = sqliteTable(
  "water_log",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    glasses: integer("glasses").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

/**
 * Health Connect daily rollup (US-013): cumulative metrics aggregated by
 * Health Connect itself, so multiple writing apps (phone + watch) cannot
 * double count. Workouts stay in exercise_log; these numbers are displayed
 * as-is and never added on top of workout kcal in Burn.
 */
export const dailyActivity = sqliteTable(
  "daily_activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    steps: integer("steps").notNull().default(0),
    distanceMeters: real("distance_meters").notNull().default(0),
    activeCalories: real("active_calories").notNull().default(0),
    exerciseMinutes: real("exercise_minutes").notNull().default(0),
    // 'health_connect' (HealthKit comes later, see US-013 priority order)
    source: text("source").notNull().default("health_connect"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("daily_activity_user_date_uidx").on(table.userId, table.date)],
);

export const dailyActivityRelations = relations(dailyActivity, ({ one }) => ({
  user: one(user, {
    fields: [dailyActivity.userId],
    references: [user.id],
  }),
}));

/** Anonymous landing-page scan budget (lifetime count per device cookie). */
export const anonScan = sqliteTable("anon_scan", {
  cookieId: text("cookie_id").primaryKey(),
  count: integer("count").notNull().default(0),
});
