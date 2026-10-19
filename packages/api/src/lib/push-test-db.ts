import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Client } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

export type TestClient = Client;

/** Fresh in-memory database with every migration applied, for the push tests. */
export async function pushTestDb() {
  const client = createClient({ url: ":memory:" });
  const dir = join(import.meta.dir, "../../../db/src/migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await client.executeMultiple(readFileSync(join(dir, file), "utf8"));
  }
  return { client, db: drizzle(client) as unknown as Database };
}

/** `YYYY-MM-DD` and `HH:MM` of WIB (UTC+7) as the instant they name. */
export function wib(date: string, time = "12:00"): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

/** A user with a profile row. */
export async function seedUser(
  client: TestClient,
  id: string,
  profile: { createdAtMs?: number; maternal?: string; pattern?: string; windowStart?: string; ramadan?: string; locale?: string } = {},
) {
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, tier) VALUES (?, ?, ?, 'free')`,
    args: [id, `User ${id}`, `${id}@test.id`],
  });
  await client.execute({
    sql: `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date,
            activity_level, maternal_mode, fasting_pattern, fasting_window_start, ramadan_mode, locale, created_at)
          VALUES (?, 1990, 'male', 170, 80, 72, '2030-01-01', 'light', ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      profile.maternal ?? "none",
      profile.pattern ?? "off",
      profile.windowStart ?? "12:00",
      profile.ramadan ?? "off",
      profile.locale ?? null,
      profile.createdAtMs ?? Date.parse("2026-01-01T00:00:00Z"),
    ],
  });
}

export async function seedDevice(
  client: TestClient,
  userId: string,
  token: string,
  app: "joyorogo" | "joyofit" = "joyorogo",
) {
  await client.execute({
    sql: `INSERT INTO push_device (id, user_id, app, platform, expo_token) VALUES (?, ?, ?, 'android', ?)`,
    args: [`dev-${token}`, userId, app, `ExponentPushToken[${token}]`],
  });
}

export async function seedFood(client: TestClient, userId: string, date: string, meal = "sarapan") {
  await client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES (?, ?, ?, ?, 'Nasi', 300)`,
    args: [crypto.randomUUID(), userId, date, meal],
  });
}
