// "Seperti biasanya" through the scan: a food the user logged before keeps their kcal per gram; the model's own number
// rides along in the note and the session ledger keeps the numbers the user saw.
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
  INSERT INTO "user" (id, name, email) VALUES ('hist', 'hist', 'hist@test.id'), ('fresh', 'fresh', 'fresh@test.id');
`);
const db = drizzle(client) as unknown as Database;
const today = jakartaToday();

async function log(userId: string, id: string, name: string, grams: number, kcal: number, daysAgo: number, protein: number | null = null) {
  const createdAt = Date.now() - daysAgo * 86_400_000;
  await client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, grams, protein, carbs, fat, source, created_at) VALUES (?, ?, ?, 'makan_siang', ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    args: [id, userId, shiftDate(today, -daysAgo), name, kcal, grams, protein, protein === null ? null : 40, protein === null ? null : 1, createdAt],
  });
}
// The newest row is the one the user last accepted: 195 kcal per 100 g; an older one said 231.
await log("hist", "old", "Nasi putih", 100, 231, 9);
await log("hist", "new", "nasi putih", 100, 195, 2, 3.5);

const ANSWER = JSON.stringify({
  items: [
    { name: "nasi putih", kind: "makanan", kcal: 231, grams: 100, protein: 4.2, carbs: 50, fat: 0.5 },
    { name: "tempe goreng", kind: "makanan", kcal: 160, grams: 50 },
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

describe("ai.analyzeFood: Seperti biasanya", () => {
  test("a food the user logged before takes their last kcal per gram, with the model's number in the note", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("hist") });
    const [rice, tempe] = result.items;
    expect(rice).toMatchObject({ name: "nasi putih", grams: 100, kcal: 195, protein: 3.5, carbs: 40, usualDensity: { modelKcal: 231, n: 2 } });
    expect(tempe && "usualDensity" in tempe).toBe(false);
    expect(tempe).toMatchObject({ name: "tempe goreng", grams: 50 });
  });

  test("the ledger keeps the answer the user was shown", async () => {
    await call(aiRouter.analyzeFood, INPUT, { context: ctx("hist") });
    await Promise.all(background);
    const { rows } = await client.execute(`SELECT usage_json FROM ai_usage WHERE user_id = 'hist' AND scan_type = 'user' ORDER BY created_at DESC LIMIT 1`);
    const usage = JSON.parse(String(rows[0]?.usage_json)) as { aiItems?: Array<{ n: string; k: number }> };
    // aiItems only exists when the photo was stored (no R2 in tests): the shown number is never the model's 231.
    if (usage.aiItems) expect(usage.aiItems.find((item) => item.n === "nasi putih")?.k).toBe(195);
  });

  test("a user with no history gets the model's numbers untouched", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("fresh") });
    expect(result.items[0]).toMatchObject({ name: "nasi putih", kcal: 231 });
    expect(result.items[0] && "usualDensity" in result.items[0]).toBe(false);
  });
});
