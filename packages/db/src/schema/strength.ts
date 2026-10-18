import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// JoyoFit's strength data (Pro writes, reads stay open): one JSON document per record, last write wins on the
// client's `updated_at`. `kind` is 'workout' | 'routine' | 'folder' | 'exercise' | 'pref'; `id` is the record id
// inside its kind. A delete is a tombstone (`deleted_at` set, the document kept) so every phone learns about it.
// `server_at` is when the server stored the row and strictly increases within one push, so a pull by
// (server_at, kind, id) never skips a row. Shapes are validated in packages/api/src/lib/strength-record.ts and
// mirror watch-fit's src/features/strength/types.ts.
export const strengthRecord = sqliteTable(
  "strength_record",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    json: text("json").notNull(),
    // Epoch ms of the record's own `updatedAt` on the phone.
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    // Epoch ms the server stored it.
    serverAt: integer("server_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.id] }),
    index("strength_record_pull_idx").on(table.userId, table.serverAt, table.kind, table.id),
  ],
);

export type StrengthRecordRow = typeof strengthRecord.$inferSelect;
