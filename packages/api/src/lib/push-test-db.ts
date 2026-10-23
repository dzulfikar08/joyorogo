import { d1TestDb } from "@joyorogo/db/test-d1";
import type { Database } from "@joyorogo/db";

/** The slice of the libsql client the push tests use. */
export interface TestClient {
  execute(statement: string | { sql: string; args?: (string | number | null)[] }): Promise<{ rows: Record<string, unknown>[] }>;
  executeMultiple(sql: string): Promise<void>;
}

/** Fresh in-memory database with every migration applied, for the push tests. */
export async function pushTestDb(): Promise<{ client: TestClient; db: Database }> {
  const { client, db } = await d1TestDb();
  return { client, db };
}

/** `YYYY-MM-DD` and `HH:MM` of WIB (UTC+7) as the instant they name. */
export function wib(date: string, time = "12:00"): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

/** `YYYY-MM-DD` and `HH:MM` on a Kuala Lumpur / Singapore clock (UTC+8) as the instant they name. */
export function myt(date: string, time = "12:00"): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

/** A user with a profile row; `timezone` is the stored day zone (null = a profile from before zones existed). */
export async function seedUser(
  client: TestClient,
  id: string,
  profile: {
    createdAtMs?: number;
    maternal?: string;
    pattern?: string;
    windowStart?: string;
    ramadan?: string;
    locale?: string;
    timezone?: string;
  } = {},
) {
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, tier) VALUES (?, ?, ?, 'free')`,
    args: [id, `User ${id}`, `${id}@test.id`],
  });
  await client.execute({
    sql: `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date,
            activity_level, maternal_mode, fasting_pattern, fasting_window_start, ramadan_mode, locale, created_at, timezone)
          VALUES (?, 1990, 'male', 170, 80, 72, '2030-01-01', 'light', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      profile.maternal ?? "none",
      profile.pattern ?? "off",
      profile.windowStart ?? "12:00",
      profile.ramadan ?? "off",
      profile.locale ?? null,
      profile.createdAtMs ?? Date.parse("2026-01-01T00:00:00Z"),
      profile.timezone ?? null,
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
