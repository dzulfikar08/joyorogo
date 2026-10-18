import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// JoyoFit's coach document (Pro writes): the person's plan choices, what they ticked off and the sets they logged,
// one JSON document per account. `rev` is the optimistic concurrency counter: a write names the rev it started
// from and is stored only when that is still the current one (packages/api/src/lib/coach-doc.ts). The shape is
// validated there and mirrors watch-fit's src/features/coach/doc.ts.
export const coachDoc = sqliteTable("coach_doc", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  doc: text("doc").notNull(),
  rev: integer("rev").notNull(),
  // Epoch ms of the last write.
  updatedAt: integer("updated_at").notNull(),
});

export type CoachDocRow = typeof coachDoc.$inferSelect;
