import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Daily Recovery / Strain / Sleep scores pushed by the JoyoFit app (Huawei
// watch). JoyoFit computes them on the phone from the watch's own data; this
// table only stores what it sends so the diary can show them next to food.
// date is the WIB calendar day ('YYYY-MM-DD'), the same key food_log uses.
// Every score is nullable: JoyoFit sends what it could compute for that day
// (a past day usually has strain only), and a null never erases a stored value.

/** One day of JoyoFit scores for one user. */
export const fitnessScore = sqliteTable(
  "fitness_score",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    // HRV against the user's own baseline, 1..99.
    recoveryPct: integer("recovery_pct"),
    // Heart-rate load on JoyoFit's 0..21 scale.
    strain: real("strain"),
    // Last night's sleep as a share of the sleep JoyoFit estimates the user needs; can pass 100.
    sleepPct: integer("sleep_pct"),
    // 'Primed' | 'Balanced' | 'Strained' | 'Run down' — JoyoFit's readiness word.
    readiness: text("readiness"),
    source: text("source").notNull().default("joyofit"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("fitness_score_user_date_uidx").on(table.userId, table.date)],
);
