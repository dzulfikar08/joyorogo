import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { aiRouter } from "./ai";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email, tier) VALUES ('u1', 'u1', 'u1@test.id', 'free');`);

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

describe("ai.logCorrections", () => {
  test("30 corrected items (the schema's maximum) are all stored, past D1's 100 bound parameters per statement", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      meal: "makan_siang" as const,
      dishName: `Dish ${i}`,
      aiKcal: 300 + i,
      savedKcal: 250 + i,
      aiGrams: 150,
      aiConfidence: 0.8,
    }));
    expect(await call(aiRouter.logCorrections, { source: "native", items }, as("u1"))).toEqual({ logged: 30 });
    const stored = await client.execute(`SELECT dish_name FROM scan_correction WHERE user_id = 'u1' ORDER BY dish_name`);
    expect(stored.rows).toHaveLength(30);
  });
});
