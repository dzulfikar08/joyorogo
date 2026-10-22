// Catat cepat > Atur: favorites the user arranges (reorder, add by hand, edit, remove), recent chips they hide, and the
// one-time offer to save a food or combo logged three times in 14 days.
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
import { savedFoodRouter } from "./saved-food";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('c1', 'c1', 'c1@test.id'), ('c2', 'c2', 'c2@test.id');
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});
const c1 = as("c1");
const today = jakartaToday();
type AddInput = {
  date: string;
  meal: "sarapan" | "makan_siang" | "makan_malam" | "snack";
  name: string;
  kcal: number;
  plate?: { name?: string };
  plateId?: string;
};
const add = (input: AddInput, who = c1) => call(foodRouter.add, input, who);

describe("favorites you arrange", () => {
  test("create by hand, reorder, edit kcal and name, remove", async () => {
    const coffee = await call(savedFoodRouter.create, { name: "Americano es", kcal: 5, grams: 250, protein: 0.3, carbs: 0.8, fat: 0 }, c1);
    const eggs = await call(savedFoodRouter.create, { name: "Putih telur", kcal: 52, grams: 100, protein: 11, carbs: 0.7, fat: 0.2 }, c1);
    const same = await call(savedFoodRouter.create, { name: "americano es", kcal: 5 }, c1);
    expect(same.id).toBe(coffee.id);
    expect(coffee.items[0]).toMatchObject({ name: "Americano es", kcal: 5, protein: 0.3, scanId: null });

    await call(savedFoodRouter.reorder, { ids: [eggs.id, coffee.id] }, c1);
    expect((await call(savedFoodRouter.list, undefined, c1)).items.map((row) => row.name)).toEqual(["Putih telur", "Americano es"]);
    await call(savedFoodRouter.reorder, { ids: [coffee.id, eggs.id] }, c1);
    expect((await call(savedFoodRouter.list, undefined, c1)).items.map((row) => row.name)).toEqual(["Americano es", "Putih telur"]);

    // A new kcal scales the macros with it and keeps the weight; the star key follows the new number.
    const doubled = await call(savedFoodRouter.update, { id: eggs.id, kcal: 104, name: "Putih telur rebus" }, c1);
    expect(doubled).toMatchObject({ name: "Putih telur rebus", kcal: 104, key: "putih telur|104" });
    expect(doubled.items[0]).toMatchObject({ kcal: 104, grams: 100, protein: 22, carbs: 1.4, fat: 0.4 });

    await call(savedFoodRouter.create, { name: "Putih telur", kcal: 40, protein: 8, carbs: 0, fat: 0 }, c1);
    await expect(call(savedFoodRouter.update, { id: eggs.id, kcal: 40 }, c1)).rejects.toThrow(/sama/i);

    // Another user's ids are ignored.
    await call(savedFoodRouter.reorder, { ids: [coffee.id] }, as("c2"));
    expect((await call(savedFoodRouter.list, undefined, as("c2"))).items).toHaveLength(0);

    await call(savedFoodRouter.remove, { id: coffee.id }, c1);
    expect((await call(savedFoodRouter.list, undefined, c1)).items.some((row) => row.id === coffee.id)).toBe(false);
  });

  test("a favorite made by hand relogs with its own numbers", async () => {
    const made = await call(savedFoodRouter.create, { name: "Roti tawar isi", kcal: 180, grams: 70, protein: 6, carbs: 30, fat: 3 }, c1);
    const relogged = await call(savedFoodRouter.relog, { id: made.id, date: today, meal: "sarapan" }, c1);
    expect(relogged.items[0]).toMatchObject({ name: "Roti tawar isi", kcal: 180, grams: 70, protein: 6 });
  });
});

describe("recent chips you hide", () => {
  test("a hidden name leaves the chips until restore; a one-food favorite is not repeated as a recent chip", async () => {
    const user = as("c2");
    await add({ date: today, meal: "snack", name: "Kue lumpur", kcal: 120 }, user);
    await add({ date: today, meal: "snack", name: "Pisang goreng", kcal: 150 }, user);
    await add({ date: today, meal: "snack", name: "Es teh manis", kcal: 90 }, user);
    expect((await call(foodRouter.recent, undefined, user)).items.map((row) => row.name).sort()).toEqual(["Es teh manis", "Kue lumpur", "Pisang goreng"]);

    await call(foodRouter.hideRecent, { name: " kue  LUMPUR " }, user);
    const hidden = await call(foodRouter.recent, undefined, user);
    expect(hidden.items.map((row) => row.name)).not.toContain("Kue lumpur");
    expect(hidden.hiddenCount).toBe(1);

    const tea = hidden.items.find((row) => row.name === "Es teh manis")!;
    await call(savedFoodRouter.save, { foodId: tea.id }, user);
    expect((await call(foodRouter.recent, undefined, user)).items.map((row) => row.name)).toEqual(["Pisang goreng"]);

    await call(foodRouter.restoreRecent, undefined, user);
    const restored = await call(foodRouter.recent, undefined, user);
    expect(restored.hiddenCount).toBe(0);
    expect(restored.items.map((row) => row.name)).toContain("Kue lumpur");
  });
});

describe("offer to save as favorite", () => {
  test("the third log of a food in 14 days is offered once; saving or Nanti ends it", async () => {
    const user = as("c1");
    const day = (back: number) => shiftDate(today, -back);
    await add({ date: day(5), meal: "snack", name: "Kerupuk udang", kcal: 80 }, user);
    await add({ date: day(3), meal: "snack", name: "kerupuk udang", kcal: 80 }, user);
    expect((await call(savedFoodRouter.offer, undefined, user)).offer).toBeNull();
    const third = await add({ date: day(1), meal: "snack", name: "Kerupuk Udang", kcal: 85 }, user);
    const { offer } = await call(savedFoodRouter.offer, undefined, user);
    expect(offer).toMatchObject({ kind: "food", key: "kerupuk udang", count: 3, targetId: third!.id, kcal: 85 });

    await call(savedFoodRouter.save, { foodId: offer!.targetId }, user);
    expect((await call(savedFoodRouter.offer, undefined, user)).offer).toBeNull();
  });

  test("a combo logged on three days is offered as its plate; Nanti never offers it again", async () => {
    const user = as("c2");
    let last = "";
    for (const back of [6, 4, 2]) {
      const first = await add({ date: shiftDate(today, -back), meal: "makan_siang", name: "Nasi putih", kcal: 195, plate: { name: "Nasi ayam timun" } }, user);
      await add({ date: shiftDate(today, -back), meal: "makan_siang", name: "Ayam goreng", kcal: 250, plateId: first!.plateId! }, user);
      last = first!.plateId!;
    }
    const { offer } = await call(savedFoodRouter.offer, undefined, user);
    expect(offer).toMatchObject({ kind: "plate", targetId: last, count: 3, name: "Nasi ayam timun", kcal: 445, items: 2 });

    await call(savedFoodRouter.dismissOffer, { key: offer!.key }, user);
    expect((await call(savedFoodRouter.offer, undefined, user)).offer).toBeNull();
  });

  test("logs older than 14 days do not count", async () => {
    const user = as("c1");
    for (const back of [20, 18, 16]) await add({ date: shiftDate(today, -back), meal: "snack", name: "Onde-onde", kcal: 140 }, user);
    expect((await call(savedFoodRouter.offer, undefined, user)).offer).toBeNull();
  });
});
