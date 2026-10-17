import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { foodRouter } from "./food";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('u1', 'u1', 'u1@test.id');
`);

const db = drizzle(client) as unknown as Database;
const u1 = {
  context: {
    db,
    env: {},
    waitUntil: () => {},
    session: { user: { id: "u1" } },
  } as unknown as Context,
};

const logNasi = () =>
  call(
    foodRouter.add,
    { date: "2026-10-14", meal: "makan_siang", name: "Nasi goreng", grams: 200, kcal: 300, protein: 8, carbs: 45, fat: 9, fiber: 2 },
    u1,
  );

describe("food.update portion edits", () => {
  test("a weighed 99 g rescales kcal and macros instead of keeping the AI's 300 kcal", async () => {
    const row = await logNasi();
    const updated = await call(foodRouter.update, { id: row!.id, grams: 99 }, u1);
    expect(updated).toMatchObject({ grams: 99, kcal: 149, protein: 4, carbs: 22.3, fat: 4.5, fiber: 1 });
  });

  test("an explicitly typed kcal wins over the rescale", async () => {
    const row = await logNasi();
    const updated = await call(foodRouter.update, { id: row!.id, grams: 99, kcal: 280 }, u1);
    expect(updated).toMatchObject({ grams: 99, kcal: 280 });
  });

  test("an explicitly typed macro wins for that field only", async () => {
    const row = await logNasi();
    const updated = await call(foodRouter.update, { id: row!.id, grams: 100, carbs: 40 }, u1);
    expect(updated).toMatchObject({ grams: 100, kcal: 150, protein: 4, carbs: 40, fat: 4.5, fiber: 1 });
  });

  test("a row without a stored weight keeps its kcal when grams are set", async () => {
    const row = await call(foodRouter.add, { date: "2026-10-14", meal: "snack", name: "Kue", kcal: 120 }, u1);
    const updated = await call(foodRouter.update, { id: row!.id, grams: 50 }, u1);
    expect(updated).toMatchObject({ grams: 50, kcal: 120 });
  });
});
