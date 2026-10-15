import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { team } from "./social";

// Tantangan grup: rentang hari tetap di dalam satu tim dengan satu jenis
// target harian. Progres TIDAK disimpan; dihitung dari data yang sudah ada
// (daily_activity, food_log, exercise_log, fitness_score) setiap dibaca, jadi
// mengedit atau menghapus log sumber langsung terlihat di papan peringkat.
// Semua tanggal adalah hari kalender WIB ('YYYY-MM-DD').

export const CHALLENGE_GOALS = [
  "steps",
  "protein",
  "calories",
  "workouts",
  "strain",
  "sleep",
] as const;
export type ChallengeGoal = (typeof CHALLENGE_GOALS)[number];

export const teamChallenge = sqliteTable(
  "team_challenge",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    // Pembuat (Founder). Null kalau akunnya dihapus; tantangan tetap jalan.
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    goal: text("goal", { enum: CHALLENGE_GOALS }).notNull(),
    // Ambang harian yang sama untuk semua anggota (langkah, strain, tidur %,
    // jumlah sesi latihan). Null untuk protein/kalori: targetnya pribadi dan
    // disimpan per anggota saat bergabung.
    target: real("target"),
    durationDays: integer("duration_days").notNull(),
    startDate: text("start_date").notNull(),
    // Hari terakhir yang ikut dihitung (inklusif).
    endDate: text("end_date").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("team_challenge_team_end_idx").on(table.teamId, table.endDate)],
);

export const teamChallengeMember = sqliteTable(
  "team_challenge_member",
  {
    challengeId: text("challenge_id")
      .notNull()
      .references(() => teamChallenge.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Hari pertama yang dihitung untuk anggota ini: max(startDate, hari gabung).
    fromDate: text("from_date").notNull(),
    // Target pribadi yang dibekukan saat bergabung (protein g / kalori kkal)
    // supaya papan tidak bergeser kalau profil berubah. Null untuk target tetap.
    target: real("target"),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.challengeId, table.userId] }),
    index("team_challenge_member_user_idx").on(table.userId),
  ],
);
