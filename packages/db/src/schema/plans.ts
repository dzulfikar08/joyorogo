import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { exerciseLog } from "./fitness";

// Tables for strength training (workout_*), food prices (plate), and web push
// reminders (push_subscription). Dates are WIB calendar days 'YYYY-MM-DD'.
//
// workout_*: strength logging moved to JoyoFit. These tables are a read-only archive of what was logged in
// JoyoRogo; nothing is deleted, and new writes are rejected after the grace period (api lib/strength-lock.ts).

/** One legacy strength-training session (archive); its kcal is mirrored into exercise_log for Burn. */
export const workoutSession = sqliteTable(
  "workout_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    name: text("name").notNull(),
    // when the stopwatch started; null for sessions logged by older clients
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
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
    // catalog id, or the id of a workout_custom_exercise row
    exerciseId: text("exercise_id").notNull(),
    // order within the session
    position: integer("position").notNull(),
    // null for timed sets (plank, dead hang); older clients always sent reps
    reps: integer("reps"),
    // null for bodyweight sets
    weightKg: real("weight_kg"),
    // timed sets only
    durationSec: integer("duration_sec"),
    rpe: real("rpe"),
    // warmup sets never count toward personal records
    setType: text("set_type").default("normal").notNull(),
    // per-exercise note, repeated on every set row of that exercise
    note: text("note"),
    // letter-tag grouping for supersets, null when not in one
    supersetGroup: integer("superset_group"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("workout_set_session_idx").on(table.sessionId),
    index("workout_set_user_exercise_idx").on(table.userId, table.exerciseId),
  ],
);

/** User-invented movement, merged into the catalog for its owner only. */
export const workoutCustomExercise = sqliteTable(
  "workout_custom_exercise",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // ids of the fixed muscle/equipment lists in lib/exercises
    muscle: text("muscle").notNull(),
    equipment: text("equipment").notNull(),
    type: text("type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("workout_custom_exercise_user_idx").on(table.userId)],
);

/** Saved routine: reusable exercise plan, stored as one JSON document. */
export const workoutRoutine = sqliteTable(
  "workout_routine",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    note: text("note"),
    exercises: text("exercises", { mode: "json" })
      .$type<WorkoutRoutineExercise[]>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("workout_routine_user_idx").on(table.userId, table.updatedAt)],
);

export type WorkoutRoutineSet = {
  setType: "normal" | "warmup" | "drop" | "failure";
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
};

export type WorkoutRoutineExercise = {
  exerciseId: string;
  restSec: number | null;
  note: string | null;
  sets: WorkoutRoutineSet[];
};

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
    // Where the plate was eaten, opt-in only. Rounded to ~100 m (3 decimals)
    // before it is stored; private to the owner and never served publicly.
    lat: real("lat"),
    lng: real("lng"),
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
