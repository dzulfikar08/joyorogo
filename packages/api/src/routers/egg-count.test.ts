import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { EGG_COUNT_PROMPT } from "../lib/egg-count";
import { aiRouter } from "./ai";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('egg', 'egg', 'egg@test.id');`);

const EGG_SCAN = JSON.stringify({
  items: [
    { name: "nasi putih", kind: "makanan", kcal: 130, grams: 100 },
    { name: "telur rebus", kind: "makanan", portion: "2 belahan", count: 2, unit: "belahan", kcal: 77, grams: 50, protein: 6.3, fat: 5.3 },
  ],
});
const RICE_SCAN = JSON.stringify({ items: [{ name: "nasi putih", kind: "makanan", kcal: 195, grams: 150 }] });
const SIX = JSON.stringify({ eggs: Array.from({ length: 6 }, (_, i) => ({ kind: "belahan", box: [100 * i, 0, 100 * i + 90, 300] })) });

/** Answers the scan prompt and the egg-list prompt apart, and counts the calls of each. */
function fakeAi(scan: string, eggs: string | Error) {
  const calls = { scan: 0, eggs: 0 };
  return {
    calls,
    ai: {
      run: (_model: string, body: { messages: Array<{ content: Array<{ type: string; text?: string }> }> }) => {
        const isEggs = body.messages[0]!.content[0]!.text === EGG_COUNT_PROMPT;
        calls[isEggs ? "eggs" : "scan"]++;
        if (isEggs && eggs instanceof Error) return Promise.reject(eggs);
        return Promise.resolve({
          choices: [{ message: { content: isEggs ? eggs : scan }, finish_reason: "stop" }],
          usage: { prompt_tokens: isEggs ? 480 : 1200, completion_tokens: isEggs ? 148 : 120 },
        });
      },
    },
  };
}

const background: Promise<unknown>[] = [];
const ctx = (ai: unknown) =>
  ({
    db,
    env: { AI: ai },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: "egg" } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;
const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

describe("ai.analyzeFood with the boiled-egg recount", () => {
  test("a plate with a boiled-egg row: six halves listed for two read, so the row is 150 g and its kcal follow", async () => {
    const { ai, calls } = fakeAi(EGG_SCAN, SIX);
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx(ai) });
    expect(calls).toEqual({ scan: 1, eggs: 1 });
    expect(result.items[0]).toMatchObject({ name: "nasi putih", grams: 100 });
    expect(result.items[1]).toMatchObject({ name: "telur rebus", grams: 150, kcal: 225, portion: "6 belahan", pieces: { count: 6, unit: "belahan", unitGrams: 25 } });
  });

  test("the ledger row keeps what the call listed", async () => {
    const { ai } = fakeAi(EGG_SCAN, SIX);
    await call(aiRouter.analyzeFood, INPUT, { context: ctx(ai) });
    await Promise.all(background);
    const { rows } = await client.execute(`SELECT usage_json FROM ai_usage WHERE user_id = 'egg' ORDER BY rowid DESC LIMIT 1`);
    const usage = JSON.parse(String(rows[0]!.usage_json));
    expect(usage.eggCount).toMatchObject({ whole: 0, halves: 6, usage: { completion_tokens: 148 } });
  });

  test("a plate with no boiled egg makes no second call", async () => {
    const { ai, calls } = fakeAi(RICE_SCAN, SIX);
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx(ai) });
    expect(calls).toEqual({ scan: 1, eggs: 0 });
    expect(result.items[0]).toMatchObject({ grams: 150, kcal: 195 });
  });

  test("a failing or empty egg call leaves the scan's own count", async () => {
    for (const eggs of [new Error("egg model down"), JSON.stringify({ eggs: [] })]) {
      const { ai, calls } = fakeAi(EGG_SCAN, eggs);
      const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx(ai) });
      expect(calls.eggs).toBe(1);
      expect(result.items[1]).toMatchObject({ name: "telur rebus", grams: 50, portion: "2 belahan" });
    }
  });
});
