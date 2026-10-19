import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";

// Migration 0048 renames the three old activity levels: low -> sedentary, mid -> light, high -> moderate.

const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const TAG = "0048_activity_levels.sql";

describe("migration 0048_activity_levels", () => {
  test("is in the migrations folder", () => {
    expect(files).toContain(TAG);
  });

  test("renames low / mid / high and leaves every other value alone", async () => {
    const client = createClient({ url: ":memory:" });
    for (const file of files.filter((f) => f < TAG)) {
      await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    const levels = ["low", "mid", "high", "light", "sedentary", "very_active"];
    for (const [i, level] of levels.entries()) {
      await client.execute({ sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`, args: [`u${i}`, `u${i}`, `u${i}@test.id`] });
      await client.execute({
        sql: `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level) VALUES (?, 1990, 'male', 170, 80, 70, '2030-01-01', ?)`,
        args: [`u${i}`, level],
      });
    }
    await client.executeMultiple(readFileSync(join(migrationsDir, TAG), "utf8"));
    const rows = (await client.execute(`SELECT user_id, activity_level AS level FROM profile ORDER BY user_id`)).rows;
    expect(rows.map((r: { level?: unknown }) => r.level)).toEqual(["sedentary", "light", "moderate", "light", "sedentary", "very_active"]);
  });

  test("the deploy copy is the same file", () => {
    const deploy = readFileSync(join(migrationsDir, "../../migrations-deploy", TAG), "utf8");
    expect(deploy).toBe(readFileSync(join(migrationsDir, TAG), "utf8"));
  });
});
