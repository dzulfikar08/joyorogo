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
  INSERT INTO "user" (id, name, email) VALUES ('on', 'on', 'on@test.id'), ('few', 'few', 'few@test.id'), ('two', 'two', 'two@test.id'), ('none', 'none', 'none@test.id');
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
// Typed rice weights around 100 g: five for "on", four for "few", two (95 g) for "two"; "none" has none.
for (const g of [95, 100, 100, 105, 100]) await log("on", "nasi putih", g, "manual", null);
for (const g of [95, 100, 100, 105]) await log("few", "nasi putih", g, "manual", null);
for (const g of [95, 95]) await log("two", "nasi putih", g, "manual", null);

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
const ctx = (userId: string) =>
  ({
    db,
    env: { AI: fakeAi },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: userId } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;
const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

describe("ai.analyzeFood with Porsi kebiasaanmu, for every user", () => {
  test("no weighed history: the model's numbers stay, plain rice carries the typical portion on a chip", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("none") });
    const [rice, ayam] = result.items;
    expect(rice).toMatchObject({
      name: "nasi putih",
      grams: 130,
      kcal: 169,
      portionPrior: { active: "ai", n: 0, source: "typical", other: { grams: 100, kcal: 130 } },
    });
    expect(ayam).toMatchObject({ name: "ayam goreng", grams: 80 });
    expect(ayam && "portionPrior" in ayam).toBe(false);
  });

  test("five weights typed: rice starts at the usual grams, the model's number rides along", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("on") });
    const [rice, ayam] = result.items;
    expect(rice).toMatchObject({
      name: "nasi putih",
      grams: 100,
      kcal: 130,
      portionPrior: { active: "prior", n: 5, source: "you", other: { grams: 130, kcal: 169 } },
    });
    expect(ayam && "portionPrior" in ayam).toBe(false);
  });

  test("four weights are enough to start at the usual grams (PRIOR_MIN_ENTRIES is 3)", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("few") });
    expect(result.items[0]).toMatchObject({ grams: 100, portionPrior: { active: "prior", n: 4, source: "you" } });
  });

  test("two weights: the model's number stays, the user's own median is one tap away", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("two") });
    expect(result.items[0]).toMatchObject({
      grams: 130,
      kcal: 169,
      portionPrior: { active: "ai", n: 2, source: "you", other: { grams: 95 } },
    });
  });
});
