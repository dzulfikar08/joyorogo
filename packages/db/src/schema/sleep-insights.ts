import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Sleep insights (docs/sleep-insights-design.md). JoyoFit pushes one row per night after the person opts in
// (sleep_insight_pref.enabled is the only switch); JoyoRogo lines the night up with its food log and watch_workout
// backup and computes the findings on read. Turning the switch off deletes every row below (except the pref itself).
// Retention is 90 nights, trimmed on every write.

/** One main night per wake date (the longest session; the rest are naps). A full snapshot: a push replaces the row. */
export const sleepNight = sqliteTable(
  "sleep_night",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The phone's local day the night ended ('YYYY-MM-DD'): the key fitness_score uses, so the two join by date.
    wakeDate: text("wake_date").notNull(),
    onsetMs: integer("onset_ms").notNull(),
    wakeMs: integer("wake_ms").notNull(),
    // The phone's UTC offset in minutes (WIB = 420) when the night happened.
    tzOffsetMin: integer("tz_offset_min").notNull(),
    asleepS: integer("asleep_s").notNull(),
    awakeS: integer("awake_s").notNull(),
    awakenings: integer("awakenings").notNull().default(0),
    // False (and the stage columns null) for a watch without sleep stages.
    hasStages: integer("has_stages", { mode: "boolean" }).notNull().default(false),
    deepS: integer("deep_s"),
    remS: integer("rem_s"),
    lightS: integer("light_s"),
    watchScore: integer("watch_score"),
    hrvMs: real("hrv_ms"),
    rhrBpm: integer("rhr_bpm"),
    // [[startMs, endMs], ...], at most 4.
    napsJson: text("naps_json", { mode: "json" }).$type<[number, number][]>().notNull().default([]),
    engineRev: integer("engine_rev").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
    // Bedroom sensor aggregates over the sleep window (JoyoFit reads a Xiaomi LYWSD03MMC thermometer; null without one).
    tempCMean: real("temp_c_mean"),
    tempCMin: real("temp_c_min"),
    tempCMax: real("temp_c_max"),
    rhPctMean: real("rh_pct_mean"),
    rhPctMin: real("rh_pct_min"),
    rhPctMax: real("rh_pct_max"),
    // Number of sensor readings behind the aggregates, and which sensor family produced them ('lywsd03mmc').
    envSamples: integer("env_samples"),
    envSource: text("env_source"),
    // Reserved for the air purifier integration (later): PM2.5 mean in ug/m3.
    pm25Mean: real("pm25_mean"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.wakeDate] })],
);

/** One row per account that ever touched the switch. `enabled` is the single source of truth for both apps. */
export const sleepInsightPref = sqliteTable("sleep_insight_pref", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  // The consent text version the person agreed to; a changed field list needs a new yes.
  consentVersion: integer("consent_version").notNull().default(0),
  consentedAt: integer("consented_at"),
  // Bit i = weekday i is a free day (0 = Sunday ... 6 = Saturday). Default Saturday + Sunday = 65.
  freeDaysMask: integer("free_days_mask").notNull().default(65),
  dismissedJson: text("dismissed_json", { mode: "json" }).$type<string[]>().notNull().default([]),
});

/** Per-factor result of the statistics, so a card does not flicker between reads and the gate has hysteresis. */
export const sleepInsightCache = sqliteTable(
  "sleep_insight_cache",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    factor: text("factor").notNull(),
    // Hash of the exposure/outcome vectors and context the result was computed from.
    signature: text("signature").notNull(),
    resultJson: text("result_json").notNull(),
    computedAt: integer("computed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.factor] }), index("sleep_insight_cache_user_idx").on(table.userId)],
);
