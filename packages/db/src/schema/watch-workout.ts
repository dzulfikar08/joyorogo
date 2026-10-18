import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Cloud copy of the workouts JoyoFit records from a watch (Pro). One row per workout, keyed by the
// workout's start (unix seconds), the same key JoyoFit's local database is unique on, so an upload of a
// workout that is already here replaces it instead of adding a second one.
//
// This table only holds what lists and totals need. The workout itself (the local row, every point's
// GPS/HR/altitude/speed/cadence/stride/power, and the analysis) is one gzip document in R2 under
// watch/<user id>/<start>.json.gz (contract: packages/api/src/lib/watch-workout.ts). Every number below
// is read from that document when it is stored, so a list row can never disagree with the analysis.
//
// A delete keeps the row with `deleted_at` set (blob gone): the phones pull it as a delete and an upload
// of the same start is refused, so a watch that sends the workout again does not bring it back.

export const watchWorkout = sqliteTable(
  "watch_workout",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Unix seconds the workout started.
    start: integer("start").notNull(),
    // The watch's own workout id (0 for an imported file).
    workoutNumber: integer("workout_number").notNull(),
    sportName: text("sport_name").notNull(),
    // 'run' | 'walk' | 'ride' | 'swim' | 'other' (WorkoutAnalysis.sport.kind); 'other' without an analysis.
    sportKind: text("sport_kind").notNull(),
    elapsedSec: integer("elapsed_sec").notNull(),
    movingSec: integer("moving_sec").notNull(),
    distanceM: real("distance_m"),
    elevGainM: real("elev_gain_m"),
    elevLossM: real("elev_loss_m"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    calories: integer("calories").notNull().default(0),
    steps: integer("steps").notNull().default(0),
    pointCount: integer("point_count").notNull().default(0),
    hasGps: integer("has_gps", { mode: "boolean" }).notNull().default(false),
    hasAnalysis: integer("has_analysis", { mode: "boolean" }).notNull().default(false),
    // Came from a Huawei export or a FIT file instead of the watch.
    imported: integer("imported", { mode: "boolean" }).notNull().default(false),
    // The watch had not finished sending it; the phone uploads again when it completes.
    complete: integer("complete", { mode: "boolean" }).notNull().default(true),
    // Analysis engine revision the uploading app computed this with; the app uploads again when its own is newer.
    engineRev: integer("engine_rev").notNull().default(0),
    blobBytes: integer("blob_bytes").notNull().default(0),
    // sha-256 (hex) of the stored gzip bytes: an identical upload is acknowledged without rewriting anything.
    contentHash: text("content_hash").notNull(),
    // 1 on the first upload, +1 each time different content replaces it.
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    // Epoch ms of the last change, a delete included; what the phones pull "since".
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.start] }),
    index("watch_workout_user_updated_idx").on(table.userId, table.updatedAt, table.start),
  ],
);

export type WatchWorkoutRow = typeof watchWorkout.$inferSelect;
