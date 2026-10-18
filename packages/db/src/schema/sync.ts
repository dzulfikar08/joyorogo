import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Multi-device sync for what is not a table of its own: preferences and small user-made documents of JoyoRogo
// (`ns` 'rogo') and JoyoFit (`ns` 'fit'). One JSON document per (ns, kind, id); the registry of kinds, their size
// caps and the Pro rule is packages/api/src/lib/sync-record.ts, the contract docs/multi-device.md.
// - `updated_at` is the record's own time on the phone shifted by the push's clock skew and capped at the server
//   clock, so a wrong phone clock cannot win for good; newer wins, the later push when equal.
// - `rank` is coverage for the kinds that can be partial (a day bundle of metrics): a higher rank wins before time
//   does. Tombstones ignore rank (a delete is ordered by time like any edit).
// - A delete is a tombstone (`deleted_at` set, the document kept) so every phone learns about it.
// - `server_at` is when the server stored the row and strictly increases within one push, so a pull by
//   (server_at, kind, id) never skips a row.
export const syncRecord = sqliteTable(
  "sync_record",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ns: text("ns").notNull(),
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    json: text("json").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    rank: integer("rank").notNull().default(0),
    serverAt: integer("server_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.ns, table.kind, table.id] }),
    index("sync_record_pull_idx").on(table.userId, table.ns, table.serverAt, table.kind, table.id),
  ],
);

export type SyncRecordRow = typeof syncRecord.$inferSelect;
