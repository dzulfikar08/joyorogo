import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { SCALE_PROMPT } from "../lib/scale-reading";
import { aiRouter } from "./ai";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('on', 'on', 'on@test.id'), ('off', 'off', 'off@test.id');
`);
const db = drizzle(client) as unknown as Database;

const SCAN = JSON.stringify({
  items: [
    { name: "nasi putih", kind: "makanan", kcal: 195, grams: 150, protein: 4, carbs: 42, fat: 0.4 },
    { name: "ayam goreng", kind: "makanan", kcal: 260, grams: 80 },
  ],
});
const scaleAnswer = (scale: unknown) => JSON.stringify({ scale });
const READ = { reading: "100", unit: "g", confidence: 0.95, appliesTo: "nasi putih" };

/** Answers the scan prompt and the scale prompt apart, and counts the calls of each. */
function fakeAi(scale: string | Error) {
  const calls = { scan: 0, scale: 0 };
  return {
    calls,
    ai: {
      run: (_model: string, body: { messages: Array<{ content: Array<{ type: string; text?: string }> }> }) => {
        const isScale = body.messages[0]!.content[0]!.text === SCALE_PROMPT;
        calls[isScale ? "scale" : "scan"]++;
        if (isScale && scale instanceof Error) return Promise.reject(scale);
        return Promise.resolve({
          choices: [{ message: { content: isScale ? scale : SCAN }, finish_reason: "stop" }],
          usage: { prompt_tokens: isScale ? 500 : 1200, completion_tokens: isScale ? 30 : 120 },
        });
      },
    },
  };
}

const background: Promise<unknown>[] = [];
const ctx = (userId: string, ai: unknown, allow?: string) =>
  ({
    db,
    env: { AI: ai, ...(allow !== undefined ? { SCALE_READOUT_USER_IDS: allow } : {}) },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: userId } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;
const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

describe("ai.analyzeFood with the kitchen-scale readout", () => {
  test("flag off: no second call, the answer is the scan's own", async () => {
    const { ai, calls } = fakeAi(scaleAnswer(READ));
    const unset = await call(aiRouter.analyzeFood, INPUT, { context: ctx("off", ai) });
    const other = await call(aiRouter.analyzeFood, INPUT, { context: ctx("off", ai, "someone-else") });
    expect(calls).toEqual({ scan: 2, scale: 0 });
    expect(unset.items.some((item) => "scaleRead" in item)).toBe(false);
    expect(unset.items[0]).toMatchObject({ name: "nasi putih", grams: 150 });
    const strip = (r: typeof unset) => JSON.stringify({ ...r, scanId: null, photoId: null });
    expect(strip(other)).toBe(strip(unset));
  });

  test("flag on, display read: the weighed item gets the scale's grams, the chip carries the estimate", async () => {
    const { ai, calls } = fakeAi(scaleAnswer(READ));
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("on", ai, "x, on") });
    expect(calls).toEqual({ scan: 1, scale: 1 });
    const [rice, ayam] = result.items;
    expect(rice).toMatchObject({
      name: "nasi putih",
      grams: 100,
      scaleRead: { active: "scale", text: "100", unit: "g", grams: 100, count: 1, other: { grams: 150, kcal: 195 } },
    });
    expect(rice!.kcal).toBeLessThan(195);
    // Unweighed bone-in fried chicken: 9089ed2 prices only the edible share (52 of 80 g), so kcal drops from the model's 260.
    expect(ayam).toMatchObject({ name: "ayam goreng", grams: 80, edibleGrams: 52, kcal: 183 });
    expect("scaleRead" in ayam!).toBe(false);
  });

  test("the ledger row keeps the reading, what became of it and the model's own grams", async () => {
    const { ai } = fakeAi(scaleAnswer(READ));
    await call(aiRouter.analyzeFood, INPUT, { context: ctx("on", ai, "on") });
    await Promise.all(background);
    const { rows } = await client.execute(`SELECT usage_json FROM ai_usage WHERE user_id = 'on' ORDER BY rowid DESC LIMIT 1`);
    const usage = JSON.parse(String(rows[0]!.usage_json));
    expect(usage.scale).toMatchObject({ text: "100", unit: "g", applied: [0], before: [150], usage: { completion_tokens: 30 } });
  });

  test("no display, a low-confidence read or a failing scale call: the scan is untouched", async () => {
    for (const scale of [scaleAnswer(null), scaleAnswer({ ...READ, confidence: 0.4 }), new Error("scale model down")]) {
      const { ai, calls } = fakeAi(scale);
      const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("on", ai, "on") });
      expect(calls.scale).toBeGreaterThanOrEqual(1);
      expect(result.items[0]).toMatchObject({ grams: 150, kcal: 195 });
      expect(result.items.some((item) => "scaleRead" in item)).toBe(false);
    }
  });
});
