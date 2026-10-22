// Moving a plate to another day moves its rows; their "jam makan" (eatenAt) cannot stay on the old day.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { foodRouter } from "./food";
import { plateRouter } from "./plate";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('m1', 'm1', 'm1@test.id');`);
const db = drizzle(client) as unknown as Database;
const as = () => ({ context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "m1" } } } as unknown as Context });

const day = shiftDate(jakartaToday(), -3);
const earlier = shiftDate(jakartaToday(), -4);
const noon = new Date(`${day}T05:00:00Z`).getTime();

describe("plate.update date move", () => {
  test("a plate moved to another day drops the eaten time that belonged to the old day; the macros stay", async () => {
    const a = await call(
      foodRouter.add,
      { date: day, meal: "makan_siang", name: "Nasi", kcal: 200, protein: 4, carbs: 44, fat: 0.4, fiber: 0.6, grams: 150, eatenAt: noon, plate: { name: "Nasi ayam" } },
      as(),
    );
    await call(foodRouter.add, { date: day, meal: "makan_siang", name: "Ayam", kcal: 260, protein: 27, carbs: 3, fat: 15, grams: 120, eatenAt: noon, plateId: a!.plateId! }, as());

    // same-day "move" (slot only) keeps the time
    await call(plateRouter.update, { id: a!.plateId!, meal: "makan_malam" }, as());
    let rows = (await call(foodRouter.listByDate, { date: day }, as())).items;
    expect(rows.map((r) => [r.meal, r.eatenAt])).toEqual([["makan_malam", noon], ["makan_malam", noon]]);

    await call(plateRouter.update, { id: a!.plateId!, date: earlier }, as());
    rows = (await call(foodRouter.listByDate, { date: earlier }, as())).items;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.eatenAt)).toEqual([null, null]);
    expect(rows.map((r) => [r.protein, r.carbs, r.fat, r.fiber, r.grams])).toEqual([
      [4, 44, 0.4, 0.6, 150],
      [27, 3, 15, null, 120],
    ]);
  });
});
