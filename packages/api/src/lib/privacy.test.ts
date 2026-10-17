import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// @libsql/client is a transitive dep of @joyorogo/db (its D1-shaped driver
// supports batch); resolved directly because packages/api doesn't declare it.
import { createClient } from "../../../db/node_modules/@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "@joyorogo/db";

import { deleteAllUserData } from "./privacy";

const U1 = "user-1";
const U2 = "user-2";

const client = createClient({ url: ":memory:" });

// Real migrations, applied in filename order — keeps the test honest about schema.
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const db = drizzle(client) as unknown as Database;

// Fitness rows every user gets; the auth account row must survive deletion.
async function seedUserData(userId: string, tag: string) {
  await client.executeMultiple(
    `INSERT INTO "user" (id, name, email) VALUES ('${userId}', '${tag}', '${tag}@test.id');
     INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
       VALUES ('${userId}', 1995, 'male', 170, 80, 70, '2026-12-01', 'mid');
     INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES
       ('w1-${userId}', '${userId}', '2026-09-01', 79.5),
       ('w2-${userId}', '${userId}', '2026-09-02', 79.2);
     INSERT INTO waist_log (id, user_id, date, waist_cm)
       VALUES ('wc1-${userId}', '${userId}', '2026-09-01', 92);
     INSERT INTO food_log (id, user_id, date, meal, name, kcal)
       VALUES ('f1-${userId}', '${userId}', '2026-09-01', 'sarapan', 'nasi goreng', 500);
     INSERT INTO exercise_log (id, user_id, date, name, kcal)
       VALUES ('e1-${userId}', '${userId}', '2026-09-01', 'lari', 300);
     INSERT INTO sleep_log (id, user_id, date, hours)
       VALUES ('s1-${userId}', '${userId}', '2026-09-01', 7.5);
     INSERT INTO strava_account (user_id, athlete_id, access_token, refresh_token, expires_at)
       VALUES ('${userId}', 'a-${userId}', 'at', 'rt', 1760000000);
     INSERT INTO water_log (user_id, date, glasses) VALUES ('${userId}', '2026-09-01', 3);
     INSERT INTO daily_activity (id, user_id, date, steps)
       VALUES ('da1-${userId}', '${userId}', '2026-09-01', 4200);
     INSERT INTO plate (id, user_id, date, meal, name, place, lat, lng)
       VALUES ('p1-${userId}', '${userId}', '2026-09-01', 'sarapan', 'nasi goreng', 'warung', -7.984, 112.63);
     INSERT INTO scan_correction (id, user_id, source, meal, dish_name, ai_kcal, saved_kcal)
       VALUES ('sc1-${userId}', '${userId}', 'web', 'sarapan', 'nasi goreng', 500, 480);
     INSERT INTO scan_feedback (id, user_id, photo_id, rating, reasons_json, note, source)
       VALUES ('sf1-${userId}', '${userId}', 'photo', 'kurang_akurat', '["keep_photo"]', 'siomay', 'web');
     INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms)
       VALUES ('ai1-${userId}', '${userId}', 'test-model', 'user', 900);`,
  );
}

const FITNESS_TABLES = [
  "plate",
  "profile",
  "weight_log",
  "waist_log",
  "food_log",
  "exercise_log",
  "sleep_log",
  "strava_account",
  "water_log",
  "daily_activity",
  "ai_usage",
  "scan_correction",
  "scan_feedback",
];

async function count(table: string, userId?: string): Promise<number> {
  const result = await client.execute({
    sql: userId
      ? `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`
      : `SELECT COUNT(*) AS n FROM ${table}`,
    args: userId ? [userId] : [],
  });
  return Number(result.rows[0]?.n ?? 0);
}

describe("deleteAllUserData", () => {
  test("removes every fitness row of one user, keeps the account and other users", async () => {
    await seedUserData(U1, "Satu");
    await seedUserData(U2, "Dua");

    await deleteAllUserData(db, U1);

    for (const table of FITNESS_TABLES) {
      expect(await count(table, U1)).toBe(0);
    }
    expect(await count("weight_log", U2)).toBe(2);
    expect(await count("profile", U2)).toBe(1);
    expect(await count('"user"')).toBe(2);
  });

  test("is idempotent — deleting twice resolves without error", async () => {
    await deleteAllUserData(db, U1);
    for (const table of FITNESS_TABLES) {
      expect(await count(table, U1)).toBe(0);
    }
    expect(await count('"user"')).toBe(2);
  });

  test("removes feed posts, interactions, follows and blocks of the user only", async () => {
    await client.executeMultiple(
      `INSERT INTO "user" (id, name, email) VALUES ('feed-a', 'A', 'a@feed.id'), ('feed-b', 'B', 'b@feed.id');
       INSERT INTO post (id, user_id, kind, title) VALUES ('post-a', 'feed-a', 'makan', 'nasi'), ('post-b', 'feed-b', 'makan', 'soto');
       INSERT INTO post_comment (id, post_id, user_id, body) VALUES
         ('c-b-on-a', 'post-a', 'feed-b', 'enak'), ('c-a-on-b', 'post-b', 'feed-a', 'mantap');
       INSERT INTO post_kudos (post_id, user_id) VALUES ('post-a', 'feed-b'), ('post-b', 'feed-a');
       INSERT INTO social_follow (follower_id, following_id) VALUES ('feed-a', 'feed-b'), ('feed-b', 'feed-a');
       INSERT INTO social_block (blocker_id, blocked_id) VALUES ('feed-a', 'feed-b');`,
    );

    await deleteAllUserData(db, "feed-a");

    const n = async (table: string) =>
      Number((await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]?.n ?? 0);
    expect(await n("post")).toBe(1);
    expect(await n("post_comment")).toBe(0);
    expect(await n("post_kudos")).toBe(0);
    expect(await n("social_follow")).toBe(0);
    expect(await n("social_block")).toBe(0);
    expect((await client.execute("SELECT id FROM post")).rows[0]?.id).toBe("post-b");
  });
});
