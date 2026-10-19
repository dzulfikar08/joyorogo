import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { weightRouter } from "./weight";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id');`);

const db = drizzle(client) as unknown as Database;
const as = () => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "a" } } } as unknown as Context,
});

async function row(date: string) {
  const r = await client.execute({ sql: "SELECT * FROM weight_log WHERE user_id = 'a' AND date = ?", args: [date] });
  return r.rows[0] as unknown as Record<string, unknown>;
}

describe("weight.checkIn body composition", () => {
  test("manual entry has no body fields and source manual", async () => {
    await call(weightRouter.checkIn, { weightKg: 70, date: "2026-10-18" }, as());
    expect(await row("2026-10-18")).toMatchObject({ weight_kg: 70, body_fat_pct: null, source: "manual" });
  });

  test("scale entry sets body fields on the same day", async () => {
    await call(weightRouter.checkIn, { weightKg: 70.4, date: "2026-10-18", bodyFatPct: 22.5, musclePct: 40, source: "scale" }, as());
    expect(await row("2026-10-18")).toMatchObject({ weight_kg: 70.4, body_fat_pct: 22.5, muscle_pct: 40, source: "scale" });
  });

  test("a later manual entry updates weight and keeps body fields", async () => {
    await call(weightRouter.checkIn, { weightKg: 71, date: "2026-10-18" }, as());
    expect(await row("2026-10-18")).toMatchObject({ weight_kg: 71, body_fat_pct: 22.5, muscle_pct: 40, source: "scale" });
  });

  test("out-of-range body values are rejected", async () => {
    await expect(call(weightRouter.checkIn, { weightKg: 70, bodyFatPct: 90, source: "scale" }, as())).rejects.toThrow();
    await expect(call(weightRouter.checkIn, { weightKg: 70, visceralFat: 0, source: "scale" }, as())).rejects.toThrow();
  });

  test("history returns the body fields", async () => {
    const h = await call(weightRouter.history, { limit: 10 }, as());
    expect(h.entries.at(-1)).toMatchObject({ bodyFatPct: 22.5, source: "scale" });
  });
});
