import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Server-side cache of Open Food Facts lookups, shared by every user. One row
// per normalized barcode (see lib/barcode.ts normalizeBarcode). Misses are
// cached too ("not_found", short TTL) so a bad scan never re-hits OFF; network
// errors are never stored. All nutrient columns are per 100 g (or 100 ml for
// drinks) exactly as OFF reports them; null = OFF has no value, not zero.

/** One cached OFF product, or a cached miss. */
export const barcodeProduct = sqliteTable("barcode_product", {
  code: text("code").primaryKey(),
  // 'found' | 'not_found'
  status: text("status").notNull(),
  name: text("name"),
  brand: text("brand"),
  // Pack size as printed ("85 g", "350 ml").
  quantity: text("quantity"),
  // Serving size in g/ml when OFF knows it; unit is 'g' | 'ml'.
  servingSize: real("serving_size"),
  unit: text("unit"),
  kcal100: real("kcal_100"),
  protein100: real("protein_100"),
  carbs100: real("carbs_100"),
  fat100: real("fat_100"),
  fiber100: real("fiber_100"),
  imageUrl: text("image_url"),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});
