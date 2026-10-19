import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// The AI text of "Refleksi minggu ini" (Pro): one row per account, WIB week and language, so the model is called once
// per week and a reopened recap reads this row. The facts themselves are never stored: they are recomputed from the
// week's data on every view (packages/api/src/lib/recap-reflection.ts, docs/weekly-recap-ai.md).
//
// `signature` fingerprints the selected facts the text was written from; the text is only rewritten when a later view
// selects different facts (a material change), at most `generations` times a week. A failed run keeps `ai_text` null and
// `status` 'failed' so a view does not call the model again until the retry gap has passed.
export const weekReflection = sqliteTable(
  "week_reflection",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Monday (WIB) of the week, 'YYYY-MM-DD'.
    weekStart: text("week_start").notNull(),
    locale: text("locale").notNull(),
    aiText: text("ai_text"),
    aiModel: text("ai_model"),
    // 'ok' | 'failed'
    status: text("status").notNull(),
    signature: text("signature").notNull(),
    // Model runs that started for this row (failures included); caps regeneration inside one week.
    generations: integer("generations").notNull().default(1),
    // Epoch ms of the last run.
    generatedAt: integer("generated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.weekStart, table.locale] })],
);

export type WeekReflectionRow = typeof weekReflection.$inferSelect;
