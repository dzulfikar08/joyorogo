import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
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
    // Status VAR perut dibagikan ke tim ini? Default sembunyi. Yang ikut
    // dibagikan cuma verdict + tanggal — foto perut tidak pernah keluar.
    shareVar: integer("share_var", { mode: "boolean" }).notNull().default(false),
    // Opt-in per grup: skor harian JoyoFit (recovery, strain, tidur, readiness).
    shareFitness: integer("share_fitness", { mode: "boolean" }).notNull().default(false),
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

// --- Feed komunitas (Strava-style) ------------------------------------------
// Postingan opt-in: pengguna membagikan satu log (makan/latihan/berat) dengan
// snapshot data saat dibagikan, jadi edit/hapus log sumber tidak merusak feed.

export const post = sqliteTable(
  "post",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 'makan' | 'latihan' | 'berat' | 'cerita' — jenis log/pos yang dibagikan
    kind: text("kind", { enum: ["makan", "latihan", "berat", "cerita"] }).notNull(),
    // Log sumber (informasional; yang dirender adalah snapshot di bawah).
    // Tanpa FK cascade: menghapus log sumber tidak boleh menghapus postingan.
    foodLogId: text("food_log_id"),
    exerciseLogId: text("exercise_log_id"),
    workoutSessionId: text("workout_session_id"),
    weightLogId: text("weight_log_id"),
    // Snapshot saat dibagikan
    title: text("title").notNull(),
    kcal: real("kcal"),
    durationMin: real("duration_min"),
    // foto asli milik penulis (photos/<userId>/<id>.jpg) — hanya bisa diakses
    // lewat /post-photo/:postId yang mengecek visibility postingan
    photoId: text("photo_id"),
    // stiker hasil scan (public capability URL)
    scanId: text("scan_id"),
    // JSON { protein, carbs, fat, fiber } untuk makanan
    macroJson: text("macro_json"),
    // JSON array id foto pos bebas 'cerita' (maks 4), objek R2 di
    // posts/<userId>/<id>.<ext> — hanya bisa diakses lewat /post-photo/:postId/:index
    photosJson: text("photos_json"),
    // JSON latihan: { sets, reps, volumeKg } · berat: { weightKg, deltaKg }
    statsJson: text("stats_json"),
    caption: text("caption"),
    // 'publik' (Jelajah + profil publik) | 'grup' (rekan satu tim saja)
    visibility: text("visibility", { enum: ["publik", "grup"] }).notNull().default("grup"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("post_user_created_idx").on(table.userId, table.createdAt),
    index("post_visibility_created_idx").on(table.visibility, table.createdAt),
  ],
);

// Detail pos latihan dari jam (HR series + rute); ikut terhapus bersama pos.
export const postWorkoutDetail = sqliteTable("post_workout_detail", {
  postId: text("post_id")
    .primaryKey()
    .references(() => post.id, { onDelete: "cascade" }),
  // JSON { intervalSec, bpm: (number|null)[] }
  hrJson: text("hr_json"),
  // JSON [lat, lon][]
  routeJson: text("route_json"),
  // JSON WorkoutAnalysis v1 (JoyoFit's full analysis; contract in packages/api/src/lib/workout-analysis.ts)
  analysisJson: text("analysis_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

export const postKudos = sqliteTable(
  "post_kudos",
  {
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId] }),
    index("post_kudos_user_idx").on(table.userId),
  ],
);

export const postComment = sqliteTable(
  "post_comment",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("post_comment_post_created_idx").on(table.postId, table.createdAt)],
);

// Follow satu arah, tanpa persetujuan.
export const socialFollow = sqliteTable(
  "social_follow",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followingId: text("following_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index("social_follow_following_idx").on(table.followingId),
  ],
);

// Blokir: menyembunyikan postingan/komentar dua arah dan menghapus follow.
export const socialBlock = sqliteTable(
  "social_block",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] })],
);

// Notifikasi feed (kudos/komentar/pengikut) — list terpisah dari kotak masuk
// grup; dirender di halaman Feed.
export const socialNotification = sqliteTable(
  "social_notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 'kudos' | 'comment' | 'follow'
    kind: text("kind", { enum: ["kudos", "comment", "follow"] }).notNull(),
    postId: text("post_id").references(() => post.id, { onDelete: "cascade" }),
    // cuplikan komentar (untuk kind 'comment')
    excerpt: text("excerpt"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("social_notification_user_created_idx").on(table.userId, table.createdAt),
    index("social_notification_user_read_idx").on(table.userId, table.readAt),
  ],
);

// Laporan konten untuk konsol admin; menghapus konten meng-cascade laporannya.
export const socialReport = sqliteTable(
  "social_report",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id").references(() => post.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => postComment.id, { onDelete: "cascade" }),
    // 'spam' | 'kasar' | 'salah_info' | 'lainnya'
    reason: text("reason", { enum: ["spam", "kasar", "salah_info", "lainnya"] }).notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("social_report_resolved_idx").on(table.resolvedAt, table.createdAt),
    // Admin reports list with the "all"/"resolved" status filter.
    index("social_report_created_idx").on(table.createdAt, table.id),
  ],
);

export const postRelations = relations(post, ({ one, many }) => ({
  author: one(user, { fields: [post.userId], references: [user.id] }),
  kudos: many(postKudos),
  comments: many(postComment),
}));

export const postKudosRelations = relations(postKudos, ({ one }) => ({
  post: one(post, { fields: [postKudos.postId], references: [post.id] }),
  user: one(user, { fields: [postKudos.userId], references: [user.id] }),
}));

export const postCommentRelations = relations(postComment, ({ one }) => ({
  post: one(post, { fields: [postComment.postId], references: [post.id] }),
  user: one(user, { fields: [postComment.userId], references: [user.id] }),
}));
