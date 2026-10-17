import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Server-side product database behind barcode scanning, shared by every user.
// One row per normalized barcode (see lib/barcode.ts normalizeBarcode). Rows
// come from three places: an external source (Open Food Facts, ...; refreshed
// after a TTL), a user's label photo (source 'label_photo': values read from
// the nutrition panel, confirmed by the user, never expired), or a cached miss
// ("not_found", short TTL, `sources_checked` lists who said no). Network errors
// are never stored. All nutrient columns are per 100 g (or 100 ml for drinks);
// null = no value known, not zero. Photos are never stored, only the values.

/** One product, or a cached miss. */
export const barcodeProduct = sqliteTable("barcode_product", {
  code: text("code").primaryKey(),
  // 'found' | 'not_found'
  status: text("status").notNull(),
  // Where the values come from: a lookup source id ('off', ...) or 'label_photo'.
  source: text("source").notNull().default("off"),
  // label_photo rows: how many different users' submissions agree with these
  // values (see lib/barcode-trust.ts). 0 for external sources.
  contributors: integer("contributors").notNull().default(0),
  // Misses: comma-separated ids of the sources that answered "not found" at
  // fetched_at. A source added later is asked on its own; this list is why.
  sourcesChecked: text("sources_checked"),
  name: text("name"),
  brand: text("brand"),
  // Pack size as printed ("85 g", "350 ml").
  quantity: text("quantity"),
  // Serving size in g/ml when known; unit is 'g' | 'ml'.
  servingSize: real("serving_size"),
  unit: text("unit"),
  kcal100: real("kcal_100"),
  protein100: real("protein_100"),
  carbs100: real("carbs_100"),
  fat100: real("fat_100"),
  fiber100: real("fiber_100"),
  sugar100: real("sugar_100"),
  imageUrl: text("image_url"),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/**
 * One user's reading of one product's nutrition label, already converted to
 * per 100 g/ml. The newest submission per (code, user) is kept; the consensus
 * of all of a code's rows becomes its `barcode_product` row. The user link is
 * cut (not cascaded) when an account is deleted: the values are not personal
 * data, but the submission stops counting as a person.
 */
export const barcodeContribution = sqliteTable(
  "barcode_contribution",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    brand: text("brand"),
    quantity: text("quantity"),
    servingSize: real("serving_size"),
    unit: text("unit").notNull(),
    kcal100: real("kcal_100").notNull(),
    protein100: real("protein_100"),
    carbs100: real("carbs_100"),
    fat100: real("fat_100"),
    fiber100: real("fiber_100"),
    sugar100: real("sugar_100"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("barcode_contribution_code_user_uidx").on(table.code, table.userId),
    index("barcode_contribution_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);
