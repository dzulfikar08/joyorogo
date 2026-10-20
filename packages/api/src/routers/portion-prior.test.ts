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
import { aiRouter } from "./ai";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('on', 'on', 'on@test.id'), ('off', 'off', 'off@test.id'), ('lone', 'lone', 'lone@test.id');
`);
const db = drizzle(client) as unknown as Database;

const today = jakartaToday();
let row = 0;
async function log(userId: string, name: string, grams: number, source: string, itemsJson: string | null, daysAgo = 1) {
  await client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, grams, source, items_json) VALUES (?, ?, ?, 'makan_siang', ?, 130, ?, ?, ?)`,
    args: [`r${row++}`, userId, shiftDate(today, -daysAgo), name, grams, source, itemsJson],
  });
}
// Five typed rice weights around 100 g for both users; "lone" has only four.
for (const user of ["on", "off"]) for (const g of [95, 100, 100, 105, 100]) await log(user, "nasi putih", g, "manual", null);
for (const g of [95, 100, 100, 105]) await log("lone", "nasi putih", g, "manual", null);

const ANSWER = JSON.stringify({
  items: [
    { name: "nasi putih", kind: "makanan", kcal: 170, grams: 130, protein: 3.6, carbs: 36, fat: 0.4 },
    { name: "ayam goreng", kind: "makanan", kcal: 260, grams: 80 },
  ],
});
const fakeAi = {
  run: () =>
    Promise.resolve({
      choices: [{ message: { content: ANSWER }, finish_reason: "stop" }],
      usage: { prompt_tokens: 300, completion_tokens: 9 },
    }),
};
const background: Promise<unknown>[] = [];
const ctx = (userId: string, allow?: string) =>
  ({
    db,
    env: { AI: fakeAi, ...(allow !== undefined ? { PORTION_PRIOR_USER_IDS: allow } : {}) },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: userId } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;
const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

describe("ai.analyzeFood with Porsi kebiasaanmu", () => {
  test("flag off: the answer is byte-identical to a build without the feature", async () => {
    const unset = await call(aiRouter.analyzeFood, INPUT, { context: ctx("off") });
    const empty = await call(aiRouter.analyzeFood, INPUT, { context: ctx("off", "") });
    const other = await call(aiRouter.analyzeFood, INPUT, { context: ctx("off", "someone-else") });
    const strip = (r: typeof unset) => JSON.stringify({ ...r, scanId: null, photoId: null });
    expect(strip(empty)).toBe(strip(unset));
    expect(strip(other)).toBe(strip(unset));
    expect(unset.items.some((item) => "portionPrior" in item)).toBe(false);
    expect(unset.items[0]).toMatchObject({ name: "nasi putih", grams: 130 });
  });

  test("flag on with history: rice starts at the usual grams, the model's number rides along", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("on", "x, on") });
    const [rice, ayam] = result.items;
    expect(rice).toMatchObject({
      name: "nasi putih",
      grams: 100,
      kcal: 131,
      portionPrior: { active: "prior", n: 5, other: { grams: 130, kcal: 170 } },
    });
    expect(ayam).toMatchObject({ name: "ayam goreng", grams: 80 });
    expect(ayam && "portionPrior" in ayam).toBe(false);
  });

  test("flag on without enough history: unchanged", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("lone", "lone") });
    expect(result.items[0]).toMatchObject({ grams: 130, kcal: 170 });
    expect("portionPrior" in result.items[0]!).toBe(false);
  });
});
