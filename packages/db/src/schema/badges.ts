import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Badges and the weekly consistency leaderboard (docs/badges.md). Nothing here is derived from body weight: a badge or a
// rank comes from logged days, verified workouts, water, scans and challenges only.

/** One earned badge tier. Tiered badges (konsisten 7/30/100) hold one row per tier reached; a row is never removed by a later lapse. */
export const badgeAward = sqliteTable(
  "badge_award",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    badgeId: text("badge_id").notNull(),
    tier: integer("tier").notNull().default(1),
    awardedAt: integer("awarded_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.badgeId, table.tier] }),
    index("badge_award_user_idx").on(table.userId, table.awardedAt),
  ],
);

/** Leaderboard consent and display name. No row = not joined. Opt-in is off by default and the alias is unique among everyone who set one. */
export const leaderboardPref = sqliteTable(
  "leaderboard_pref",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    optIn: integer("opt_in", { mode: "boolean" }).notNull().default(false),
    // 'username' shows the public handle; 'anonim' shows the alias, or "Anonim #n" without one.
    displayMode: text("display_mode", { enum: ["username", "anonim"] }).notNull().default("anonim"),
    alias: text("alias"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("leaderboard_pref_alias_uidx").on(table.alias).where(sql`${table.alias} is not null`),
    index("leaderboard_pref_opt_idx").on(table.optIn),
  ],
);

/** The weekly snapshot (Monday to Sunday, WIB): rows of opted-in users, rewritten while the week runs and frozen once it closes. */
export const leaderboardWeek = sqliteTable(
  "leaderboard_week",
  {
    weekStart: text("week_start").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    daysLogged: integer("days_logged").notNull(),
    proteinHitDays: integer("protein_hit_days").notNull(),
    workoutDays: integer("workout_days").notNull(),
    streakEnd: integer("streak_end").notNull(),
    // Bit 0 = Monday ... bit 6 = Sunday: the logged days of the week, for the 7-cell row.
    daysMask: integer("days_mask").notNull().default(0),
    rankGlobal: integer("rank_global"),
    computedAt: integer("computed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.weekStart, table.userId] }),
    index("leaderboard_week_rank_idx").on(table.weekStart, table.rankGlobal),
    index("leaderboard_week_user_idx").on(table.userId),
  ],
);
