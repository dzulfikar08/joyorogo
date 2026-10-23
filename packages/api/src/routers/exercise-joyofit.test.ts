import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { exerciseRouter } from "./exercise";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id'), ('b', 'b', 'b@test.id');`);

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

const input = { externalId: "strength:w1abc", date: "2026-10-18", name: "Strength: Push", durationMin: 45, kcal: 260 };

async function logs(userId: string) {
  const result = await client.execute({
    sql: "SELECT date, type, name, duration_min, kcal, source, external_id FROM exercise_log WHERE user_id = ?",
    args: [userId],
  });
  const raw: Record<string, unknown>[] = result.rows;
  return raw;
}

describe("exercise.upsertJoyofit / removeJoyofit", () => {
  test("inserts one joyofit row with the strength type", async () => {
    await call(exerciseRouter.upsertJoyofit, input, as("a"));
    const rows = await logs("a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "joyofit", external_id: "strength:w1abc", type: "angkat_beban", kcal: 260, duration_min: 45, date: "2026-10-18" });
  });

  test("the same external id updates kcal, name, duration and date instead of adding a row", async () => {
    await call(exerciseRouter.upsertJoyofit, { ...input, kcal: 300, durationMin: 50, name: "Latihan beban: Dorong", date: "2026-10-17" }, as("a"));
    const rows = await logs("a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kcal: 300, duration_min: 50, name: "Latihan beban: Dorong", date: "2026-10-17", type: "angkat_beban" });
  });

  test("another account with the same external id has its own row", async () => {
    await call(exerciseRouter.upsertJoyofit, input, as("b"));
    expect(await logs("b")).toHaveLength(1);
    expect(await logs("a")).toHaveLength(1);
  });

  test("an explicit type is kept; limits match exercise.add", async () => {
    await call(exerciseRouter.upsertJoyofit, { ...input, externalId: "strength:w2", type: "calisthenics" }, as("a"));
    expect((await logs("a")).find((r) => r.external_id === "strength:w2")).toMatchObject({ type: "calisthenics" });
    await expect(call(exerciseRouter.upsertJoyofit, { ...input, kcal: 10_001 }, as("a"))).rejects.toThrow();
    await expect(call(exerciseRouter.upsertJoyofit, { ...input, durationMin: 0.5 }, as("a"))).rejects.toThrow();
    await expect(call(exerciseRouter.upsertJoyofit, { ...input, durationMin: 1441 }, as("a"))).rejects.toThrow();
    await expect(call(exerciseRouter.upsertJoyofit, { ...input, externalId: "x".repeat(101) }, as("a"))).rejects.toThrow();
    await expect(call(exerciseRouter.upsertJoyofit, { ...input, date: "18-10-2026" }, as("a"))).rejects.toThrow();
  });

  test("remove deletes only the caller's joyofit row", async () => {
    await call(exerciseRouter.add, { name: "Manual", kcal: 100, source: "manual", externalId: "strength:w1abc" }, as("a"));
    expect(await call(exerciseRouter.removeJoyofit, { externalId: "strength:w1abc" }, as("a"))).toEqual({ ok: true });
    const left = await logs("a");
    expect(left.some((r) => r.source === "joyofit" && r.external_id === "strength:w1abc")).toBe(false);
    expect(left.some((r) => r.source === "manual")).toBe(true);
    expect(await logs("b")).toHaveLength(1);
    // Removing something that is not there is fine.
    expect(await call(exerciseRouter.removeJoyofit, { externalId: "strength:none" }, as("a"))).toEqual({ ok: true });
  });
});
