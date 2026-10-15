import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Favorit: a food row or a whole plate saved for one-tap re-logging. The
// components are a frozen copy (items_json) so the favorite survives the
// diary rows it came from being edited or deleted. Dates are not stored: a
// favorite is re-logged to whatever day and slot the user is viewing.

/** One saved favorite (single food or plate), unique per user by content key. */
export const savedFood = sqliteTable(
  "saved_food",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    place: text("place"),
    priceIdr: integer("price_idr"),
    // Sum of the components' kcal, for list display and ordering.
    kcal: real("kcal").notNull(),
    // JSON array of components: { name, grams, kcal, protein, carbs, fat,
    // fiber, scanId, photoId } (scanId/photoId keep the sticker/photo reference).
    itemsJson: text("items_json").notNull(),
    // Content fingerprint (see lib/saved-foods.ts); makes starring idempotent
    // and lets clients show a filled star on any row with the same content.
    key: text("key").notNull(),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("saved_food_user_key_uidx").on(table.userId, table.key),
    index("saved_food_user_idx").on(table.userId),
  ],
);
