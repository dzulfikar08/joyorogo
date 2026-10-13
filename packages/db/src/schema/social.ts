import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Tim (grup teman/keluarga): saling pantau kalori, colek, dan papan aktivitas.
// 'team' dipakai sebagai nama tabel SQL karena 'group' adalah keyword.

export const team = sqliteTable("team", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // 8-char unambiguous capability code (A-Z kecuali I/L/O, 2-9).
  inviteCode: text("invite_code").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
}, (table) => [uniqueIndex("team_invite_code_uidx").on(table.inviteCode)]);

export const teamMember = sqliteTable(
  "team_member",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 'owner' | 'member'
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
    // member boleh menyembunyikan nama/foto makanannya; total tetap terlihat.
    shareFood: integer("share_food", { mode: "boolean" }).notNull().default(true),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_member_userId_idx").on(table.userId),
  ],
);

export const teamNudge = sqliteTable(
  "team_nudge",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 'poke' | 'note'
    kind: text("kind", { enum: ["poke", "note"] }).notNull(),
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("team_nudge_to_read_idx").on(table.toUserId, table.readAt)],
);

export const teamRelations = relations(team, ({ many, one }) => ({
  members: many(teamMember),
  owner: one(user, { fields: [team.ownerId], references: [user.id] }),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, { fields: [teamMember.teamId], references: [team.id] }),
  user: one(user, { fields: [teamMember.userId], references: [user.id] }),
}));
