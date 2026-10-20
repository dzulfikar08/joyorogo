import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// "Piring saya": the plates and bowls a user eats from every day, registered once so each photo scan has
// a reference of known size (docs/dishware.md). The photo lives in the private R2 bucket at
// dishware/<userId>/<photoId>.jpg; this row is the metadata the scan prompt is built from.

/** The kinds a user picks from; the labels live in i18n (scan:dishware.kind.*), the prompt wording in lib/dishware.ts. */
export const DISHWARE_KINDS = ["flat", "bowl", "rattan", "lunchbox"] as const;

export const dishware = sqliteTable(
  "dishware",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: DISHWARE_KINDS }).notNull(),
    // Inner width across the plate or bowl in cm; for a lunchbox the long side.
    diameterCm: real("diameter_cm").notNull(),
    // Lunchbox only: the short side.
    widthCm: real("width_cm"),
    // "manual" = typed (ruler), "card" = estimated from a bank card laid beside it, then confirmed by the user.
    diameterSource: text("diameter_source", { enum: ["manual", "card"] }).notNull().default("manual"),
    // What the plate looks like, in a few words, written once by the model at registration: it is what the scan
    // prompt matches a photo against, so no image has to be sent per plate.
    description: text("description").notNull().default(""),
    photoId: text("photo_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("dishware_user_idx").on(table.userId)],
);
