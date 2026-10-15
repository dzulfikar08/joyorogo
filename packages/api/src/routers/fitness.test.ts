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
import { fitnessRouter } from "./fitness";

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
const today = jakartaToday();
const yesterday = shiftDate(today, -1);

describe("fitness router", () => {
  test("upsert then read a day; scores are per user", async () => {
    const out = await call(
      fitnessRouter.upsertScores,
      { days: [{ date: today, recoveryPct: 62, strain: 11.4, sleepPct: 88, readiness: "Balanced" }] },
      u1,
    );
    expect(out.saved).toBe(1);

    const row = await call(fitnessRouter.byDate, { date: today }, u1);
    expect(row).toMatchObject({ recoveryPct: 62, strain: 11.4, sleepPct: 88, readiness: "Balanced", source: "joyofit" });
    expect(await call(fitnessRouter.byDate, { date: today }, { context: ctx("u2") })).toBeNull();
    // Default date is today (WIB).
    expect((await call(fitnessRouter.byDate, {}, u1))?.date).toBe(today);
  });

  test("a later push with nulls keeps the stored scores and updates the rest", async () => {
    await call(fitnessRouter.upsertScores, { days: [{ date: yesterday, recoveryPct: 40, sleepPct: 70 }] }, u1);
    await call(fitnessRouter.upsertScores, { days: [{ date: yesterday, strain: 16.5, recoveryPct: null }] }, u1);
    expect(await call(fitnessRouter.byDate, { date: yesterday }, u1)).toMatchObject({
      recoveryPct: 40,
      sleepPct: 70,
      strain: 16.5,
      readiness: null,
    });
    await call(fitnessRouter.upsertScores, { days: [{ date: yesterday, strain: 3, recoveryPct: 55 }] }, u1);
    expect(await call(fitnessRouter.byDate, { date: yesterday }, u1)).toMatchObject({ recoveryPct: 55, strain: 3 });
  });

  test("a batch repeating a date saves it once", async () => {
    const date = shiftDate(today, -2);
    const out = await call(fitnessRouter.upsertScores, { days: [{ date, strain: 5 }, { date, strain: 6 }] }, u1);
    expect(out.saved).toBe(1);
    expect((await call(fitnessRouter.byDate, { date }, u1))?.strain).toBe(6);
  });

  test("rejects out-of-range input", async () => {
    const bad = (days: unknown[]) => call(fitnessRouter.upsertScores, { days } as never, u1);
    await expect(bad([{ date: today, strain: 22 }])).rejects.toThrow();
    await expect(bad([{ date: today, recoveryPct: 101 }])).rejects.toThrow();
    await expect(bad([{ date: today, readiness: "Great" }])).rejects.toThrow();
    await expect(bad([{ date: shiftDate(today, -200), strain: 5 }])).rejects.toThrow();
    await expect(bad([{ date: shiftDate(today, 5), strain: 5 }])).rejects.toThrow();
    await expect(bad([{ date: "2026-13-45", strain: 5 }])).rejects.toThrow();
    await expect(bad([])).rejects.toThrow();
  });
});
