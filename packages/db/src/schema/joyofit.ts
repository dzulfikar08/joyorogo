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
    // Daily body metrics JoyoFit computes on the phone (Kebugaran): shown to the owner's AI assistants through
    // the MCP connector (docs/mcp-connector.md). Every one is nullable and a null never erases a stored value.
    // Hours of sleep of the night that ended on this day.
    sleepHours: real("sleep_hours"),
    // Resting heart rate of the day, bpm.
    restingHr: integer("resting_hr"),
    // Average overnight HRV (RMSSD), milliseconds.
    hrvMs: real("hrv_ms"),
    // 'balanced' | 'unbalanced' | 'low': last 7 nights against the 60-day baseline.
    hrvStatus: text("hrv_status"),
    // Estimated VO2max, ml/kg/min.
    vo2max: real("vo2max"),
    // 'productive' | 'maintaining' | 'recovery' | 'overreaching' | 'detraining'.
    trainingStatus: text("training_status"),
    // Acute (7 day) to chronic (28 day) training load ratio.
    loadRatio: real("load_ratio"),
    // Hours of recovery time still left after the last hard workout.
    recoveryHours: integer("recovery_hours"),
    // The watch's own active-energy total of the day (kcal, everything above resting: walking, chores, workouts), from
    // the minute step frames. It feeds the diary's calorie budget (api lib/exercise-credit.ts, docs/energy-model.md).
    activeKcal: real("active_kcal"),
    source: text("source").notNull().default("joyofit"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("fitness_score_user_date_uidx").on(table.userId, table.date)],
);
