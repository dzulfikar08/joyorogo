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
import { savedFoodRouter } from "./saved-food";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('u1', 'u1', 'u1@test.id'), ('u2', 'u2', 'u2@test.id');
`);

const db = drizzle(client) as unknown as Database;
const ctx = (userId: string) =>
  ({
    db,
    env: {},
    waitUntil: () => {},
    session: { user: { id: userId } },
  }) as unknown as Context;
const u1 = { context: ctx("u1") };

describe("savedFood router", () => {
  test("save, list, relog (single + plate), rename, remove", async () => {
    const a = await call(
      foodRouter.add,
      { date: "2026-10-14", meal: "sarapan", name: "Nasi uduk", kcal: 400, grams: 250, protein: 9, scanId: "a".repeat(32), plate: { priceIdr: 12000, place: "Warung Bu Tini" } },
      u1,
    );
    const rows = [
      await call(foodRouter.add, { date: "2026-10-14", meal: "makan_siang", name: "Nasi", kcal: 200, plate: { name: "Nasi ayam", priceIdr: 25000 } }, u1),
    ];
    const plateId = rows[0]?.plateId as string;
    await call(foodRouter.add, { date: "2026-10-14", meal: "makan_siang", name: "Ayam", kcal: 250, plateId }, u1);

    const single = await call(savedFoodRouter.save, { foodId: a?.id as string }, u1);
    const again = await call(savedFoodRouter.save, { foodId: a?.id as string }, u1);
    expect(again.id).toBe(single.id);
    expect(single.priceIdr).toBe(12000);
    expect(single.items[0]?.scanId).toBe("a".repeat(32));

    const plate = await call(savedFoodRouter.save, { plateId }, u1);
    expect(plate.items).toHaveLength(2);
    expect(plate.kcal).toBe(450);

    expect((await call(savedFoodRouter.list, undefined, u1)).items).toHaveLength(2);
    expect((await call(savedFoodRouter.list, undefined, { context: ctx("u2") })).items).toHaveLength(0);

    const relogged = await call(savedFoodRouter.relog, { id: single.id, date: "2026-10-15", meal: "snack" }, u1);
    expect(relogged.items[0]).toMatchObject({ date: "2026-10-15", meal: "snack", grams: 250, protein: 9, scanId: "a".repeat(32) });
    const day = await call(foodRouter.listByDate, { date: "2026-10-15" }, u1);
    expect(day.items).toHaveLength(1);

    const platePlay = await call(savedFoodRouter.relog, { id: plate.id, date: "2026-10-15", meal: "makan_malam" }, u1);
    expect(platePlay.items).toHaveLength(2);
    expect(platePlay.plateId).not.toBe(plateId);

    const renamed = await call(savedFoodRouter.rename, { id: single.id, name: "Uduk andalan" }, u1);
    expect(renamed?.name).toBe("Uduk andalan");

    expect((await call(savedFoodRouter.list, undefined, u1)).items[0]?.useCount).toBeGreaterThan(0);

    await call(savedFoodRouter.remove, { id: single.id }, u1);
    expect((await call(savedFoodRouter.list, undefined, u1)).items).toHaveLength(1);
    await expect(call(savedFoodRouter.relog, { id: single.id, meal: "snack" }, u1)).rejects.toThrow();
  });
});

describe("savedFood router: starring again", () => {
  test("a favorite saved from a macro-less row takes the macros once the row is filled in; a poorer copy never overwrites", async () => {
    const bare = await call(foodRouter.add, { date: "2026-10-16", meal: "sarapan", name: "Kue ajaib favorit", kcal: 321, source: "barcode" }, u1);
    expect(bare).toMatchObject({ protein: null, carbs: null, fat: null });
    const first = await call(savedFoodRouter.save, { foodId: bare!.id }, u1);
    expect(first.items[0]).toMatchObject({ protein: null });

    await call(foodRouter.update, { id: bare!.id, protein: 7, carbs: 41, fat: 6 }, u1);
    const second = await call(savedFoodRouter.save, { foodId: bare!.id }, u1);
    expect(second.id).toBe(first.id);
    expect(second.items[0]).toMatchObject({ protein: 7, carbs: 41, fat: 6 });

    // A later macro-less duplicate of the same dish does not blank the favorite again.
    const poor = await call(foodRouter.add, { date: "2026-10-17", meal: "sarapan", name: "Kue ajaib favorit", kcal: 321, source: "barcode" }, u1);
    const third = await call(savedFoodRouter.save, { foodId: poor!.id }, u1);
    expect(third.items[0]).toMatchObject({ protein: 7, carbs: 41, fat: 6 });
    const relogged = await call(savedFoodRouter.relog, { id: first.id, date: "2026-10-18", meal: "snack" }, u1);
    expect(relogged.items[0]).toMatchObject({ protein: 7, carbs: 41, fat: 6 });
  });
});
